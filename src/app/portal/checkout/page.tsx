"use client";

import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import {trackCustomerActivity} from "@/lib/customer-activity";
import StoreFlowNav from "@/components/StoreFlowNav";

const money=(cents:number,currency="AUD")=>new Intl.NumberFormat("en-AU",{style:"currency",currency}).format(Number(cents||0)/100);

export default function CheckoutPage(){
  const sb=useMemo(()=>createClient(),[]);
  const [cart,setCart]=useState<any>(null);
  const [gateways,setGateways]=useState<any[]>([]);
  const [gateway,setGateway]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");

  async function load(){
    const {data,error}=await sb.rpc("cart_summary");
    if(error){
      setMessage(error.message);
      setCart({items:[],item_count:0,subtotal_cents:0,discount_cents:0,total_cents:0});
      return;
    }
    const next=data||{items:[],item_count:0,subtotal_cents:0,discount_cents:0,total_cents:0};
    setCart(next);
    const currency=next.items?.[0]?.currency||"AUD";
    const {data:g,error:gatewayError}=await sb.rpc("checkout_payment_gateways",{p_currency:currency});
    if(gatewayError)setMessage(gatewayError.message);
    setGateways(g||[]);
    if(g?.length)setGateway(current=>current||g[0].code);
  }

  useEffect(()=>{void load()},[sb]);

  async function fulfilGifts(orderId:string){
    const {data:{session}}=await sb.auth.getSession();
    if(!session?.access_token)throw new Error("Authentication expired. Please sign in again.");
    const response=await fetch("/api/gifts/fulfill",{method:"POST",headers:{authorization:"Bearer "+session.access_token,"content-type":"application/json"},body:JSON.stringify({order_id:orderId})});
    const body=await response.json();
    if(!response.ok)throw new Error(body.error||"Gift delivery could not finish.");
  }

  async function sendCustomerEvent(eventKey:string,relatedId:string){
    const {data:{session}}=await sb.auth.getSession();
    if(!session?.access_token)throw new Error("Authentication expired.");
    const response=await fetch("/api/mail/customer-event",{method:"POST",keepalive:true,headers:{authorization:"Bearer "+session.access_token,"content-type":"application/json"},body:JSON.stringify({eventKey,relatedId})});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.error||eventKey+" email failed.");
  }

  async function externalHandoff(attemptId:string){
    const {data:{session}}=await sb.auth.getSession();
    if(!session?.access_token)throw new Error("Authentication expired. Please sign in again.");
    const response=await fetch("/api/payments/start",{method:"POST",headers:{authorization:"Bearer "+session.access_token,"content-type":"application/json"},body:JSON.stringify({attempt_id:attemptId})});
    const body=await response.json();
    if(!response.ok||!body.url)throw new Error(body.error||"Payment gateway could not start.");
    void trackCustomerActivity("payment.handoff_started",{entityType:"payment_attempt",entityId:attemptId}).catch(()=>{});
    location.href=body.url;
  }

  async function checkout(){
    if(!cart?.item_count||busy)return;
    setBusy(true);
    setMessage("Creating order and invoice…");
    const {data,error}=await sb.rpc("checkout_cart",{p_pay_with_credit:false});
    if(error){
      void trackCustomerActivity("checkout.failed",{entityType:"cart",success:false,detail:{error:error.message}}).catch(()=>{});
      setMessage(error.message);setBusy(false);return;
    }

    void trackCustomerActivity("checkout.order_created",{entityType:"order",entityId:data?.order_id,detail:{order_number:data?.order_number,invoice_id:data?.invoice_id,paid:!!data?.paid}}).catch(()=>{});
    void Promise.allSettled([sendCustomerEvent("order.created",data?.order_id),sendCustomerEvent("invoice.created",data?.invoice_id)]);

    if(data?.paid){
      void Promise.allSettled([sendCustomerEvent("order.paid",data?.order_id),sendCustomerEvent("invoice.paid",data?.invoice_id)]);
      if(data?.contains_gifts){
        setMessage("Order completed. Delivering gift…");
        try{await fulfilGifts(data.order_id)}catch(e:any){setMessage("Order paid, but gift delivery is waiting: "+e.message);setBusy(false);return}
      }
      location.href="/portal/orders/"+data.order_id;
      return;
    }

    if(!gateway){
      location.href="/portal/invoices/"+data.invoice_id;
      return;
    }

    setMessage("Starting payment…");
    const payment=await sb.rpc("start_invoice_payment",{p_invoice_id:data.invoice_id,p_gateway_code:gateway});
    if(payment.error){
      setMessage("Invoice "+data.invoice_number+" was created, but payment could not start: "+payment.error.message);
      setBusy(false);
      setTimeout(()=>location.href="/portal/invoices/"+data.invoice_id,1200);
      return;
    }
    if(payment.data?.status==="action_required"){
      try{await externalHandoff(payment.data.attempt_id)}
      catch(e:any){
        setMessage("Payment could not open: "+e.message);
        setBusy(false);
        setTimeout(()=>location.href="/portal/invoices/"+data.invoice_id,1500);
      }
      return;
    }
    if(payment.data?.status==="pending"){
      setMessage(payment.data.instructions||"Payment is pending.");
      setTimeout(()=>location.href="/portal/invoices/"+data.invoice_id,1200);
      return;
    }
    setTimeout(()=>location.href="/portal/orders/"+data.order_id,500);
  }

  if(!cart)return <main className="portalPage storeFlowPage"><section className="v6c-loading-state">Loading checkout…</section></main>;
  const currency=cart.items?.[0]?.currency||"AUD";

  return <main className="portalPage storeFlowPage">
    <StoreFlowNav count={cart.item_count||0}/>

    <section className="storeFlowHeader">
      <div><p className="eyebrow">CHECKOUT</p><h1>Confirm and pay.</h1><p className="muted">Review the final total and choose an enabled payment method.</p></div>
      <Link className="storeTextAction" href="/portal/basket">← Back to basket</Link>
    </section>

    {!cart.item_count?<section className="panel storeEmpty"><b>Your basket is empty.</b><span>Add products before checking out.</span><Link className="storePrimaryAction" href="/portal/products">Browse Store</Link></section>:
    <div className="storeFlowGrid">
      <section className="panel storeCheckoutItems">
        <div className="panelTitle"><div><h2>Order review</h2><p className="muted">{cart.item_count} item{cart.item_count===1?"":"s"}</p></div></div>
        {cart.items.map((item:any)=><article className="storeBasketPageRow" key={item.id}>
          <div><b>{item.name}</b><span>Qty {item.quantity}{item.configuration?.gift_recipient_email?" · Gift for "+item.configuration.gift_recipient_email:""}</span></div>
          <strong>{money(item.line_total_cents,item.currency||currency)}</strong>
        </article>)}
        <div className="storeTotals checkoutTotals">
          <div><span>Subtotal</span><b>{money(cart.subtotal_cents,currency)}</b></div>
          <div><span>Discount</span><b>-{money(cart.discount_cents,currency)}</b></div>
          {Number(cart.tax_cents||0)>0&&<div><span>Tax</span><b>{money(cart.tax_cents,currency)}</b></div>}
          <div className="storeTotal"><span>Total</span><strong>{money(cart.total_cents,currency)}</strong></div>
        </div>
      </section>

      <aside className="panel storePaymentPanel">
        <div className="panelTitle"><div><p className="eyebrow">PAYMENT</p><h2>Payment method</h2></div></div>
        {gateways.length?<div className="storeGatewayList">{gateways.map((g:any)=><label className={"storeGateway "+(gateway===g.code?"active":"")} key={g.code}>
          <input type="radio" name="gateway" checked={gateway===g.code} onChange={()=>setGateway(g.code)}/>
          <span><b>{g.name}</b><small>{g.description}</small></span>
        </label>)}</div>:<div className="notice"><b>No online payment method enabled</b><span>You can still create the invoice and pay it later.</span></div>}
        <button className="storePrimaryAction storePayAction" disabled={busy} onClick={()=>void checkout()}>{busy?"Processing…":gateway?"Place order & pay":"Create invoice"}</button>
        <small>Checkout creates one order and one invoice containing the selected OrbitFS products.</small>
        {message&&<p className="storeMessage" role="status">{message}</p>}
      </aside>
    </div>}
  </main>;
}
