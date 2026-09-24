"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { trackCustomerActivity } from "@/lib/customer-activity";

const money = (cents: number, currency = "AUD") => new Intl.NumberFormat("en-AU", { style: "currency", currency }).format((Number(cents || 0)) / 100);
const productPrice = (p: any) => p.metadata?.free_product ? "Free" : p.price_cents == null ? "Pricing not configured" : money(p.price_cents, p.currency || "AUD");

export default function Products() {
  const sb = createClient();
  const [items, setItems] = useState<any[]>([]);
  const [optionProducts, setOptionProducts] = useState<Set<string>>(new Set());
  const [storeText, setStoreText] = useState<Record<string,string>>({});
  const [cart, setCart] = useState<any>();
  const [gateways, setGateways] = useState<any[]>([]);
  const [gateway, setGateway] = useState("");
  const [coupon, setCoupon] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [catalogCfg,setCatalogCfg]=useState<any>({allowCoupons:true,allowAddons:true,hideOutOfStock:false,sortMode:"sort_order"});

  async function loadStore() {
    const [{ data: products }, { data: options }, { data: settings }, { data: cartData, error: cartError }, {data:cfgRows}] = await Promise.all([
      sb.from("products").select("id,slug,name,description,price_cents,currency,metadata,track_stock,stock_on_hand,stock_reserved,allow_backorders,sort_order,created_at").eq("active", true),
      sb.from("product_options").select("product_id").eq("active", true),
      sb.from("app_settings").select("key,value").eq("category","store"),
      sb.rpc("cart_summary"),
      sb.from("app_settings").select("key,value").in("key",["products.allow_coupons","products.allow_addons","products.hide_out_of_stock","products.sort_mode"])
    ]);
    const cfg=Object.fromEntries((cfgRows||[]).map((x:any)=>[x.key,x.value]));
    setCatalogCfg({allowCoupons:cfg["products.allow_coupons"]!==false,allowAddons:cfg["products.allow_addons"]!==false,hideOutOfStock:cfg["products.hide_out_of_stock"]===true,sortMode:String(cfg["products.sort_mode"]||"sort_order")});
    let visible=(products||[]).filter((p:any)=>!cfg["products.hide_out_of_stock"]||!p.track_stock||p.allow_backorders||(Number(p.stock_on_hand||0)-Number(p.stock_reserved||0)>0));
    const sortMode=String(cfg["products.sort_mode"]||"sort_order");
    visible=[...visible].sort((a:any,b:any)=>sortMode==="name"?String(a.name||"").localeCompare(String(b.name||"")):sortMode==="price"?Number(a.price_cents||0)-Number(b.price_cents||0):sortMode==="newest"?new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime():Number(a.sort_order||0)-Number(b.sort_order||0)||String(a.name||"").localeCompare(String(b.name||"")));
    setItems(visible);
    setOptionProducts(new Set((options || []).map((x:any) => x.product_id)));
    setStoreText(Object.fromEntries((settings || []).map((x:any) => [x.key.split(".").pop(), typeof x.value === "string" ? x.value : String(x.value ?? "")])));
    setCart(cartData || { items: [], item_count: 0, subtotal_cents: 0, discount_cents: 0, total_cents: 0 });
    setCoupon(cartData?.coupon_code || "");
    if (cartError) setMsg(cartError.message);

    const currency = cartData?.items?.[0]?.currency || products?.[0]?.currency || "AUD";
    const { data: g } = await sb.rpc("checkout_payment_gateways", { p_currency: currency });
    setGateways(g || []);
    if (g?.length) setGateway(current => current || g[0].code);
  }

  useEffect(() => { loadStore(); }, []);

  const base = useMemo(() => items.find(p => p.metadata?.component === "base") || items[0], [items]);
  const addons = useMemo(() => catalogCfg.allowAddons?items.filter(p => p !== base):[], [items, base, catalogCfg.allowAddons]);
  const hasOptions = (p:any) => optionProducts.has(p.id);

  async function directAdd(p:any) {
    setMsg(`Adding ${p.name}…`);
    const { error } = await sb.rpc("add_to_cart", { p_product_id: p.id, p_configuration: {} });
    if (error) {
      if (/own|duplicate|already/i.test(error.message || "")) setMsg(`You already own ${p.name}. Open the product to buy it as a gift.`);
      else setMsg(error.message);
      return;
    }
    setMsg(`${p.name} added to your basket.`);
    await trackCustomerActivity("cart.item_added",{entityType:"product",entityId:p.id,detail:{product_name:p.name}});
    await loadStore();
  }

  async function remove(id: string) {
    const { error } = await sb.rpc("remove_from_cart", { p_item_id: id });
    setMsg(error?.message || "Removed from basket.");
    if (!error) { await trackCustomerActivity("cart.item_removed",{entityType:"cart_item",entityId:id}); await loadStore(); }
  }

  async function clear() {
    if (!confirm("Clear your basket?")) return;
    const { error } = await sb.rpc("clear_cart");
    setMsg(error?.message || "Basket cleared.");
    if (!error) { await trackCustomerActivity("cart.cleared",{entityType:"cart"}); await loadStore(); }
  }

  async function applyCoupon() {
    const { error } = await sb.rpc("set_cart_coupon", { p_code: coupon });
    if (error) return setMsg(error.message);
    setMsg(coupon.trim() ? "Coupon applied." : "Coupon removed.");
    await trackCustomerActivity(coupon.trim()?"cart.coupon_applied":"cart.coupon_removed",{entityType:"cart",detail:{coupon:coupon.trim()||null}});
    await loadStore();
  }

  async function fulfilGifts(orderId:string) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.access_token) throw new Error("Authentication expired. Please sign in again.");
    const r=await fetch("/api/gifts/fulfill",{method:"POST",headers:{authorization:`Bearer ${session.access_token}`,"content-type":"application/json"},body:JSON.stringify({order_id:orderId})});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"Gift delivery could not finish.");
    return d;
  }

  async function sendCustomerEvent(eventKey:string,relatedId:string){
    const {data:{session}}=await sb.auth.getSession();
    if(!session?.access_token)throw new Error(`Could not send ${eventKey}: authentication expired.`);
    const r=await fetch("/api/mail/customer-event",{method:"POST",keepalive:true,headers:{authorization:`Bearer ${session.access_token}`,"content-type":"application/json"},body:JSON.stringify({eventKey,relatedId})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||`${eventKey} email failed.`);
    return d;
  }

  async function externalHandoff(attemptId: string) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.access_token) throw new Error("Authentication expired. Please sign in again.");
    const r = await fetch("/api/payments/start", { method: "POST", headers: { authorization: `Bearer ${session.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ attempt_id: attemptId }) });
    const data = await r.json();
    if (!r.ok || !data.url) throw new Error(data.error || "Payment gateway could not start.");
    void trackCustomerActivity("payment.handoff_started",{entityType:"payment_attempt",entityId:attemptId}).catch(()=>{});
    location.href = data.url;
  }

  async function checkout() {
    if (!cart?.item_count || busy) return;
    setBusy(true);
    setMsg("Creating order and invoice…");
    const { data, error } = await sb.rpc("checkout_cart", { p_pay_with_credit: false });
    if (error) { void trackCustomerActivity("checkout.failed",{entityType:"cart",success:false,detail:{error:error.message}}).catch(()=>{}); setBusy(false); return setMsg(error.message); }
    void trackCustomerActivity("checkout.order_created",{entityType:"order",entityId:data?.order_id,detail:{order_number:data?.order_number,invoice_id:data?.invoice_id,paid:!!data?.paid}}).catch(()=>{});
    void Promise.allSettled([sendCustomerEvent("order.created",data?.order_id),sendCustomerEvent("invoice.created",data?.invoice_id)]);
    if (data?.paid) {
      void Promise.allSettled([sendCustomerEvent("order.paid",data?.order_id),sendCustomerEvent("invoice.paid",data?.invoice_id)]);
      if(data?.contains_gifts){
        setMsg("Order completed. Delivering gift…");
        try{await fulfilGifts(data.order_id)}catch(e:any){setMsg(`Order paid, but gift delivery is waiting: ${e.message}`);setBusy(false);return;}
      }
      setMsg(`Order ${data.order_number} completed.`);
      location.href = `/portal/orders/${data.order_id}`;
      return;
    }
    if (!gateway) { setMsg(`Order ${data.order_number} created. Opening invoice…`); location.href = `/portal/invoices/${data.invoice_id}`; return; }
    setMsg("Starting payment…");
    const r = await sb.rpc("start_invoice_payment", { p_invoice_id: data.invoice_id, p_gateway_code: gateway });
    if (r.error) { setBusy(false); setMsg(`Invoice ${data.invoice_number} was created, but payment could not start: ${r.error.message}`); setTimeout(() => location.href = `/portal/invoices/${data.invoice_id}`, 1000); return; }
    if (r.data?.status === "action_required") {
      setMsg("Opening secure payment…");
      try {
        await externalHandoff(r.data.attempt_id);
      } catch (e: any) {
        setBusy(false);
        setMsg(`Payment could not open: ${e.message} Opening invoice so you can retry safely…`);
        setTimeout(() => location.href = `/portal/invoices/${data.invoice_id}`, 1600);
      }
      return;
    }
    if (r.data?.status === "pending") { setMsg(r.data.instructions || "Payment is pending. Follow the gateway instructions."); setTimeout(() => location.href = `/portal/invoices/${data.invoice_id}`, 1200); return; }
    setMsg(`Payment complete. Order ${data.order_number} is activating.`);
    setTimeout(() => location.href = `/portal/orders/${data.order_id}`, 500);
  }

  if (!cart) return <main className="portalPage">Loading OrbitFS Store…</main>;

  const baseFeatures = Array.isArray(base?.metadata?.store_features) ? base.metadata.store_features : [];

  return <main className="portalPage storePage">
    <header className="storeHero">
      <div><p className="eyebrow">{storeText.hero_eyebrow || "ORBITFS STORE"}</p><h1>{storeText.hero_title || "Build your OrbitFS setup"}</h1><p className="storeLead">{storeText.hero_lead || "Start with OrbitFS Base System, then add the components you need."}</p></div>
      <button className="storeCartJump secondary" type="button" onClick={() => document.getElementById("store-checkout")?.scrollIntoView({ behavior: "smooth" })}>Basket · {cart.item_count || 0}</button>
    </header>

    {base && <section className="storeBaseFeature">
      <div className="storeBaseCopy"><span className="pill">{base.metadata?.store_badge || "Core system"}</span><h2>{base.name}</h2><p>{base.description}</p>{baseFeatures.length>0&&<div className="storeBasePoints">{baseFeatures.map((x:string)=><span key={x}>{x}</span>)}</div>}</div>
      <div className="storeBaseAction"><small>{storeText.base_action_label || "Base system"}</small><strong>{productPrice(base)}</strong>{hasOptions(base)?<Link className="buttonlink" href={`/portal/products/${base.slug}`}>Configure {base.name}</Link>:<button onClick={()=>directAdd(base)}>Add to basket</button>}<Link href={`/portal/products/${base.slug}`}>Product details / gift →</Link></div>
    </section>}

    {!!addons.length && <section className="storeSection"><div className="storeSectionHead"><div><p className="eyebrow">{storeText.addons_eyebrow || "EXPAND ORBITFS"}</p><h2>{storeText.addons_title || "Add-ons"}</h2><p className="muted">{storeText.addons_lead || "Add only the capabilities you want."}</p></div></div>
      <div className="storeAddonList">{addons.map(p => <article className="storeAddonCard" key={p.slug}><div><span className="pill">{p.metadata?.store_badge || "Add-on"}</span><h3>{p.name}</h3><p>{p.description}</p></div><div className="storeAddonMeta"><strong>{productPrice(p)}</strong>{hasOptions(p)?<Link className="buttonlink" href={`/portal/products/${p.slug}`}>Configure & add</Link>:<button onClick={()=>directAdd(p)}>Add to basket</button>}<Link href={`/portal/products/${p.slug}`}>Details / gift →</Link></div></article>)}</div>
    </section>}

    <section className="storeCheckout" id="store-checkout">
      <div className="storeBasketPanel panel"><div className="panelTitle"><div><p className="eyebrow">YOUR ORDER</p><h2>Basket</h2></div>{cart.item_count > 0 && <button className="small secondary" onClick={clear}>Clear basket</button>}</div>
        {cart.items?.length ? cart.items.map((x: any) => <div className="storeBasketRow" key={x.id}><div><b>{x.name}</b><span>Qty {x.quantity}{x.configuration?.gift_recipient_email?` · Gift for ${x.configuration.gift_recipient_email}`:""}</span></div><strong>{money(x.line_total_cents, x.currency || "AUD")}</strong><button className="small danger" onClick={() => remove(x.id)}>Remove</button></div>) : <div className="storeEmpty"><b>Your basket is empty.</b><span>Choose a product above to start building your order.</span></div>}
      </div>

      <aside className="storeCheckoutPanel buybox"><div className="storeTotals"><div><span>Subtotal</span><b>{money(cart.subtotal_cents)}</b></div><div><span>Discount</span><b>-{money(cart.discount_cents)}</b></div>{Number(cart.tax_cents||0)>0&&<div><span>Tax</span><b>{money(cart.tax_cents)}</b></div>}<div className="storeTotal"><span>Total</span><strong>{money(cart.total_cents)}</strong></div></div>
        {catalogCfg.allowCoupons&&<div className="storeCheckoutBlock"><label>Coupon code</label><div className="couponApply"><input value={coupon} onChange={e => setCoupon(e.target.value.toUpperCase())} placeholder="Coupon code"/><button className="secondary" onClick={applyCoupon}>Apply</button></div></div>}
        <div className="storeCheckoutBlock"><label>Payment method</label>{gateways.length ? <div className="storeGatewayList">{gateways.map((g: any) => <label className={`storeGateway ${gateway === g.code ? "active" : ""}`} key={g.code}><input type="radio" name="gateway" checked={gateway === g.code} onChange={() => setGateway(g.code)}/><span><b>{g.name}</b><small>{g.description}</small></span></label>)}</div> : <div className="notice"><b>No online payment method enabled</b><span>You can still create the invoice and pay it later.</span></div>}</div>
        <button disabled={!cart.item_count || busy} onClick={checkout}>{busy ? "Processing…" : gateway ? "Place order & pay" : "Create invoice"}</button><small>Checkout creates one order and one invoice containing every selected OrbitFS product.</small>{!!msg && <p className="storeMessage">{msg}</p>}
      </aside>
    </section>
  </main>;
}
