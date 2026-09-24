import {createClient} from "@supabase/supabase-js";
import {wrapOrbitFsHtml,wrapOrbitFsText} from "@/lib/mail-branding";
import {loadMailRuntimeConfig,resolveMailDeliveryIdentity} from "@/lib/mail-config-server";
import {orbitfsStoreOrigin} from "@/lib/site-origin";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY!;
const render=(v:string,vars:Record<string,string>)=>String(v||"").replace(/{{\s*([\w.]+)\s*}}/g,(_,k)=>vars[k]??"");
async function providerJson(r:Response){const t=await r.text();if(!t)return {};try{return JSON.parse(t)}catch{return {message:t}}}

export async function sendAutomation(eventKey:string,to:string,vars:Record<string,string>,relatedType?:string,relatedId?:string){
  if(!url||!serviceKey)throw new Error("Supabase service configuration is missing.");
  const db=createClient(url,serviceKey,{auth:{persistSession:false}});
  const config=await loadMailRuntimeConfig(db);
  const {data:a,error:ae}=await db.rpc("mail_get_automation",{p_event_key:eventKey});
  if(ae)throw ae;if(!a?.template_key)return {ok:true,skipped:true,eventKey};
  const {data:t,error:te}=await db.rpc("mail_get_template",{p_template_key:a.template_key});
  if(te||!t)throw new Error(te?.message||"Mail template is disabled or missing.");
  const siteUrl=await orbitfsStoreOrigin();
  const autoVars:Record<string,string>={...vars,site_url:siteUrl};
  if(relatedType==="invoice"&&relatedId&&!autoVars.invoice_url)autoVars.invoice_url=`${siteUrl}/portal/invoices/${relatedId}`;
  const identity=await resolveMailDeliveryIdentity(db,config,String(t.from_account||config.outbound.default_from));
  const subject0=render(t.subject,autoVars);
  const {data:prep,error:pe}=await db.rpc("mail_prepare_delivery",{p_template_key:a.template_key,p_event_type:eventKey,p_related_type:relatedType||null,p_related_id:relatedId||null,p_recipient:to,p_sender:identity.from,p_subject:subject0});
  if(pe||!prep?.reference_id)throw new Error(pe?.message||"Could not prepare email record.");
  const v:Record<string,string>={...autoVars,email_reference_id:String(prep.reference_id),email_refrence_id:String(prep.reference_id)};
  const subject=render(t.subject,v);let bodyText=t.text_body?render(t.text_body,v):subject,bodyHtml=t.html?render(t.html,v):bodyText;
  if(!bodyText.includes(String(prep.reference_id)))bodyText+=`\n\nEmail reference: ${prep.reference_id}`;
  if(!bodyHtml.includes(String(prep.reference_id)))bodyHtml+=`<p style="margin-top:24px;font-size:12px;color:#6b7280">Email reference: <strong>${prep.reference_id}</strong></p>`;
  const key=process.env.RESEND_API_KEY;
  if(!key){await db.rpc("mail_finalize_delivery",{p_log_id:String(prep.id),p_provider_id:null,p_status:"failed",p_error:"Resend transport is not configured.",p_sent_at:null});throw new Error("Resend transport is not configured.");}
  const payload:any={from:`${identity.name} <${identity.from}>`,to:[to],subject,reply_to:identity.replyTo,headers:{"X-OrbitFS-Reference":String(prep.reference_id)},text:wrapOrbitFsText(bodyText),html:wrapOrbitFsHtml(bodyHtml)};
  try{
    const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify(payload),cache:"no-store"});
    const j:any=await providerJson(r);
    await db.rpc("mail_finalize_delivery",{p_log_id:String(prep.id),p_provider_id:j.id||null,p_status:r.ok?"sent":"failed",p_error:r.ok?null:(j.message||`Provider ${r.status}`),p_sent_at:r.ok?new Date().toISOString():null});
    if(!r.ok)throw new Error(j.message||"Email delivery failed.");
    return {ok:true,id:j.id,reference_id:String(prep.reference_id)};
  }catch(error:any){
    const message=error?.message||"Email delivery failed.";
    try{await db.rpc("mail_finalize_delivery",{p_log_id:String(prep.id),p_provider_id:null,p_status:"failed",p_error:message,p_sent_at:null})}catch{}
    throw error;
  }
}
