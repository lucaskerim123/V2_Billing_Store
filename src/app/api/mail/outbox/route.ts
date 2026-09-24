import {createClient} from "@supabase/supabase-js";
import {wrapOrbitFsHtml,wrapOrbitFsText} from "@/lib/mail-branding";
import {loadMailRuntimeConfig,resolveMailDeliveryIdentity} from "@/lib/mail-config-server";
import {orbitfsStoreOrigin} from "@/lib/site-origin";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const pub=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
const render=(v:string,vars:Record<string,string>)=>String(v||"").replace(/{{\s*([\w.]+)\s*}}/g,(_,k)=>vars[k]??"");
const normalize=(v:string)=>String(v||"").replace(/\\n/g,"\n");
async function providerJson(r:Response){const t=await r.text();if(!t)return {};try{return JSON.parse(t)}catch{return {message:t}}}

export async function POST(req:Request){
 const b=await req.json().catch(()=>({})),id=String(b.id||""),token=String(b.token||"");if(!id||!token)return Response.json({error:"Invalid dispatch."},{status:400});
 const db=createClient(url,pub,{auth:{persistSession:false}});const config=await loadMailRuntimeConfig(db);
 const {data:prep,error}=await db.rpc("mail_outbox_prepare",{p_id:id,p_token:token});if(error)return Response.json({error:error.message},{status:403});if(prep?.skip)return Response.json({ok:true,skipped:true,reason:prep.reason});
 const vars:Record<string,string>={};for(const [k,v] of Object.entries(prep?.vars||{}))vars[k]=String(v??"");const referenceId=String(prep.reference_id||"");vars.site_url=await orbitfsStoreOrigin(req.url);vars.email_reference_id=referenceId;vars.email_refrence_id=referenceId;
 const subject=render(normalize(String(prep.subject||"")),vars);let bodyText=render(normalize(String(prep.text_body||subject)),vars),bodyHtml=render(normalize(String(prep.html||bodyText)),vars);if(referenceId&&!bodyText.includes(referenceId))bodyText+=`\n\nEmail reference: ${referenceId}`;if(referenceId&&!bodyHtml.includes(referenceId))bodyHtml+=`<p style="margin-top:24px;font-size:12px;color:#6b7280">Email reference: <strong>${referenceId}</strong></p>`;
 const key=process.env.RESEND_API_KEY;if(!key){await db.rpc("mail_outbox_finalize",{p_id:id,p_token:token,p_log_id:prep.log_id,p_provider_id:null,p_status:"failed",p_error:"Resend transport is not configured.",p_subject:subject});return Response.json({error:"Resend transport is not configured."},{status:503});}
 const identity=await resolveMailDeliveryIdentity(db,config,String(prep.from_account||config.outbound.default_from));
 const payload:any={from:`${identity.name} <${identity.from}>`,to:[String(prep.recipient)],subject,reply_to:identity.replyTo,headers:{"X-OrbitFS-Reference":referenceId},text:wrapOrbitFsText(bodyText),html:wrapOrbitFsHtml(bodyHtml)};
 const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify(payload),cache:"no-store"});const j:any=await providerJson(r),err=r.ok?null:(j.message||`Provider ${r.status}`);
 await db.rpc("mail_outbox_finalize",{p_id:id,p_token:token,p_log_id:prep.log_id,p_provider_id:j.id||null,p_status:r.ok?"sent":"failed",p_error:err,p_subject:subject});if(!r.ok)return Response.json({error:err,reference_id:referenceId},{status:r.status});return Response.json({ok:true,id:j.id,reference_id:referenceId,eventKey:prep.event_key});
}
