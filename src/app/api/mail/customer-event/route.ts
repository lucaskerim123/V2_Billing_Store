import {createClient} from "@supabase/supabase-js";
import {sendAutomation} from "@/lib/transactional-server";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const pub=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
const service=process.env.SUPABASE_SERVICE_ROLE_KEY!;
const money=(c:any,currency="AUD")=>new Intl.NumberFormat("en-AU",{style:"currency",currency}).format(Number(c||0)/100);
export async function POST(req:Request){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return Response.json({error:"Authentication required."},{status:401});
  const auth=createClient(url,pub,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
  const {data:{user}}=await auth.auth.getUser(token);if(!user?.email)return Response.json({error:"Authentication required."},{status:401});
  const body=await req.json().catch(()=>({})),eventKey=String(body.eventKey||"");
  if(!["order.created","invoice.created","order.paid","invoice.paid"].includes(eventKey))return Response.json({error:"Unsupported customer event."},{status:400});
  const db=createClient(url,service,{auth:{persistSession:false}});let vars:Record<string,string>={customer_name:String(user.user_metadata?.display_name||user.user_metadata?.first_name||user.email)};
  if(eventKey.startsWith("order.")){
    const {data:o}=await db.from("orders").select("id,order_number,total_cents,currency,payment_status").eq("id",String(body.relatedId||"")).eq("auth_user_id",user.id).maybeSingle();
    if(!o)return Response.json({error:"Order not found for this account."},{status:404});
    if(eventKey==="order.paid"&&!String(o.payment_status||"").startsWith("paid"))return Response.json({error:"Order is not paid."},{status:409});
    vars={...vars,order_number:o.order_number,order_total:money(o.total_cents,o.currency||"AUD")};
    return Response.json(await sendAutomation(eventKey,user.email,vars,"order",o.id));
  }
  const {data:i}=await db.from("invoices").select("id,invoice_number,total_cents,paid_cents,currency,due_at,status").eq("id",String(body.relatedId||"")).eq("auth_user_id",user.id).maybeSingle();
  if(!i)return Response.json({error:"Invoice not found for this account."},{status:404});
  if(eventKey==="invoice.paid"&&!(i.status==="paid"||Number(i.paid_cents||0)>=Number(i.total_cents||0)))return Response.json({error:"Invoice is not paid."},{status:409});
  vars={...vars,invoice_number:i.invoice_number,invoice_total:money(i.total_cents,i.currency||"AUD"),invoice_due:money(Math.max(0,Number(i.total_cents||0)-Number(i.paid_cents||0)),i.currency||"AUD"),due_date:i.due_at?new Date(i.due_at).toLocaleDateString("en-AU"):"No due date",invoice_url:`${new URL(req.url).origin}/portal/invoices/${i.id}`};
  return Response.json(await sendAutomation(eventKey,user.email,vars,"invoice",i.id));
}
