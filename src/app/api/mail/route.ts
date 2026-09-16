import {canUseMailbox,requireMailUser} from "@/lib/mail-auth";
import {loadMailRuntimeConfig} from "@/lib/mail-config-server";

const resendBase="https://api.resend.com";
const validFolders=new Set(["inbox","outbox","sent","spam","trash"]);
async function payload(r:Response){const text=await r.text();if(!text)return {};try{return JSON.parse(text)}catch{return {message:text}}}
function addressFrom(input:string,domain:string){const value=String(input||"").trim().toLowerCase();return value.includes("@")?value:`${value}@${domain}`}
function senderEmail(v:any){const s=Array.isArray(v)?String(v[0]||""):String(v||"");const m=s.match(/<([^>]+)>/);return (m?m[1]:s).trim().toLowerCase()}
function senderIp(m:any){return String(m?.sender_ip||m?.client_ip||m?.ip||"").trim()}
function resendMailKey(){return String(process.env.RESEND_MAIL_API_KEY||process.env.RESEND_API_KEY||"").trim()}
async function listRemote(key:string,endpoint:string){const r=await fetch(endpoint,{headers:{Authorization:`Bearer ${key}`},cache:"no-store"});const j:any=await payload(r);if(!r.ok)throw new Error(j?.message||`Mail provider returned ${r.status}.`);return j.data||[]}

export async function GET(req:Request){
 const ctx:any=await requireMailUser(req);if(ctx.error)return ctx.error;const config=await loadMailRuntimeConfig(ctx.db);
 const u=new URL(req.url),folder=String(u.searchParams.get("folder")||"inbox").toLowerCase(),address=addressFrom(u.searchParams.get("account")||u.searchParams.get("mailbox")||"admin",config.inbound.domain);
 if(!validFolders.has(folder))return Response.json({error:"Invalid folder."},{status:400});if(!await canUseMailbox(ctx,address,false))return Response.json({error:"You do not have access to this mailbox."},{status:403});
 await ctx.db.rpc("mail_purge_expired_trash",{p_address:address});if(folder==="outbox"){const {data,error}=await ctx.db.rpc("mail_get_outbox",{p_address:address});if(error)return Response.json({error:error.message},{status:500});return Response.json({address,folder,data:(data||[]).map((x:any)=>({...x,id:x.provider_id||x.id,direction:"outbound",folder:"outbox",from:x.sender,to:[x.recipient]}))});}
 const key=resendMailKey();if(!key)return Response.json({error:"Inbound/mailbox transport is not configured. Set RESEND_API_KEY (or RESEND_MAIL_API_KEY for a separate inbound key)."},{status:503});
 try{
  const [incoming,outgoing,stateResult]=await Promise.all([listRemote(key,`${resendBase}/emails/receiving?limit=100`),listRemote(key,`${resendBase}/emails?limit=100`),ctx.db.rpc("mail_get_message_states",{p_address:address})]);if(stateResult.error)return Response.json({error:stateResult.error.message},{status:500});
  const states=new Map((stateResult.data||[]).map((s:any)=>[String(s.provider_id),s]));
  const inbound=await Promise.all(incoming.filter((m:any)=>Array.isArray(m.to)&&m.to.some((x:string)=>String(x).toLowerCase()===address)).map(async(m:any)=>{const email=senderEmail(m.from),ip=senderIp(m);const chk=await ctx.db.rpc("mail_spam_check",{p_mailbox:address,p_email:email,p_ip:ip||null});await ctx.db.rpc("mail_record_sender_meta",{p_address:address,p_provider_id:String(m.id),p_email:email,p_ip:ip||null});const s:any=states.get(String(m.id)),autoSpam=chk.data?.decision==="blocked";return {...m,direction:"inbound",folder:autoSpam?"spam":(s?.folder||"inbox"),is_read:!!s?.is_read,spam_score:chk.data?.score||s?.spam_score||0,spam_reason:(chk.data?.reasons||[])[0]||s?.spam_reason||null,sender_ip:ip||s?.sender_ip||null}}));
  const outbound=outgoing.filter((m:any)=>String(m.from||"").toLowerCase().includes(address)).map((m:any)=>{const s:any=states.get(String(m.id));return {...m,direction:"outbound",folder:s?.folder||"sent",is_read:s?.is_read??true}});
  const data=[...inbound,...outbound].filter((m:any)=>m.folder===folder).sort((a:any,b:any)=>new Date(b.created_at||b.last_event_at||0).getTime()-new Date(a.created_at||a.last_event_at||0).getTime());return Response.json({address,folder,data});
 }catch(e:any){return Response.json({error:e.message||"Could not load mailbox."},{status:502})}
}

