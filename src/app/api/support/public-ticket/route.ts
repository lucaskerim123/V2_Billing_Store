import {createClient} from "@supabase/supabase-js";
import {createHash,randomBytes} from "crypto";
import {sendAutomation} from "@/lib/transactional-server";
import {orbitfsStoreUrl} from "@/lib/site-origin";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://xwbjfhpgsvsjaykelufa.supabase.co";
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY!;
const allowedGuestDepartments=new Set(["General Support","Sales Enquiries","Sales"]);

const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function formatGuestCode(raw:string){return (raw.match(/.{1,2}/g)||[raw]).join("-")}
function createGuestCode(){const bytes=randomBytes(6);let raw="";for(let i=0;i<6;i++)raw+=alphabet[bytes[i]%alphabet.length];return formatGuestCode(raw)}
function normalizeGuestCode(value:string){let raw=String(value||"").toUpperCase().replace(/[^A-Z0-9]/g,"");if(raw.startsWith("OFS"))raw=raw.slice(3);return raw}
function hashGuestCode(value:string){return createHash("sha256").update(normalizeGuestCode(value)).digest("hex")}
async function createUniqueGuestCode(service:any){for(let attempt=0;attempt<8;attempt++){const code=createGuestCode(),hash=hashGuestCode(code);const {data,error}=await service.from("support_tickets").select("id").eq("source","public_web").contains("metadata",{guest_access_hash:hash}).limit(1);if(error)throw error;if(!data?.length)return {code,hash}}throw new Error("Could not allocate a unique guest support code.")}

export async function POST(req:Request){
 const body=await req.json().catch(()=>({}));
 const bearer=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 const service=createClient(url,serviceKey,{auth:{persistSession:false}});
 const {data:settingRows}=await service.from("app_settings").select("key,value").in("key",["support.enabled","support.guest_enabled","support.guest_retention_hours","support.customer_priority_enabled","support.default_priority"]);
 const settings=Object.fromEntries((settingRows||[]).map((x:any)=>[x.key,x.value]));
 if(settings["support.enabled"]===false)return Response.json({error:"Support is temporarily unavailable."},{status:503});
 let user:any=null;
 if(bearer){const db=createClient(url,publicKey,{global:{headers:{Authorization:`Bearer ${bearer}`}},auth:{persistSession:false}});user=(await db.auth.getUser(bearer)).data.user}
 const name=String(body.name||"").trim(),email=String(body.email||"").trim().toLowerCase(),departmentId=String(body.department||""),subject=String(body.subject||"").trim(),message=String(body.body||"").trim();
 if(!subject||!message)return Response.json({error:"Subject and message are required."},{status:400});
 if(!user&&settings["support.guest_enabled"]===false)return Response.json({error:"Guest support is currently disabled. Please sign in to contact Support."},{status:403});
 if(!user&&(!name||!email||!email.includes("@")))return Response.json({error:"Your name and a valid email address are required."},{status:400});
 const {data:department}=await service.from("support_departments").select("id,name,enabled").eq("id",departmentId).maybeSingle();
 if(!department?.enabled)return Response.json({error:"Choose an available support department."},{status:400});
 if(!user&&!allowedGuestDepartments.has(String(department.name)))return Response.json({error:"Guest requests can only be sent to General Support or Sales."},{status:403});
 const ip=(req.headers.get("x-forwarded-for")||"").split(",")[0].trim()||"unknown";
 if(!user){
  const since=new Date(Date.now()-60*60*1000).toISOString();
  const {count}=await service.from("support_tickets").select("id",{count:"exact",head:true}).eq("source","public_web").contains("metadata",{request_ip:ip}).gte("created_at",since);
  if(Number(count||0)>=5)return Response.json({error:"Too many guest support requests. Please wait before opening another ticket."},{status:429});
 }
 let customerName=name,customerEmail=email;
 if(user){
  const [{data:p},{data:c}]=await Promise.all([service.from("user_profiles").select("display_name,first_name").eq("id",user.id).maybeSingle(),service.from("customers").select("name,email").eq("auth_user_id",user.id).maybeSingle()]);
  customerName=customerName||String(p?.display_name||p?.first_name||c?.name||"Customer");customerEmail=customerEmail||String(c?.email||user.email||"");
 }
 const now=new Date().toISOString();
 let guestCode:string|null=null,guestHash:string|null=null,guestExpiresAt:string|null=null;
 if(!user){try{const allocated=await createUniqueGuestCode(service);guestCode=allocated.code;guestHash=allocated.hash;const retentionHours=Math.min(168,Math.max(1,Number(settings["support.guest_retention_hours"]||48)));guestExpiresAt=new Date(Date.now()+retentionHours*60*60*1000).toISOString()}catch(e:any){return Response.json({error:e?.message||"Could not create guest ticket access."},{status:500})}}
 const guestMetadata=!user?{guest:true,guest_support_level:"basic",guest_access_hash:guestHash,guest_code_length:normalizeGuestCode(String(guestCode)).length,guest_access_expires_at:guestExpiresAt,request_ip:ip}:{};
 const defaultPriority=String(settings["support.default_priority"]||"normal");
 const requestedPriority=String(body.priority||defaultPriority);
 const priority=user&&settings["support.customer_priority_enabled"]!==false?requestedPriority:defaultPriority;
 const {data:ticket,error}=await service.from("support_tickets").insert({user_id:user?.id||null,department_id:department.id,subject,status:"open",priority,source:user?"customer_web":"public_web",last_client_reply_at:now,metadata:{...guestMetadata,contact_name:customerName,contact_email:customerEmail}}).select("id,ticket_number").single();
 if(error||!ticket)return Response.json({error:error?.message||"Could not open ticket."},{status:500});
 const {error:messageError}=await service.from("support_ticket_messages").insert({ticket_id:ticket.id,author_user_id:user?.id||null,author_role:"user",body:message,internal_note:false,attachments:[]});
 if(messageError){await service.from("support_tickets").delete().eq("id",ticket.id);return Response.json({error:messageError.message},{status:500})}
 if(!user&&customerEmail){try{const supportUrl=await orbitfsStoreUrl("/support",req.url);await sendAutomation("support.guest.created",customerEmail,{customer_name:customerName,ticket_number:String(ticket.ticket_number),ticket_subject:subject,guest_email:customerEmail,guest_code:String(guestCode),expires_at:new Date(String(guestExpiresAt)).toLocaleString("en-AU"),support_url:supportUrl},"support_ticket",ticket.id)}catch(e){console.error("guest support confirmation failed",e)}}
 return Response.json({ok:true,id:ticket.id,ticket_number:ticket.ticket_number,message:`Ticket #${ticket.ticket_number} opened.`,...(!user?{access_code:guestCode,expires_at:guestExpiresAt}: {})});
}
