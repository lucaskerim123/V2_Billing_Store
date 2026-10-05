"use client";

import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import {trackCustomerActivity} from "@/lib/customer-activity";
import StoreFlowNav from "@/components/StoreFlowNav";

const money=(cents:number,currency="AUD")=>new Intl.NumberFormat("en-AU",{style:"currency",currency}).format(Number(cents||0)/100);

export default function BasketPage(){
  const sb=useMemo(()=>createClient(),[]);
  const [cart,setCart]=useState<any>(null);
  const [coupon,setCoupon]=useState("");
  const [allowCoupons,setAllowCoupons]=useState(true);
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");
  const [confirmClear,setConfirmClear]=useState(false);

  async function load(){
    const [{data,error},{data:cfg}]=await Promise.all([
      sb.rpc("cart_summary"),
      sb.from("app_settings").select("key,value").eq("key","products.allow_coupons").maybeSingle()
    ]);
    if(error){setMessage(error.message);return}
    setCart(data||{items:[],item_count:0,subtotal_cents:0,discount_cents:0,total_cents:0});
    setCoupon(data?.coupon_code||"");
    setAllowCoupons(cfg?.value!==false);
  }

  useEffect(()=>{void load()},[sb]);

  async function remove(id:string){
    setBusy("remove:"+id);
    const {error}=await sb.rpc("remove_from_cart",{p_item_id:id});
    setMessage(error?.message||"Removed from basket.");
    if(!error)await trackCustomerActivity("cart.item_removed",{entityType:"cart_item",entityId:id});
    setBusy("");await load();
  }

  async function clear(){
    setBusy("clear");
    const {error}=await sb.rpc("clear_cart");
    setMessage(error?.message||"Basket cleared.");
    if(!error)await trackCustomerActivity("cart.cleared",{entityType:"cart"});
    setBusy("");setConfirmClear(false);await load();
  }

  async function applyCoupon(){
    setBusy("coupon");
    const {error}=await sb.rpc("set_cart_coupon",{p_code:coupon});
    if(error){setMessage(error.message);setBusy("");return}
    setMessage(coupon.trim()?"Coupon applied.":"Coupon removed.");
    await trackCustomerActivity(coupon.trim()?"cart.coupon_applied":"cart.coupon_removed",{entityType:"cart",detail:{coupon:coupon.trim()||null}});
    setBusy("");await load();
  }

  if(!cart)return <main className="portalPage storeFlowPage"><section className="v6c-loading-state">Loading basket…</section></main>;
  const currency=cart.items?.[0]?.currency||"AUD";

  return <main className="portalPage storeFlowPage">
    <StoreFlowNav count={cart.item_count||0}/>

    <section className="storeFlowHeader">
      <div><p className="eyebrow">YOUR BASKET</p><h1>Review your OrbitFS order.</h1><p className="muted">Check products, gifts and discounts before continuing to payment.</p></div>
      <Link className="storeTextAction" href="/portal/products">← Continue shopping</Link>
    </section>

    <div className="storeFlowGrid">
      <section className="panel storeBasketPagePanel">
        <div className="panelTitle"><div><h2>Basket</h2><p className="muted">{cart.item_count||0} item{cart.item_count===1?"":"s"}</p></div>{cart.item_count>0&&<button className="storeMinorButton" onClick={()=>void clear()} disabled={!!busy}>Clear basket</button>}</div>
        {cart.items?.length?cart.items.map((item:any)=><article className="storeBasketPageRow" key={item.id}>
          <div><b>{item.name}</b><span>Qty {item.quantity}{item.configuration?.gift_recipient_email?" · Gift for "+item.configuration.gift_recipient_email:""}</span></div>
          <strong>{money(item.line_total_cents,item.currency||currency)}</strong>
          <button className="storeMinorButton" disabled={!!busy} onClick={()=>void remove(item.id)}>{busy==="remove:"+item.id?"Removing…":"Remove"}</button>
        </article>):<div className="storeEmpty"><b>Your basket is empty.</b><span>Add a product from the OrbitFS Store to continue.</span><Link className="storePrimaryAction" href="/portal/products">Browse Store</Link></div>}
      </section>

      <aside className="panel storeBasketSummary">
        <div className="panelTitle"><div><p className="eyebrow">ORDER SUMMARY</p><h2>Totals</h2></div></div>
        <div className="storeTotals">
          <div><span>Subtotal</span><b>{money(cart.subtotal_cents,currency)}</b></div>
          <div><span>Discount</span><b>-{money(cart.discount_cents,currency)}</b></div>
          {Number(cart.tax_cents||0)>0&&<div><span>Tax</span><b>{money(cart.tax_cents,currency)}</b></div>}
          <div className="storeTotal"><span>Total</span><strong>{money(cart.total_cents,currency)}</strong></div>
        </div>
        {allowCoupons&&<div className="storeCheckoutBlock"><label>Coupon code</label><div className="couponApply"><input value={coupon} onChange={e=>setCoupon(e.target.value.toUpperCase())} placeholder="Coupon code"/><button className="storeMinorButton" onClick={()=>void applyCoupon()} disabled={!!busy}>{busy==="coupon"?"Applying…":"Apply"}</button></div></div>}
        <Link className={"storePrimaryAction storeCheckoutAction"+(!cart.item_count?" disabled":"")} aria-disabled={!cart.item_count} href={cart.item_count?"/portal/checkout":"/portal/basket"}>Continue to checkout →</Link>
        {message&&<p className="storeMessage" role="status">{message}</p>}
      </aside>
    </div>
  </main>;
}
