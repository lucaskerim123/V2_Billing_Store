"use client";

import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

const money=(cents:number,currency="AUD")=>new Intl.NumberFormat("en-AU",{style:"currency",currency}).format(Number(cents||0)/100);
const label=(v:any)=>String(v||"").replaceAll("_"," ");

export default function Invoices(){
  const sb=useMemo(()=>createClient(),[]);
  const [rows,setRows]=useState<any[]>([]);
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
        const result=await sb.from("invoices").select("id,order_id,invoice_number,status,total_cents,paid_cents,currency,due_at,created_at").eq("auth_user_id",user.id).order("created_at",{ascending:false});
        if(result.error)throw result.error;
        if(alive)setRows(result.data||[]);
      }catch(e:any){if(alive)setError(e?.message||"Could not load invoices.")}
      finally{if(alive)setLoading(false)}
    })();
    return()=>{alive=false};
  },[sb]);

  const enriched=rows.map(i=>({...i,balance:Math.max(0,Number(i.total_cents||0)-Number(i.paid_cents||0))}));
  const statuses=useMemo(()=>Array.from(new Set(rows.map(i=>String(i.status||"")).filter(Boolean))),[rows]);
  const visible=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return enriched.filter(i=>{
      const state=i.balance===0?"paid":i.due_at&&new Date(i.due_at).getTime()<Date.now()?"overdue":String(i.status||"");
      const matchesStatus=status==="all"||state===status||String(i.status||"")===status;
      return matchesStatus&&(!q||String(i.invoice_number||"").toLowerCase().includes(q));
    });
  },[rows,query,status]);

  const totalDue=enriched.reduce((n,i)=>n+i.balance,0);
  const overdue=enriched.filter(i=>i.balance>0&&i.due_at&&new Date(i.due_at).getTime()<Date.now()).length;

  return <main className="portalPage v6cInvoicesPage">
    <section className="v6c-billing">
      <aside className="v6c-billing-nav" aria-label="Billing sections">
        <Link href="/portal/orders"><span>▣</span>Overview & Orders</Link>
        <Link className="is-active" href="/portal/invoices"><span>▤</span>Invoices</Link>
        <Link href="/portal/settings#wallet"><span>◴</span>Wallet & Payments</Link>
        <Link href="/portal/settings"><span>⚙</span>Billing Settings</Link>
      </aside>
      <div className="v6c-billing-main">
        <header className="v6c-billing-hero compact">
          <div><span className="v6c-badge">◆ INVOICES</span><h1>Review balances and open invoices.</h1><p>Find an invoice, check what is due and open the full payment document without leaving Billing.</p></div>
          <div className="v6c-billing-art" aria-hidden="true"><i/><b>＄</b><span/><em/></div>
        </header>

        <div className="v6c-billing-metrics three">
          <article><i>▤</i><div><small>TOTAL INVOICES</small><b>{rows.length}</b><span>billing records</span></div></article>
          <article><i>◷</i><div><small>OVERDUE</small><b>{overdue}</b><span>{overdue?"needs attention":"none overdue"}</span></div></article>
          <article><i>＄</i><div><small>AMOUNT DUE</small><b>{money(totalDue,rows[0]?.currency||"AUD")}</b><span>across open invoices</span></div></article>
        </div>

        <section className="v6c-billing-table">
          <div className="v6c-billing-section-head"><div><small>INVOICE LIST</small><h2>Your invoices</h2></div><Link href="/portal/orders">Orders →</Link></div>
          <div className="v6c-billing-controls">
            <label><span>Search invoices</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Invoice number"/></label>
            <label><span>Status</span><select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All statuses</option><option value="paid">Paid</option><option value="overdue">Overdue</option>{statuses.filter(s=>s!=="paid").map(s=><option key={s} value={s}>{label(s)}</option>)}</select></label>
          </div>
          <div className="v6c-invoice-row head"><span>INVOICE</span><span>STATUS</span><span>TOTAL</span><span>PAID</span><span>BALANCE</span><span>DUE</span><span/></div>
          {loading&&<div className="v6c-billing-empty">Loading invoices…</div>}
          {!loading&&error&&<div className="v6c-billing-empty error">{error}</div>}
          {!loading&&!error&&visible.map(i=>{
            const overdueRow=i.balance>0&&i.due_at&&new Date(i.due_at).getTime()<Date.now();
            return <Link className="v6c-invoice-row" href={"/portal/invoices/"+i.id} key={i.id}>
              <div><b>{i.invoice_number}</b><small>{new Date(i.created_at).toLocaleDateString()}</small></div>
              <span className={"v6c-bill-status "+(i.balance===0?"paid":overdueRow?"overdue":"unpaid")}>{i.balance===0?"Paid":overdueRow?"Overdue":label(i.status)||"Open"}</span>
              <b>{money(i.total_cents,i.currency||"AUD")}</b>
              <span>{money(i.paid_cents||0,i.currency||"AUD")}</span>
              <strong>{money(i.balance,i.currency||"AUD")}</strong>
              <span>{i.due_at?new Date(i.due_at).toLocaleDateString():"—"}</span>
              <em>Open →</em>
            </Link>;
          })}
          {!loading&&!error&&!visible.length&&<div className="v6c-billing-empty">No invoices match these filters.</div>}
        </section>
      </div>
    </section>
  </main>;
}
