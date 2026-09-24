import {createClient} from "@supabase/supabase-js";
import {sendAutomation} from "@/lib/transactional-server";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY!;
const money=(c:any,currency="AUD")=>new Intl.NumberFormat("en-AU",{style:"currency",currency}).format(Number(c||0)/100);
export async function sendPaidLifecycleForInvoice(invoiceId:string){
 const db=createClient(url,serviceKey,{auth:{persistSession:false}});
 const {data:i}=await db.from("invoices").select("id,invoice_number,order_id,auth_user_id,status,total_cents,paid_cents,currency,due_at").eq("id",invoiceId).maybeSingle();
 if(!i||!(i.status==="paid"||Number(i.paid_cents||0)>=Number(i.total_cents||0)))return {ok:true,skipped:true,reason:"invoice_not_paid"};
 const [{data:o},{data:c},{data:p},{data:logs}]=await Promise.all([
  i.order_id?db.from("orders").select("id,order_number,status,payment_status,service_status,total_cents,currency,termination_reason").eq("id",i.order_id).maybeSingle():Promise.resolve({data:null}),
  db.from("customers").select("email,name").eq("auth_user_id",i.auth_user_id).maybeSingle(),
  db.from("user_profiles").select("display_name,first_name,last_name").eq("id",i.auth_user_id).maybeSingle(),
  db.from("mail_delivery_log").select("event_type,related_type,related_id,status").in("related_id",[String(i.id),...(i.order_id?[String(i.order_id)]:[])]).eq("status","sent")
 ]);
 const sent=new Set((logs||[]).map((x:any)=>`${x.event_type}|${x.related_type}|${x.related_id}`));
 const email=c?.email||"";if(!email)return {ok:true,skipped:true,reason:"no_customer_email"};
 const name=c?.name||p?.display_name||[p?.first_name,p?.last_name].filter(Boolean).join(" ")||"Customer",events:any[]=[];
 const run=async(eventKey:string,vars:any,type:string,id:string)=>{const k=`${eventKey}|${type}|${id}`;if(sent.has(k))return;const r=await sendAutomation(eventKey,email,vars,type,id);if(!r?.skipped){sent.add(k);events.push({eventKey,id})}};
 const invoiceDue=Math.max(0,Number(i.total_cents||0)-Number(i.paid_cents||0));
 await run("invoice.paid",{customer_name:name,invoice_number:i.invoice_number||"",invoice_total:money(i.total_cents,i.currency||"AUD"),invoice_due:money(invoiceDue,i.currency||"AUD"),due_date:i.due_at?new Date(i.due_at).toLocaleDateString("en-AU"):"No due date"},"invoice",String(i.id));
 if(o){const ov={customer_name:name,order_number:o.order_number||"",order_total:money(o.total_cents,o.currency||"AUD"),reason:o.termination_reason||""};await run("order.paid",ov,"order",String(o.id));const active=o.service_status==="active"||o.status==="active";if(active){const hadSuspended=sent.has(`service.suspended|order|${o.id}`);await run(hadSuspended?"service.restored":"service.activated",ov,"order",String(o.id));}}
 return {ok:true,events};
}
