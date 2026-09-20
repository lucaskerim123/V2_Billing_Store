import {createClient} from "@supabase/supabase-js";
import {wrapOrbitFsHtml,wrapOrbitFsText} from "@/lib/mail-branding";
import {loadMailRuntimeConfig,resolveMailDeliveryIdentity} from "@/lib/mail-config-server";
import {orbitfsStoreOrigin} from "@/lib/site-origin";
async function providerJson(r:Response){const t=await r.text();if(!t)return {};try{return JSON.parse(t)}catch{return {message:t}}}
export async function drainMailOutbox(){
 const url=String(process.env.NEXT_PUBLIC_SUPABASE_URL||"").trim(),key=String(process.env.SUPABASE_SERVICE_ROLE_KEY||"").trim(),resend=String(process.env.RESEND_API_KEY||"").trim();
 if(!url||!key||!resend)return {processed:0,sent:0,failed:0};
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),now=new Date().toISOString();
 const q=await db.from("mail_event_outbox").select("id,dispatch_token").in("state",["pending","processing"]).lte("next_attempt_at",now).order("created_at").limit(20);
 if(q.error)throw q.error;const config=await loadMailRuntimeConfig(db);let sent=0,failed=0;
 for(const row of q.data||[]){try{
  const p=await db.rpc("mail_outbox_prepare",{p_id:String(row.id),p_token:String(row.dispatch_token)});if(p.error)throw p.error;const prep:any=p.data;if(prep?.skip)continue;
  const recipient=String(prep?.recipient||"").trim();if(!recipient)throw new Error("Mail queue recipient is missing.");
  const identity=await resolveMailDeliveryIdentity(db,config,String(prep?.from_account||config.outbound.default_from));
  const vars:Record<string,string>={};for(const [k,v] of Object.entries(prep?.vars||{}))vars[k]=String(v??"");vars.site_url=await orbitfsStoreOrigin();vars.email_reference_id=String(prep?.reference_id||"");
  const render=(v:string)=>String(v||"").replace(/{{\s*([\w.]+)\s*}}/g,(_:string,k:string)=>vars[k]??"");
  const subject=render(String(prep?.subject||""));const textBody=render(String(prep?.text_body||subject)),html=render(String(prep?.html||textBody));
  const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+resend,"Content-Type":"application/json"},body:JSON.stringify({from:identity.name+" <"+identity.from+">",to:[recipient],subject,reply_to:identity.replyTo,headers:{"X-OrbitFS-Reference":vars.email_reference_id},text:wrapOrbitFsText(textBody),html:wrapOrbitFsHtml(html)}),cache:"no-store"});
  const j:any=await providerJson(r),err=r.ok?null:(j.message||("Provider "+r.status));
  const fin=await db.rpc("mail_outbox_finalize",{p_id:String(row.id),p_token:String(row.dispatch_token),p_log_id:String(prep.log_id),p_provider_id:j.id||null,p_status:r.ok?"sent":"failed",p_error:err,p_subject:subject});if(fin.error)throw fin.error;
  if(!r.ok)throw new Error(err||"Email delivery failed.");sent++;
 }catch(e){failed++;}
 }
 return {processed:(q.data||[]).length,sent,failed};
}