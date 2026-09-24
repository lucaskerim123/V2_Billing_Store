import {createClient} from "@supabase/supabase-js";
import {sendAutomation} from "@/lib/transactional-server";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const pub=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
export async function POST(req:Request){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return Response.json({error:"Unauthorized"},{status:401});
  const db=createClient(url,pub,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
  const {data:{user}}=await db.auth.getUser(token);if(!user)return Response.json({error:"Unauthorized"},{status:401});
  const b=await req.json().catch(()=>({})),ticketId=String(b.ticketId||""),eventKey=String(b.eventKey||"");
  if(!ticketId||!eventKey)return Response.json({error:"ticketId and eventKey are required."},{status:400});
  const allowed=["support.ticket.created","support.ticket.replied","support.ticket.closed","support.ticket.reopened"];
  if(!allowed.includes(eventKey))return Response.json({error:"Unsupported support mail event."},{status:400});
  const {data:ctx,error:ce}=await db.rpc("support_ticket_mail_context",{p_ticket_id:ticketId});
  if(ce||!ctx?.email)return Response.json({error:ce?.message||"Ticket email context unavailable."},{status:403});
  if(eventKey==="support.ticket.closed"&&ctx.status!=="closed")return Response.json({error:"Ticket is not closed."},{status:409});
  if(eventKey==="support.ticket.reopened"&&ctx.status==="closed")return Response.json({error:"Ticket is not reopened."},{status:409});
  const origin=new URL(req.url).origin;
  const internalOrigin=(process.env.APP_URL||process.env.NEXT_PUBLIC_ORBITFS_STORE_URL||process.env.NEXT_PUBLIC_SITE_URL||origin||"https://orbitfsstore.vercel.app").replace(/\/+$/,"");
  const vars={customer_name:String(ctx.customer_name||"Customer"),ticket_number:String(ctx.ticket_number||""),ticket_subject:String(ctx.subject||""),reply_preview:String(b.replyPreview||"").slice(0,600),ticket_url:ctx.is_guest?`${origin}/support`:`${origin}/portal/support/${ticketId}`};
  const {data:isStaff}=await db.rpc("is_staff");
  if(isStaff){
    const r=await fetch(`${internalOrigin}/api/mail/transactional`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({eventKey,to:String(ctx.email),vars,relatedType:"support_ticket",relatedId:ticketId}),cache:"no-store"});
    const d=await r.json().catch(()=>({}));return Response.json(d,{status:r.status});
  }
  try{return Response.json(await sendAutomation(eventKey,String(ctx.email),vars,"support_ticket",ticketId))}catch(e:any){return Response.json({error:e?.message||"Support email failed."},{status:502})}
}
