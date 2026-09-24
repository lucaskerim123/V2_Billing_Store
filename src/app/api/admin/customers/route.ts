import {randomBytes} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {sendAutomation} from "@/lib/transactional-server";
import {issuePasswordReset} from "@/lib/password-reset-server";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY!;

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
  const patch={first_name:body.first_name,last_name:body.last_name,display_name:displayName,company_name:body.company_name||null,phone:body.phone||null,address_line1:body.address_line1||null,address_line2:body.address_line2||null,city:body.city||null,state_region:body.state_region||null,postal_code:body.postal_code||null,country_code:body.country_code||"AU",timezone:body.timezone||"Australia/Sydney",currency:body.currency||"AUD",language:body.language||"en",status:"active",role:"user"};
  const {error:profileError}=await service.from("user_profiles").update(patch).eq("id",created.user.id);
  if(profileError)return Response.json({error:profileError.message},{status:500});
  await service.from("admin_audit_log").insert({actor_id:user.id,action:"customer.created",target_type:"customer",target_id:created.user.id,detail:{email,source:"admin"}});
  let welcomeError:string|null=null,setupError:string|null=null;
  try{await sendAutomation("customer.created",email,{customer_name:patch.display_name},"customer",created.user.id)}catch(e:any){welcomeError=e?.message||String(e)}
  try{await issuePasswordReset({id:created.user.id,email,name:patch.display_name},new URL(req.url).origin,user.id,(req.headers.get("x-forwarded-for")||"").split(",")[0].trim()||null)}catch(e:any){setupError=e?.message||String(e)}
  return Response.json({ok:true,id:created.user.id,mail_sent:!setupError,mail_error:setupError,welcome_mail_error:welcomeError});
}
