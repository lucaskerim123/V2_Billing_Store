import {createClient} from "@supabase/supabase-js";
import {createSupabaseMailModuleStore} from "@/modules/mail-configuration/supabase-store";
import {sendConfiguredMail} from "@/modules/mail-configuration/module";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
const validId=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Access={permissions?:Record<string,boolean>};

async function context(req:Request){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\\s+/i,"");
  if(!token||!url||!publicKey||!serviceKey)return null;
  const auth=createClient(url,publicKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await auth.auth.getUser(token);
  if(error||!user)return null;
  const {data:access,error:accessError}=await auth.rpc("get_my_staff_access");
  if(accessError)return {error:"Unable to verify staff permissions.",status:403} as const;
  const permissions=(access||{}) as Access;
  const granted=!!permissions.permissions?.all||!!permissions.permissions?.["communications.mail.send"]||!!permissions.permissions?.["communications.mail.manage"];
  if(!granted)return {error:"Customer email send permission required.",status:403} as const;
  return {user,db:createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})} as const;
}

async function customerFor(db:any,id:string){
  const {data:customer,error}=await db.from("customers").select("id,auth_user_id,user_id,email,name,display_name,first_name,last_name,customer_number,company_name,phone,country_code,currency").or(`auth_user_id.eq.${id},user_id.eq.${id}`).maybeSingle();
  if(error)throw error;
  if(!customer)return null;
  const {data:profile,error:profileError}=await db.from("user_profiles").select("display_name,first_name,last_name,company_name,phone,country_code,currency").eq("id",id).maybeSingle();
  if(profileError)throw profileError;
  return {...customer,...(profile||{}),email:customer.email};
}

export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  if(!validId.test(id))return Response.json({error:"Invalid customer ID."},{status:400});
  const ctx=await context(req);
  if(!ctx)return Response.json({error:"Authentication required."},{status:401});
  if("error" in ctx)return Response.json({error:ctx.error},{status:ctx.status});
  try{
    const customer=await customerFor(ctx.db,id);
    if(!customer)return Response.json({error:"Customer record not found."},{status:404});
    const store=createSupabaseMailModuleStore(ctx.db as any);
    const [settings,templates]=await Promise.all([store.getSettings(),store.listTemplates()]);
    return Response.json({enabled:settings.enabled,email:customer.email||"",templates:templates.filter(t=>t.active).map(t=>({template_key:t.template_key,display_name:t.display_name,subject:t.subject,variables:t.variables||[]}))},{headers:{"cache-control":"no-store"}});
  }catch(error:any){return Response.json({error:error?.message||"Could not load customer email options."},{status:500});}
}

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  if(!validId.test(id))return Response.json({error:"Invalid customer ID."},{status:400});
  const ctx=await context(req);
  if(!ctx)return Response.json({error:"Authentication required."},{status:401});
  if("error" in ctx)return Response.json({error:ctx.error},{status:ctx.status});
  const body=await req.json().catch(()=>null);
  const templateKey=typeof body?.templateKey==="string"?body.templateKey.trim():"";
  const supplied=body?.variables&&typeof body.variables==="object"&&!Array.isArray(body.variables)?body.variables:{};
  if(!templateKey||templateKey.length>120)return Response.json({error:"A valid email template is required."},{status:400});
  for(const [key,value] of Object.entries(supplied)){
    if(!/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(key)||typeof value!=="string"||value.length>2000)
      return Response.json({error:"Invalid template variable."},{status:400});
  }
  try{
    const customer=await customerFor(ctx.db,id);
    if(!customer||!customer.email)return Response.json({error:"Customer email address is unavailable."},{status:404});
    const store=createSupabaseMailModuleStore(ctx.db as any);
    const template=await store.getTemplateByKey(templateKey);
    if(!template||!template.active)return Response.json({error:"Email template is missing or disabled."},{status:404});
    const allowedVariables=new Set(template.variables||[]);
    const extra:Record<string,string>={};
    for(const [key,value] of Object.entries(supplied)){
      if(!allowedVariables.has(key))return Response.json({error:`Template variable is not defined: ${key}`},{status:400});
      extra[key]=value as string;
    }
    const name=customer.display_name||[customer.first_name,customer.last_name].filter(Boolean).join(" ")||customer.name||"Customer";
    const context={
      ...extra,
      customer_name:name,
      customer_email:customer.email,
      customer_number:customer.customer_number||"",
      first_name:customer.first_name||"",
      last_name:customer.last_name||"",
      company_name:customer.company_name||"",
      phone:customer.phone||"",
      country_code:customer.country_code||"",
      currency:customer.currency||"AUD",
      site_url:process.env.NEXT_PUBLIC_SITE_URL||process.env.NEXT_PUBLIC_APP_URL||""
    };
    const result=await sendConfiguredMail({store,templateKey,context,resolveRecipients:async()=>customer.email});
    try{await ctx.db.from("admin_audit_log").insert({actor_id:ctx.user.id,action:"customer.email_sent",target_type:"customer",target_id:id,detail:{template_key:templateKey,recipient:customer.email}})}catch{}
    return Response.json({ok:true,message:"Email sent through Mail System.",delivery:result});
  }catch(error:any){return Response.json({error:error?.message||"Email could not be sent."},{status:500});}
}
