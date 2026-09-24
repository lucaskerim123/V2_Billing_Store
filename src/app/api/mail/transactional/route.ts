import {createClient} from "@supabase/supabase-js";
import {wrapOrbitFsHtml,wrapOrbitFsText} from "@/lib/mail-branding";
import {loadMailRuntimeConfig,resolveMailDeliveryIdentity} from "@/lib/mail-config-server";
import {orbitfsStoreOrigin} from "@/lib/site-origin";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const pub=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
function render(value:string,vars:Record<string,string>){return String(value||'').replace(/{{\s*([\w.]+)\s*}}/g,(_,k)=>vars[k]??'')}
async function providerJson(r:Response){const t=await r.text();if(!t)return {};try{return JSON.parse(t)}catch{return {message:t}}}
async function auth(req:Request){const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');if(!token)return null;const db=createClient(url,pub,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});const {data:{user}}=await db.auth.getUser(token);if(!user)return null;const [{data:allowed},{data:all}]=await Promise.all([db.rpc('has_permission',{p_permission:'mail.admin.send'}),db.rpc('has_permission',{p_permission:'all'})]);return allowed===true||all===true?{user,db}:null}

export async function POST(req:Request){
 const ctx:any=await auth(req);if(!ctx)return Response.json({error:'Permission denied.'},{status:403});
 const config=await loadMailRuntimeConfig(ctx.db),body=await req.json().catch(()=>({}));
 const eventKey=String(body.eventKey||body.eventType||''),recipient=String(body.to||'');let templateKey=String(body.templateKey||'');
 if(!templateKey&&eventKey){const {data:a,error:ae}=await ctx.db.rpc('mail_get_automation',{p_event_key:eventKey});if(ae)return Response.json({error:ae.message},{status:500});if(!a||!a.template_key)return Response.json({ok:true,skipped:true,eventKey});templateKey=String(a.template_key)}
 if(!templateKey||!recipient)return Response.json({error:'eventKey/templateKey and recipient are required.'},{status:400});
 const {data:t,error}=await ctx.db.rpc('mail_get_template',{p_template_key:templateKey});if(error||!t)return Response.json({error:'Mail template is disabled or missing.'},{status:404});
 const vars:Record<string,string>={};for(const [k,v] of Object.entries(body.vars||{}))vars[k]=String(v??'');const siteUrl=await orbitfsStoreOrigin(req.url);vars.site_url=siteUrl;
 const relatedType=String(body.relatedType||'').toLowerCase(),relatedId=body.relatedId?String(body.relatedId):'';if(relatedType==='invoice'&&relatedId)vars.invoice_url=`${siteUrl}/portal/invoices/${encodeURIComponent(relatedId)}`;
 let senderAccount=String(t.from_account||config.outbound.default_from);
 if(relatedType==='support_ticket'&&relatedId){const {data:sctx}=await ctx.db.rpc('support_ticket_mail_context',{p_ticket_id:relatedId});if(sctx?.department_email)senderAccount=String(sctx.department_email)}
 const identity=await resolveMailDeliveryIdentity(ctx.db,config,senderAccount);
 const {data:canSender}=await ctx.db.rpc('mail_can_send_address_admin',{p_address:identity.from});
 if(canSender!==true)return Response.json({error:`You do not have permission to send from ${identity.from}.`},{status:403});
 const previewSubject=render(t.subject,vars);
 const {data:prep,error:pe}=await ctx.db.rpc('mail_prepare_delivery',{p_template_key:templateKey,p_event_type:eventKey||String(body.eventType||templateKey),p_related_type:body.relatedType||null,p_related_id:body.relatedId?String(body.relatedId):null,p_recipient:recipient,p_sender:identity.from,p_subject:previewSubject});
 if(pe||!prep?.reference_id)return Response.json({error:pe?.message||'Could not prepare email record.'},{status:500});
 const referenceId=String(prep.reference_id),logId=String(prep.id);vars.email_reference_id=referenceId;vars.email_refrence_id=referenceId;vars.staff_name=String(prep.sent_by_name||'OrbitFS Staff');vars.staff_email=String(prep.sent_by_email||'');vars.staff_user_id=String(prep.sent_by_user_id||'');
 const subject=render(t.subject,vars);let bodyText=t.text_body?render(t.text_body,vars):subject,bodyHtml=t.html?render(t.html,vars):bodyText;if(!bodyText.includes(referenceId))bodyText+=`\n\nEmail reference: ${referenceId}`;if(!bodyHtml.includes(referenceId))bodyHtml+=`<p style="margin-top:24px;font-size:12px;color:#6b7280">Email reference: <strong>${referenceId}</strong></p>`;
 const key=process.env.RESEND_API_KEY;if(!key){await ctx.db.rpc('mail_finalize_delivery',{p_log_id:logId,p_provider_id:null,p_status:'failed',p_error:'Resend transport is not configured.',p_sent_at:null});return Response.json({error:'Resend transport is not configured.'},{status:503});}
 const payload:any={from:`${identity.name} <${identity.from}>`,to:[recipient],subject,reply_to:identity.replyTo,headers:{'X-OrbitFS-Reference':referenceId},text:wrapOrbitFsText(bodyText),html:wrapOrbitFsHtml(bodyHtml)};
 try{const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(payload),cache:'no-store'}),j:any=await providerJson(r);
 await ctx.db.rpc('mail_finalize_delivery',{p_log_id:logId,p_provider_id:j.id||null,p_status:r.ok?'sent':'failed',p_error:r.ok?null:(j.message||`Provider ${r.status}`),p_sent_at:r.ok?new Date().toISOString():null});
 if(!r.ok)return Response.json({error:j.message||'Email delivery failed.',reference_id:referenceId},{status:r.status});return Response.json({ok:true,id:j.id,reference_id:referenceId})}catch(error:any){const message=error?.message||'Email delivery failed.';try{await ctx.db.rpc('mail_finalize_delivery',{p_log_id:logId,p_provider_id:null,p_status:'failed',p_error:message,p_sent_at:null})}catch{}return Response.json({error:message,reference_id:referenceId},{status:502})}
}
