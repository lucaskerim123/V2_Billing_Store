"use client";

import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

const money=(cents:number,currency="AUD")=>new Intl.NumberFormat("en-AU",{style:"currency",currency}).format(Number(cents||0)/100);
const text=(v:any)=>String(v||"").replaceAll("_"," ");

export default function OrdersAndInvoices(){
  const sb=useMemo(()=>createClient(),[]);
  const [orders,setOrders]=useState<any[]>([]);
  const [invoices,setInvoices]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [query,setQuery]=useState("");
  const [status,setStatus]=useState("all");

  useEffect(()=>{
    let alive=true;
    (async()=>{
      setLoading(true);setError("");
      try{
        const {data:{user}}=await sb.auth.getUser();
        if(!user)throw new Error("Your session has expired.");
        const [o,i]=await Promise.all([
          sb.from("orders").select("id,order_number,status,payment_status,fulfillment_status,total_cents,currency,created_at").eq("auth_user_id",user.id).order("created_at",{ascending:false}),
          sb.from("invoices").select("id,order_id,invoice_number,status,total_cents,paid_cents,currency,due_at,created_at").eq("auth_user_id",user.id).order("created_at",{ascending:false}),
        ]);
        if(o.error)throw o.error;
        if(i.error)throw i.error;
        if(!alive)return;
        setOrders(o.data||[]);
        setInvoices(i.data||[]);
      }catch(e:any){
        if(alive)setError(e?.message||"Could not load billing records.");
      }finally{if(alive)setLoading(false)}
    })();
    return()=>{alive=false};
  },[sb]);

  const orderStatuses=useMemo(()=>Array.from(new Set(orders.map(o=>String(o.status||"")).filter(Boolean))),[orders]);
  const filteredOrders=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return orders.filter(o=>{
      const matchesStatus=status==="all"||String(o.status||"")===status;
      const hay=`${o.order_number||""} ${o.status||""} ${o.payment_status||""} ${o.fulfillment_status||""}`.toLowerCase();
      return matchesStatus&&(!q||hay.includes(q));
    });
  },[orders,query,status]);

  const invoiceRows=invoices.map(i=>({...i,balance:Math.max(0,Number(i.total_cents||0)-Number(i.paid_cents||0))}));
  const paidCount=invoiceRows.filter(i=>i.balance===0||String(i.status).toLowerCase()==="paid").length;
  const outstandingCount=invoiceRows.filter(i=>i.balance>0).length;
  const overdueCount=invoiceRows.filter(i=>i.balance>0&&i.due_at&&new Date(i.due_at).getTime()<Date.now()).length;
  const activeOrders=orders.filter(o=>!["completed","cancelled","canceled","refunded","terminated"].includes(String(o.status||"").toLowerCase())).length;
  const recentInvoices=invoiceRows.slice(0,4);

  return <main className="portalPage recordsPage v6cBillingOverview">
    <section className="v6c-billing">
      <aside className="v6c-billing-nav" aria-label="Billing sections">
        <Link className="is-active" href="/portal/orders"><span>▣</span>Overview & Orders</Link>
        <Link href="/portal/invoices"><span>▤</span>Invoices</Link>
        <Link href="/portal/settings#wallet"><span>◴</span>Wallet & Payments</Link>
        <Link href="/portal/settings"><span>⚙</span>Billing Settings</Link>
      </aside>

      <div className="v6c-billing-main">
        <header className="v6c-billing-hero">
          <div>
            <span className="v6c-badge">◆ CLIENT BILLING</span>
            <h1>Orders, invoices and payments together.</h1>
            <p>Track purchases, open invoices, review payment state and jump into the exact billing record that needs attention.</p>
          </div>
          <div className="v6c-billing-art" aria-hidden="true"><i/><b>＄</b><span/><em/></div>
        </header>

        <div className="v6c-billing-metrics">
          <article><i>O</i><div><small>ACTIVE ORDERS</small><b>{activeOrders}</b><span>{orders.length} total orders</span></div></article>
          <article><i>▤</i><div><small>INVOICES</small><b>{invoices.length}</b><span>{paidCount} paid</span></div></article>
          <article><i>◷</i><div><small>OVERDUE</small><b>{overdueCount}</b><span>{overdueCount?"requires attention":"nothing overdue"}</span></div></article>
          <article><i>＄</i><div><small>OUTSTANDING</small><b>{outstandingCount}</b><span>{outstandingCount?"awaiting payment":"all clear"}</span></div></article>
        </div>

        <section className="v6c-billing-table v6c-orders-table">
          <div className="v6c-billing-section-head">
            <div><small>ORDERS</small><h2>Your purchases</h2></div>
            <Link href="/portal/invoices">View invoices →</Link>
          </div>
          <div className="v6c-billing-controls">
            <label><span>Search orders</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Order number or status"/></label>
            <label><span>Status</span><select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All statuses</option>{orderStatuses.map(s=><option key={s} value={s}>{text(s)}</option>)}</select></label>
          </div>
          <div className="v6c-order-row head"><span>ORDER</span><span>STATUS</span><span>PAYMENT</span><span>FULFILMENT</span><span>TOTAL</span><span/></div>
          {loading&&<div className="v6c-billing-empty">Loading orders…</div>}
          {!loading&&error&&<div className="v6c-billing-empty error">{error}</div>}
          {!loading&&!error&&filteredOrders.map(o=><Link href={"/portal/orders/"+o.id} className="v6c-order-row" key={o.id}>
            <div><b>#{o.order_number}</b><small>{new Date(o.created_at).toLocaleString()}</small></div>
            <span className="v6c-record-state">{text(o.status)}</span>
            <span>{text(o.payment_status)}</span>
            <span>{text(o.fulfillment_status)}</span>
            <b>{money(o.total_cents,o.currency||"AUD")}</b>
            <strong>View →</strong>
          </Link>)}
          {!loading&&!error&&!filteredOrders.length&&<div className="v6c-billing-empty">No orders match these filters.</div>}
        </section>

        <section className="v6c-billing-table v6c-recent-invoices">
          <div className="v6c-billing-section-head">
            <div><small>RECENT INVOICES</small><h2>Latest billing records</h2></div>
            <Link href="/portal/invoices">All invoices →</Link>
          </div>
          <div className="v6c-billing-row head"><span>INVOICE</span><span>ORDER</span><span>AMOUNT</span><span>DUE</span><span>STATUS</span><span/></div>
          {recentInvoices.map(i=><Link href={"/portal/invoices/"+i.id} className="v6c-billing-row" key={i.id}>
            <div><b>{i.invoice_number}</b><small>{new Date(i.created_at).toLocaleDateString()}</small></div>
            <span>{orders.find(o=>String(o.id)===String(i.order_id))?.order_number||"—"}</span>
            <b>{money(i.total_cents,i.currency||"AUD")}</b>
            <span>{i.due_at?new Date(i.due_at).toLocaleDateString():"—"}</span>
            <span className={"v6c-bill-status "+(i.balance===0?"paid":i.due_at&&new Date(i.due_at).getTime()<Date.now()?"overdue":"unpaid")}>{i.balance===0?"Paid":i.due_at&&new Date(i.due_at).getTime()<Date.now()?"Overdue":"Unpaid"}</span>
            <strong>Open →</strong>
          </Link>)}
          {!loading&&!error&&!recentInvoices.length&&<div className="v6c-billing-empty">No invoices yet.</div>}
        </section>
      </div>
    </section>

    <header className="portalTop recordsHeader"><div><p className="eyebrow">PURCHASES & BILLING</p><h1>Orders & Invoices</h1><p className="muted">Your purchases and billing records together in one place.</p></div></header>
    <div className="recordsSplit">
      <section className="recordsSection panel"><div className="recordsSectionHead"><div><p className="eyebrow">ORDERS</p><h2>Orders</h2></div><span className="recordsCount">{orders.length}</span></div>{orders.map(o=><Link className="recordCompactRow" href={"/portal/orders/"+o.id} key={o.id}><div className="recordPrimary"><b>#{o.order_number}</b><span>{new Date(o.created_at).toLocaleString()}</span></div><div className="recordStatus"><span className="recordBadge">{o.status}</span><small>{o.payment_status} · {o.fulfillment_status}</small></div><div className="recordAmount"><b>{money(o.total_cents,o.currency||"AUD")}</b><span>View order →</span></div></Link>)}</section>
      <section className="recordsSection panel"><div className="recordsSectionHead"><div><p className="eyebrow">INVOICES</p><h2>Invoices</h2></div><span className="recordsCount">{invoices.length}</span></div>{invoices.map(i=><Link className="recordCompactRow" href={"/portal/invoices/"+i.id} key={i.id}><div className="recordPrimary"><b>{i.invoice_number}</b><span>{new Date(i.created_at).toLocaleDateString()}</span></div><div className="recordStatus"><span className="recordBadge">{i.status}</span></div><div className="recordAmount"><b>{money(i.total_cents,i.currency||"AUD")}</b><span>View invoice →</span></div></Link>)}</section>
    </div>
  </main>;
}
