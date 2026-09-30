import {randomBytes} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {sendAutomation} from "@/lib/transactional-server";
import {issuePasswordReset} from "@/lib/password-reset-server";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req:Request){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return Response.json({error:"Authentication required."},{status:401});
  const userDb=createClient(url,publicKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
  const {data:{user},error:userError}=await userDb.auth.getUser(token);
  if(userError||!user)return Response.json({error:"Invalid session."},{status:401});
  const {data:access}=await userDb.rpc("get_my_staff_access");
  if(!access?.permissions?.all&&!access?.permissions?.["customers.view"]&&!access?.permissions?.["customers.edit"])return Response.json({error:"Permission denied."},{status:403});

  const service=createClient(url,serviceKey,{auth:{persistSession:false}});
  const [customers,profiles,balances]=await Promise.all([
    service.from("customers").select("*").order("created_at",{ascending:false}),
    service.from("user_profiles").select("*"),
    service.from("account_balances").select("*")
  ]);
  if(customers.error)return Response.json({error:customers.error.message},{status:500});
  if(profiles.error)return Response.json({error:profiles.error.message},{status:500});
  if(balances.error)return Response.json({error:balances.error.message},{status:500});

  const profileMap=new Map((profiles.data||[]).map((p:any)=>[String(p.id),p]));
  const rows=(customers.data||[])
    .filter((row:any)=>row.auth_user_id||row.user_id)
    .map((row:any)=>{
      const userId=String(row.auth_user_id||row.user_id);
      const p:any=profileMap.get(userId)||{};
      return {
        ...p,
        ...row,
        id:userId,
        auth_user_id:userId,
        customer_id:row.id,
        email:row.email,
        username:row.username,
        customer_number:row.customer_number||p.customer_number,
        status:row.status||p.status||"active",
        email_verified_at:row.email_verified_at||p.email_verified_at
      };
    })
    .filter((row:any)=>row.status!=="deleted");

  return Response.json({customers:rows,balances:balances.data||[]},{headers:{"cache-control":"no-store"}});
}

export async function POST(req:Request){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return Response.json({error:"Authentication required."},{status:401});
  const userDb=createClient(url,publicKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
  const {data:{user},error:userError}=await userDb.auth.getUser(token);
  if(userError||!user)return Response.json({error:"Invalid session."},{status:401});
  const service=createClient(url,serviceKey,{auth:{persistSession:false}});
  const {data:access}=await userDb.rpc("get_my_staff_access");
  if(!access?.permissions?.all&&!access?.permissions?.["customers.edit"])return Response.json({error:"Permission denied."},{status:403});
  const body=await req.json().catch(()=>({}));
  if(!body.email||!body.first_name||!body.last_name)return Response.json({error:"First name, last name and email are required."},{status:400});
  const email=String(body.email).trim().toLowerCase(),displayName=body.display_name||`${body.first_name} ${body.last_name}`.trim();
  const {data:created,error:createError}=await service.auth.admin.createUser({email,password:randomBytes(32).toString("base64url"),email_confirm:true,user_metadata:{first_name:body.first_name,last_name:body.last_name,display_name:displayName}});
  if(createError||!created.user)return Response.json({error:createError?.message||"Could not create customer."},{status:400});
  // Auth is the browser session transport; public.users/customers remain
  // the Billing Store customer identity and trigger profile/wallet provisioning.
  const now=new Date().toISOString();
  const {error:canonicalError}=await service.from("users").insert({
    id:created.user.id,email,display_name:displayName,
    first_name:String(body.first_name),last_name:String(body.last_name),
    status:"active",email_verified_at:now,updated_at:now
  });
  if(canonicalError){
    await service.auth.admin.deleteUser(created.user.id);
    return Response.json({error:`Could not create the canonical customer identity: ${canonicalError.message}`},{status:500});
  }
  const {data:customer,error:customerError}=await service.from("customers").insert({
    user_id:created.user.id,auth_user_id:created.user.id,email,
    name:displayName,display_name:displayName,
    first_name:String(body.first_name),last_name:String(body.last_name),
    company_name:body.company_name||null,phone:body.phone||null,
    address_line1:body.address_line1||null,address_line2:body.address_line2||null,
    city:body.city||null,state_region:body.state_region||null,
    postal_code:body.postal_code||null,country_code:body.country_code||"AU",
    timezone:body.timezone||"Australia/Sydney",currency:body.currency||"AUD",
    language:body.language||"en",status:"active",email_verified_at:now,
    metadata:{registration_source:"admin"},updated_at:now
  }).select("id").maybeSingle();
  if(customerError||!customer){
    await service.from("users").delete().eq("id",created.user.id);
    await service.auth.admin.deleteUser(created.user.id);
    return Response.json({error:customerError?.message||"Could not create the Billing Store customer record."},{status:500});
  }
  const patch={first_name:body.first_name,last_name:body.last_name,display_name:displayName,company_name:body.company_name||null,phone:body.phone||null,address_line1:body.address_line1||null,address_line2:body.address_line2||null,city:body.city||null,state_region:body.state_region||null,postal_code:body.postal_code||null,country_code:body.country_code||"AU",timezone:body.timezone||"Australia/Sydney",currency:body.currency||"AUD",language:body.language||"en"};
  const {data:profile,error:profileError}=await service.from("user_profiles").update(patch).eq("id",created.user.id).select("id").maybeSingle();
  if(profileError||!profile)return Response.json({error:profileError?.message||"Customer was created but its profile was not provisioned. Contact an administrator."},{status:500});
  await service.from("admin_audit_log").insert({actor_id:user.id,action:"customer.created",target_type:"customer",target_id:created.user.id,detail:{email,source:"admin"}});
  let welcomeError:string|null=null,setupError:string|null=null;
  try{await sendAutomation("customer.created",email,{customer_name:patch.display_name},"customer",created.user.id)}catch(e:any){welcomeError=e?.message||String(e)}
  try{await issuePasswordReset({id:created.user.id,email,name:patch.display_name},new URL(req.url).origin,user.id,(req.headers.get("x-forwarded-for")||"").split(",")[0].trim()||null)}catch(e:any){setupError=e?.message||String(e)}
  return Response.json({ok:true,id:created.user.id,mail_sent:!setupError,mail_error:setupError,welcome_mail_error:welcomeError});
}
