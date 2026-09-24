import {createClient} from "@supabase/supabase-js";
import {createHash} from "crypto";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY!;
const allowedGuestDepartments=new Set(["General Support","Sales Enquiries","Sales"]);

function normalizeGuestCode(value:string){let raw=String(value||"").toUpperCase().replace(/[^A-Z0-9]/g,"");if(raw.startsWith("OFS"))raw=raw.slice(3);return raw}
function hashGuestCode(value:string){return createHash("sha256").update(normalizeGuestCode(value)).digest("hex")}
function publicDepartmentName(name:string){return name==="Sales Enquiries"?"Sales":name}
function requestIp(req:Request){return (req.headers.get("x-forwarded-for")||"").split(",")[0].trim()||"unknown"}

async function tooManyFailures(service:any,ip:string){const since=new Date(Date.now()-15*60*1000).toISOString();const {count}=await service.from("guest_support_access_attempts").select("id",{count:"exact",head:true}).eq("request_ip",ip).gte("attempted_at",since);return Number(count||0)>=20}
async function recordFailure(service:any,ip:string){try{await service.from("guest_support_access_attempts").insert({request_ip:ip})}catch{}}

async function findTicket(service:any,code:string){
 const clean=normalizeGuestCode(code);if(clean.length<6||clean.length>24)return {error:"Invalid guest ticket code.",status:404};
 const hash=hashGuestCode(clean);
 const {data:ticket,error}=await service.from("support_tickets").select("id,ticket_number,department_id,subject,status,priority,source,created_at,updated_at,metadata").eq("source","public_web").contains("metadata",{guest_access_hash:hash,guest_support_level:"basic"}).maybeSingle();
 if(error)return {error:"Could not open the guest ticket.",status:500};
 if(!ticket)return {error:"Invalid guest ticket code.",status:404};
 const expiresAt=String(ticket.metadata?.guest_access_expires_at||"");
 if(!expiresAt||Number.isNaN(new Date(expiresAt).getTime())||new Date(expiresAt).getTime()<=Date.now()){
  await service.from("support_tickets").delete().eq("id",ticket.id);
  return {error:"This guest ticket has expired and has been deleted.",status:410};
 }
 const {data:department}=await service.from("support_departments").select("id,name,enabled").eq("id",ticket.department_id).maybeSingle();
 if(!department?.enabled||!allowedGuestDepartments.has(String(department.name)))return {error:"This ticket is not available through guest support.",status:403};
 return {ticket,department,expiresAt};
}

async function ticketPayload(service:any,resolved:any){
 const {data:messages,error}=await service.from("support_ticket_messages").select("id,author_role,body,created_at,internal_note").eq("ticket_id",resolved.ticket.id).eq("internal_note",false).order("created_at",{ascending:true});
 if(error)return {error:error.message,status:500};
 return {ok:true,ticket:{id:resolved.ticket.id,ticket_number:resolved.ticket.ticket_number,subject:resolved.ticket.subject,status:resolved.ticket.status,priority:resolved.ticket.priority,department:publicDepartmentName(String(resolved.department.name)),created_at:resolved.ticket.created_at,updated_at:resolved.ticket.updated_at,expires_at:resolved.expiresAt},messages:messages||[]};
}

function payloadResponse(payload:any){return payload?.error?Response.json({error:payload.error},{status:payload.status||500}):Response.json(payload)}

export async function POST(req:Request){
 if(!url||!serviceKey)return Response.json({error:"Billing Store database is not configured."},{status:503});
 const service=createClient(url,serviceKey,{auth:{persistSession:false}}),body=await req.json().catch(()=>({})),action=String(body.action||"open"),code=String(body.code||""),ip=requestIp(req);
 const {data:supportSettings}=await service.from("app_settings").select("key,value").in("key",["support.enabled","support.guest_enabled"]);
 const cfg=Object.fromEntries((supportSettings||[]).map((x:any)=>[x.key,x.value]));
 if(cfg["support.enabled"]===false)return Response.json({error:"Support is temporarily unavailable."},{status:503});
 if(cfg["support.guest_enabled"]===false)return Response.json({error:"Guest support is currently disabled."},{status:403});
 if(await tooManyFailures(service,ip))return Response.json({error:"Too many incorrect ticket code attempts. Please wait 15 minutes and try again."},{status:429});
 const resolved:any=await findTicket(service,code);
 if(resolved.error){if(resolved.status===404)await recordFailure(service,ip);return Response.json({error:resolved.error},{status:resolved.status||400})}
 if(action==="open")return payloadResponse(await ticketPayload(service,resolved));
 if(action!=="reply")return Response.json({error:"Unsupported guest ticket action."},{status:400});
 const reply=String(body.body||"").trim();if(!reply)return Response.json({error:"Write a reply before sending."},{status:400});
 if(reply.length>12000)return Response.json({error:"Reply is too long."},{status:400});
 const now=new Date().toISOString();
 const {error:messageError}=await service.from("support_ticket_messages").insert({ticket_id:resolved.ticket.id,author_user_id:null,author_role:"user",body:reply,internal_note:false,attachments:[]});
 if(messageError)return Response.json({error:messageError.message},{status:500});
 const {error:updateError}=await service.from("support_tickets").update({status:"customer_reply",last_reply_at:now,last_client_reply_at:now,updated_at:now}).eq("id",resolved.ticket.id);
 if(updateError)return Response.json({error:updateError.message},{status:500});
 const refreshed:any=await findTicket(service,code);if(refreshed.error)return Response.json({error:refreshed.error},{status:refreshed.status||400});
 return payloadResponse(await ticketPayload(service,refreshed));
}
