"use client";
import {use,useEffect,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";
import {usePermissions} from "@/lib/usePermissions";
import InvoiceAdminTabs from "@/components/InvoiceAdminTabs";

export default function InvoicePayments({params}:{params:Promise<{id:string}>}){
 const {id}=use(params),sb=createClient(),{can}=usePermissions();
 const [inv,setInv]=useState<any>(),[payments,setPayments]=useState<any[]>([]),[amount,setAmount]=useState(""),[method,setMethod]=useState("manual"),[ref,setRef]=useState(""),[msg,setMsg]=useState("");
 async function load(){const {data:i}=await sb.from("invoices").select("*").eq("id",id).single();if(!i)return;const {data:p}=await sb.from("invoice_payments").select("*").eq("invoice_id",id).order("created_at",{ascending:false});setInv(i);setPayments(p||[]);setAmount(Math.max(0,(Number(i.total_cents)-Number(i.paid_cents||0))/100).toFixed(2))}
 useEffect(()=>{load()},[id]);
 async function record(){
  const cents=Math.round(Number(amount||0)*100);
  if(cents<=0){setMsg("Enter a payment amount greater than zero.");return}
  setMsg("");
  const {error}=await sb.rpc("admin_record_invoice_payment",{p_invoice_id:id,p_amount_cents:cents,p_method:method,p_reference:ref||null});
  if(error){setMsg(error.message);return}
  setRef("");
  const {data:updated,error:invoiceError}=await sb.from("invoices").select("id,order_id,status,paid_cents,total_cents").eq("id",id).single();
  if(invoiceError){setMsg("Payment recorded, but the updated invoice could not be reloaded: "+invoiceError.message);await load();return}
  const fullyPaid=String(updated?.status||"").toLowerCase()==="paid"||Number(updated?.paid_cents||0)>=Number(updated?.total_cents||0);
  if(fullyPaid&&updated?.order_id){
   try{
    const {data:{session}}=await sb.auth.getSession();
    if(!session?.access_token)throw new Error("Administrator session expired before fulfilment.");
    const response=await fetch("/api/admin/license-master/fulfill",{method:"POST",headers:{Authorization:"Bearer "+session.access_token,"Content-Type":"application/json"},body:JSON.stringify({orderId:String(updated.order_id)})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok||result?.ok===false)throw new Error(result?.error||result?.reason||"License fulfilment did not complete.");
    setMsg(result?.skipped?"Payment recorded. Fulfilment queued: "+String(result.reason||"waiting for License Manager")+".":"Payment recorded and licence fulfilment completed.");
   }catch(e:any){
    setMsg("Payment recorded, but licence fulfilment failed: "+String(e?.message||e));
   }
  }else setMsg("Payment recorded.");
  await load();
 }
 if(!inv)return <main className="adminShell">Loading payments…</main>;
 const due=Math.max(0,Number(inv.total_cents)-Number(inv.paid_cents||0));
 return <main className="adminShell invoiceAdminPage"><header className="adminTop"><div><p className="eyebrow">INVOICE PAYMENTS</p><h1>{inv.invoice_number}</h1><p className="muted">Record manual payments and review the complete payment history for this invoice.{!inv.order_id?" This is a standalone invoice with no linked order.":""}</p></div><div className="inlineActions"><Link href={`/admin/customers/${inv.auth_user_id}`}>Open customer →</Link>{inv.order_id&&<Link href={`/admin/orders/${inv.order_id}`}>Open order →</Link>}</div></header>
 <InvoiceAdminTabs invoiceId={id}/>
 <section className="stats four invoiceStats"><article><small>Total</small><strong>${(Number(inv.total_cents)/100).toFixed(2)}</strong></article><article><small>Paid</small><strong>${(Number(inv.paid_cents||0)/100).toFixed(2)}</strong></article><article><small>Due</small><strong>${(due/100).toFixed(2)}</strong></article><article><small>Payments</small><strong>{payments.length}</strong></article></section>
 <div className="invoiceTwoCol"><section className="panel"><div className="sectionHead"><div><h2>Record payment</h2><p className="muted">Manual entries are added to the invoice ledger and billing history.</p></div></div><div className="form"><label>Amount<input type="number" min="0" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>Payment method<select value={method} onChange={e=>setMethod(e.target.value)}><option value="manual">Manual</option><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="account_credit">Account credit</option><option value="other">Other</option></select></label><label>Reference<input value={ref} onChange={e=>setRef(e.target.value)} placeholder="Transaction / receipt reference"/></label>{can("invoices.record_payment")&&<button onClick={record}>Record payment</button>}</div></section>
 <section className="panel"><div className="sectionHead"><div><h2>Payment history</h2><p className="muted">Every payment recorded against this invoice, newest first.</p></div></div><div className="paymentLedger">{payments.length?payments.map(p=><article className="paymentRow" key={p.id}><div><b>{String(p.method||"payment").replaceAll("_"," ")}</b><span>{p.external_reference||"No reference"}</span></div><div><strong>${(Number(p.amount_cents||0)/100).toFixed(2)}</strong><span>{new Date(p.created_at).toLocaleString()}</span></div></article>):<div className="emptyState"><b>No payments recorded</b><span>This invoice has no payment ledger entries yet.</span></div>}</div></section></div>
 {msg&&<p className="inlineStatus">{msg}</p>}</main>;
}