export async function PATCH(req:Request){
 const ctx:any=await requireMailUser(req);if(ctx.error)return ctx.error;const config=await loadMailRuntimeConfig(ctx.db),body=await req.json().catch(()=>({})),address=addressFrom(String(body.account||body.mailbox||"admin"),config.inbound.domain);
 if(!await canUseMailbox(ctx,address,false))return Response.json({error:"You do not have access to this mailbox."},{status:403});if(!body.id||!body.direction||!body.action)return Response.json({error:"Message, direction and action are required."},{status:400});
 const {data,error}=await ctx.db.rpc("mail_set_message_state",{p_address:address,p_provider_id:String(body.id),p_direction:String(body.direction),p_action:String(body.action),p_folder:body.folder?String(body.folder):null});if(error)return Response.json({error:error.message},{status:400});return Response.json({ok:true,state:data});
}

export async function POST(req:Request){
 const ctx:any=await requireMailUser(req);if(ctx.error)return ctx.error;const key=String(process.env.RESEND_API_KEY||"").trim();if(!key)return Response.json({error:"Outbound transport is not configured. Set RESEND_API_KEY."},{status:503});
 const config=await loadMailRuntimeConfig(ctx.db),body=await req.json().catch(()=>({})),address=addressFrom(String(body.account||body.mailbox||"admin"),config.inbound.domain);if(!await canUseMailbox(ctx,address,true))return Response.json({error:"You do not have send access to this mailbox."},{status:403});if(!body.to||!body.subject||(!body.text&&!body.html))return Response.json({error:"To, subject and message are required."},{status:400});
 const recipient=Array.isArray(body.to)?body.to.join(", "):String(body.to);const {data:identity}=await ctx.db.rpc("mail_sender_identity",{p_address:address});const senderName=String(identity?.display_name||config.outbound.sender_name);
 const {data:prep,error:pe}=await ctx.db.rpc("mail_prepare_delivery",{p_template_key:null,p_event_type:"manual",p_related_type:null,p_related_id:null,p_recipient:recipient,p_sender:address,p_subject:String(body.subject)});if(pe||!prep?.reference_id)return Response.json({error:pe?.message||"Could not prepare email record."},{status:500});
 const referenceId=String(prep.reference_id),logId=String(prep.id);const reqBody:any={from:`${senderName} <${address}>`,to:Array.isArray(body.to)?body.to:[String(body.to)],cc:body.cc?String(body.cc).split(",").map((x:string)=>x.trim()).filter(Boolean):undefined,bcc:body.bcc?String(body.bcc).split(",").map((x:string)=>x.trim()).filter(Boolean):undefined,subject:String(body.subject),text:body.text?String(body.text):undefined,html:body.html?String(body.html):undefined,reply_to:address,headers:{"X-OrbitFS-Reference":referenceId}};if(body.inReplyTo)reqBody.headers={...reqBody.headers,"In-Reply-To":String(body.inReplyTo),References:String(body.references||body.inReplyTo)};
 const r=await fetch(`${resendBase}/emails`,{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify(reqBody),cache:"no-store"});const j:any=await payload(r);if(!r.ok){await ctx.db.rpc("mail_finalize_delivery",{p_log_id:logId,p_provider_id:j.id||null,p_status:"failed",p_error:j?.message||`Mail provider returned ${r.status}.`,p_sent_at:null});return Response.json({error:j?.message||`Mail provider returned ${r.status}.`,reference_id:referenceId},{status:r.status})}
 await ctx.db.rpc("mail_set_message_state",{p_address:address,p_provider_id:String(j.id),p_direction:"outbound",p_action:"read",p_folder:null});await ctx.db.rpc("mail_finalize_delivery",{p_log_id:logId,p_provider_id:j.id||null,p_status:"sent",p_error:null,p_sent_at:new Date().toISOString()});return Response.json({ok:true,id:j.id,reference_id:referenceId});
}
