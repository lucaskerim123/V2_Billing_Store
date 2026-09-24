import {createClient} from "@supabase/supabase-js";
import {sendAutomation} from "@/lib/transactional-server";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const pub=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
export async function POST(req:Request){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return Response.json({error:"Unauthorized"},{status:401});
  const db=createClient(url,pub,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
  const {data:{user}}=await db.auth.getUser(token);if(!user)return Response.json({error:"Unauthorized"},{status:401});
  const b=await req.json().catch(()=>({})),requestId=String(b.requestId||""),eventKey=String(b.eventKey||"");
  const allowed=["cancellation.requested","cancellation.scheduled","cancellation.denied","cancellation.completed"];
  if(!requestId||!allowed.includes(eventKey))return Response.json({error:"Invalid cancellation mail event."},{status:400});
  const {data:ctx,error}=await db.rpc("order_cancellation_mail_context",{p_request_id:requestId});
  if(error||!ctx?.email)return Response.json({error:error?.message||"Cancellation mail context unavailable."},{status:403});
  const valid=(eventKey==="cancellation.requested"&&ctx.status==="requested")||(eventKey==="cancellation.scheduled"&&ctx.status==="approved_scheduled")||(eventKey==="cancellation.denied"&&ctx.status==="denied")||(eventKey==="cancellation.completed"&&ctx.status==="completed");
  if(!valid)return Response.json({error:`Cancellation state does not match ${eventKey}.`},{status:409});
  const vars={customer_name:String(ctx.customer_name||"Customer"),order_number:String(ctx.order_number||""),reason:String(ctx.reason||""),staff_note:String(ctx.staff_note||"No additional note was provided."),scheduled_for:ctx.scheduled_for?new Date(ctx.scheduled_for).toLocaleString("en-AU",{timeZone:"Australia/Sydney"}):""};
  const {data:isStaff}=await db.rpc("is_staff");
  if(isStaff){
    const r=await fetch(`${new URL(req.url).origin}/api/mail/transactional`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({eventKey,to:String(ctx.email),vars,relatedType:"cancellation",relatedId:requestId}),cache:"no-store"});
    const d=await r.json().catch(()=>({}));return Response.json(d,{status:r.status});
  }
  try{return Response.json(await sendAutomation(eventKey,String(ctx.email),vars,"cancellation",requestId))}catch(e:any){return Response.json({error:e?.message||"Cancellation email failed."},{status:502})}
}
