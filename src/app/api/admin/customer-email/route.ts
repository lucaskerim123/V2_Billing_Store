import {createClient} from "@supabase/supabase-js";
import {wrapOrbitFsHtml,wrapOrbitFsText} from "@/lib/mail-branding";
import {loadMailRuntimeConfig,resolveMailDeliveryIdentity} from "@/lib/mail-config-server";
import {orbitfsStoreOrigin} from "@/lib/site-origin";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const pub=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
async function payload(r:Response){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
const normalize=(v:string)=>String(v||"").replace(/\\n/g,"\n");
function render(v:string,vars:Record<string,string>){return normalize(v).replace(/{{\s*([\w.]+)\s*}}/g,(_,k)=>vars[String(k).toLowerCase()]??`{{${k}}}`)}
function variables(v:string){return [...new Set([...normalize(v).matchAll(/{{\s*([\w.]+)\s*}}/g)].map(x=>String(x[1]).toLowerCase()))]}
function unresolved(v:string){return [...String(v||"").matchAll(/{{\s*([^}]+?)\s*}}/g)].map(x=>x[1]).filter(Boolean)}
function htmlFromText(v:string){return String(v||"").split(/\n{2,}/).map(x=>`<p>${x.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>")}</p>`).join("")}
function inScope(t:any,scope:string){const key=String(t?.template_key||"").toLowerCase();if(scope==="invoice")return key.startsWith("invoice_");if(scope==="order")return key.startsWith("order_")||key.startsWith("service_")||key.startsWith("cancellation_");return key.startsWith("customer_")}
async function ctx(req:Request){const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");if(!token)return null;const db=createClient(url,pub,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});const {data:{user}}=await db.auth.getUser(token);return user?{db,user}:null}

export async function GET(req:Request){
 const c=await ctx(req);if(!c)return Response.json({error:"Unauthorized"},{status:401});
 const u=new URL(req.url),id=u.searchParams.get("userId"),scope=String(u.searchParams.get("scope")||"customer").toLowerCase();
 if(!id)return Response.json({error:"userId required"},{status:400});
 const {data,error}=await c.db.rpc("admin_customer_mail_snapshot",{p_user_id:id});
 if(error)return Response.json({error:error.message},{status:403});
 const siteUrl=await orbitfsStoreOrigin(req.url);
 const templates=(data?.templates||[]).filter((t:any)=>inScope(t,scope)).map((t:any)=>({...t,subject:render(String(t.subject||""),{site_url:siteUrl}),text_body:render(String(t.text_body||""),{site_url:siteUrl}),html:render(String(t.html||""),{site_url:siteUrl})}));
 return Response.json({...data,templates});
}

export async function POST(req:Request){
 const c=await ctx(req);if(!c)return Response.json({error:"Unauthorized"},{status:401});
 const {data:canAdminSend}=await c.db.rpc("has_permission",{p_permission:"mail.admin.send"});
 const {data:allMail}=await c.db.rpc("has_permission",{p_permission:"all"});
 if(canAdminSend!==true&&allMail!==true)return Response.json({error:"Admin email send permission required."},{status:403});

 const config=await loadMailRuntimeConfig(c.db),b=await req.json().catch(()=>({})),id=String(b.userId||""),siteUrl=await orbitfsStoreOrigin(req.url);
 const {data:snap,error:se}=await c.db.rpc("admin_customer_mail_snapshot",{p_user_id:id});
 if(se||!snap?.email)return Response.json({error:se?.message||"Customer email unavailable."},{status:400});

 const customerName=String(b.customerName||"Customer"),templateKey=String(b.templateKey||"");
 const supplied:Record<string,string>={};
 if(b.variables&&typeof b.variables==="object")for(const [k,v] of Object.entries(b.variables))supplied[String(k).toLowerCase()]=String(v??"").trim();
 if(b.message!==undefined&&!supplied.message)supplied.message=String(b.message??"").trim();

 let subject=normalize(String(b.subject||"")),bodyText=normalize(String(b.body||"")),bodyHtml="",template:any=null;
 const staffName=String(c.user.user_metadata?.display_name||c.user.user_metadata?.full_name||c.user.email||"OrbitFS Staff");
 if(templateKey){
  const allowed=(snap.templates||[]).some((t:any)=>t.template_key===templateKey);
  if(!allowed)return Response.json({error:"Template is not available."},{status:400});
  const {data:t,error}=await c.db.rpc("mail_get_template",{p_template_key:templateKey});
  if(error||!t)return Response.json({error:"Template unavailable."},{status:404});
  template=t;
  if(!b.edited){subject=normalize(String(t.subject||""));bodyText=normalize(String(t.text_body||t.subject||""));bodyHtml=normalize(String(t.html||""))}
  const automatic=new Set(["customer_name","email_refrence_id","email_reference_id","staff_name","staff_email","staff_user_id","site_url"]);
  const required=variables(`${subject}\n${bodyText}\n${bodyHtml}`).filter(v=>!automatic.has(v));
  const missing=required.filter(v=>!String(supplied[v]||"").trim());
  if(missing.length)return Response.json({error:`Complete template fields before sending: ${missing.join(", ")}`},{status:400});
 }

 const requestedSender=String(template?.from_account||config.outbound.customer_sender);
 const identity=await resolveMailDeliveryIdentity(c.db,config,requestedSender);
 const {data:canSender}=await c.db.rpc("mail_can_send_address_admin",{p_address:identity.from});
 if(canSender!==true)return Response.json({error:`You do not have permission to send from ${identity.from}.`},{status:403});
 const relatedType=["customer","invoice","order"].includes(String(b.relatedType||""))?String(b.relatedType):"customer";
 const relatedId=String(b.relatedId||id);
 const eventType=String(b.eventType||`admin.quick_send.${relatedType}`);
 const {data:prep,error:pe}=await c.db.rpc("mail_prepare_delivery",{p_template_key:templateKey||null,p_event_type:eventType,p_related_type:relatedType,p_related_id:relatedId,p_recipient:snap.email,p_sender:identity.from,p_subject:subject});
 if(pe||!prep?.reference_id)return Response.json({error:pe?.message||"Could not prepare email record."},{status:500});

 const referenceId=String(prep.reference_id),logId=String(prep.id);
 const vars:Record<string,string>={...supplied,site_url:siteUrl,customer_name:customerName,email_refrence_id:referenceId,email_reference_id:referenceId,staff_name:staffName,staff_email:String(c.user.email||""),staff_user_id:String(c.user.id)};
 subject=render(subject,vars);bodyText=render(bodyText,vars);bodyHtml=render(bodyHtml,vars);
 const left=[...new Set([...unresolved(subject),...unresolved(bodyText),...unresolved(bodyHtml)])];
 if(left.length)return Response.json({error:`Resolve template variables before sending: ${left.join(", ")}`},{status:400});
 if(!subject.trim()||!bodyText.trim())return Response.json({error:"Subject and message are required."},{status:400});
 if(!bodyHtml)bodyHtml=htmlFromText(bodyText);

 const key=process.env.RESEND_API_KEY;if(!key)return Response.json({error:"Outbound transport is not configured."},{status:503});
 const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({from:`${identity.name} <${identity.from}>`,to:[snap.email],subject,text:wrapOrbitFsText(bodyText),html:wrapOrbitFsHtml(bodyHtml),reply_to:identity.replyTo,headers:{"X-OrbitFS-Reference":referenceId}}),cache:"no-store"}),j:any=await payload(r);
 await c.db.rpc("mail_finalize_delivery",{p_log_id:logId,p_provider_id:j.id||null,p_status:r.ok?"sent":"failed",p_error:r.ok?null:(j.message||`Provider ${r.status}`),p_sent_at:r.ok?new Date().toISOString():null,p_subject:subject});
 return r.ok?Response.json({ok:true,id:j.id,reference_id:referenceId}):Response.json({error:j.message||"Email delivery failed.",reference_id:referenceId},{status:r.status});
}
