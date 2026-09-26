"use client";
import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";

const pretty=(v:any)=>String(v||"unknown").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());
const productName=(v:any)=>({orbitfs_base:"OrbitFS Base",orbitfs_apex:"OrbitFS APEX",orbitfs_mcp:"OrbitFS MCP",orbitfs_studio:"OrbitFS Studio"} as Record<string,string>)[String(v||"").toLowerCase()]||String(v||"OrbitFS");
const terminal=new Set(["fulfilled"]);

export default function FulfillmentPage(){
 const sb=useMemo(()=>createClient(),[]);
 const[rows,setRows]=useState<any[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(""),[msg,setMsg]=useState(""),[error,setError]=useState(""),[filter,setFilter]=useState("attention"),[licenseIds,setLicenseIds]=useState<Record<string,string>>({});
 async function token(){const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)throw Error("Administrator session expired.");return session.access_token}
 async function load(){setLoading(true);setError("");try{const t=await token();const r=await fetch("/api/admin/fulfillment",{headers:{Authorization:"Bearer "+t},cache:"no-store"});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||"Could not load fulfilment queue.");setRows(j.rows||[])}catch(e:any){setError(e?.message||"Could not load fulfilment queue.")}finally{setLoading(false)}}
 useEffect(()=>{void load()},[]);
 const groups=useMemo(()=>{const m=new Map<string,any>();for(const row of rows){const id=String(row.order_id);if(!m.has(id))m.set(id,{orderId:id,order:row.order,customer:row.customer,rows:[]});m.get(id).rows.push(row)}return [...m.values()]},[rows]);
 const visible=groups.filter((g:any)=>{const states=g.rows.map((r:any)=>String(r.state));if(filter==="attention")return states.some((s:string)=>!terminal.has(s));if(filter==="failed")return states.includes("failed");if(filter==="pending")return states.includes("pending");if(filter==="history")return states.every((s:string)=>terminal.has(s));return true});
 const count=(state:string)=>rows.filter(r=>String(r.state)===state).length;
 async function act(action:string,payload:any){setBusy(action+":"+String(payload.orderId||"global"));setError("");setMsg("");try{const t=await token();const r=await fetch("/api/admin/fulfillment",{method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json"},body:JSON.stringify({action,...payload})});const j=await r.json().catch(()=>({}));if(!r.ok||j?.ok===false)throw Error(j.error||"Fulfilment action failed.");setMsg(action==="sync-authority-links"?`Synced ${j.synced||0} License Manager licence(s) to Billing customers.`:action==="link-manual"?"Manual fulfilment completed and linked to the customer.":"Fulfilment retry completed.");await load()}catch(e:any){setError(e?.message||"Fulfilment action failed.")}finally{setBusy("")}}
 return <main className="adminShell orderOpsV3">
  <header className="adminTop"><div><p className="eyebrow">LICENSING · COMMERCE OPERATIONS</p><h1>Fulfilment Queue</h1><p className="muted">Paid OrbitFS orders waiting for License Manager linkage. Billing records the workflow; License Manager remains the licence authority.</p></div><div className="inlineActions"><button className="secondary" disabled={!!busy} onClick={()=>void act("sync-authority-links",{})}>{busy==="sync-authority-links:global"?"Syncing…":"Sync License Manager"}</button><Link className="buttonlink secondary" href="/admin/license-controller">License Controller</Link></div></header>
  <section className="stats four"><article><small>Pending</small><strong>{count("pending")}</strong><span>Waiting for automatic or manual action</span></article><article><small>Failed</small><strong>{count("failed")}</strong><span>Fix the error, then retry</span></article><article><small>Fulfilled</small><strong>{count("fulfilled")}</strong><span>Completed line items loaded</span></article><article><small>Orders</small><strong>{groups.length}</strong><span>Fulfilment records in this view</span></article></section>
  <nav className="recordTabs"><button className={filter==="attention"?"active":""} onClick={()=>setFilter("attention")}>Needs action</button><button className={filter==="pending"?"active":""} onClick={()=>setFilter("pending")}>Pending</button><button className={filter==="failed"?"active":""} onClick={()=>setFilter("failed")}>Failed</button><button className={filter==="history"?"active":""} onClick={()=>setFilter("history")}>History</button><button className={filter==="all"?"active":""} onClick={()=>setFilter("all")}>All</button></nav>
  {error&&<section className="panel"><div className="notice dangerBox"><b>Fulfilment action failed</b><span>{error}</span><button className="small secondary" onClick={()=>void navigator.clipboard?.writeText(error)}>Copy error</button></div></section>}
  {msg&&<p className="inlineStatus">{msg}</p>}
  <section className="panel">
   <div className="panelTitle"><div><h2>{filter==="attention"?"Orders requiring attention":filter==="history"?"Fulfilment history":pretty(filter)+" fulfilments"}</h2><p className="muted">Manual mode never creates a licence. Create/edit the licence in License Manager first, then enter its Base licence ID here.</p></div><button className="small secondary" onClick={()=>void load()} disabled={loading}>{loading?"Refreshing…":"Refresh"}</button></div>
   <div className="billingRecordList">{visible.map((g:any)=>{
    const failed=g.rows.filter((r:any)=>r.state==="failed"),pending=g.rows.filter((r:any)=>r.state==="pending"),fulfilled=g.rows.filter((r:any)=>r.state==="fulfilled");
    const manual=g.rows.some((r:any)=>r.mode==="manual"||r.metadata?.fulfillment_mode==="manual"||r.order?.metadata?.fulfillment_mode==="manual");
    const licenseValue=licenseIds[g.orderId]||"";
    return <article className="billingRecord" key={g.orderId} style={{display:"block"}}>
     <div className="panelTitle"><div><b>#{g.order?.order_number||g.orderId}</b><span>{g.customer?.name||"Customer"} · {g.customer?.customer_number||"No customer number"} · {g.customer?.email||"No email"}</span></div><div className="inlineActions"><span className={`billingState ${failed.length?"failed":pending.length?"pending":"active"}`}>{failed.length?failed.length+" failed":pending.length?pending.length+" pending":"Fulfilled"}</span><Link className="buttonlink small secondary" href={"/admin/orders/"+g.orderId}>Open order</Link></div></div>
     <div className="fulfillmentLineList">{g.rows.map((r:any)=><div className="adminItem" key={r.id}><div><b>{productName(r.item?.license_product_key||r.metadata?.license_product_key)}</b><span>{pretty(r.state)} · attempts {r.attempt_count||0}{r.license_id?" · Licence "+r.license_id:""}</span>{r.last_error&&<small style={{display:"block"}}>Error: {r.last_error}</small>}</div><div>{r.last_error&&<button className="small secondary" onClick={()=>void navigator.clipboard?.writeText(String(r.last_error))}>Copy error</button>}</div></div>)}</div>
     {(pending.length||failed.length)>0&&<div className="form" style={{marginTop:14}}>
      <div className="notice"><b>{manual?"Manual licence fulfilment":"Fulfilment recovery"}</b><span>{manual?"Create or edit the customer's Base licence in License Manager. Make sure the Billing customer ID and all purchased add-ons are set there, then enter that licence ID below.":"If the underlying problem is fixed, retry automatic fulfilment. You can also manually attach a correctly prepared authority licence."}</span></div>
      <label>License Manager Base licence ID<input value={licenseValue} onChange={e=>setLicenseIds(v=>({...v,[g.orderId]:e.target.value}))} placeholder="UUID from License Manager"/></label>
      <div className="inlineActions"><button disabled={!!busy||!licenseValue.trim()} onClick={()=>void act("link-manual",{orderId:g.orderId,licenseId:licenseValue.trim()})}>{busy==="link-manual:"+g.orderId?"Linking…":"Verify & fulfil manually"}</button>{!manual&&<button className="secondary" disabled={!!busy} onClick={()=>void act("retry",{orderId:g.orderId})}>{busy==="retry:"+g.orderId?"Retrying…":"Retry automatic fulfilment"}</button>}</div>
     </div>}
    </article>})}{!visible.length&&<div className="v3Empty">{loading?"Loading fulfilments…":"Nothing in this view."}</div>}</div>
  </section>
 </main>;
}
