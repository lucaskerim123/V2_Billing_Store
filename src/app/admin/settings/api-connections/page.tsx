"use client";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import Link from "next/link";

export default function ApiConnectionsSettings(){
 const [data,setData]=useState<any>(null),[busy,setBusy]=useState(false),[msg,setMsg]=useState(""),[error,setError]=useState("");
 const [masterUrl,setMasterUrl]=useState("");
 async function headers():Promise<Record<string,string>>{const {data:{session}}=await createClient().auth.getSession();return session?.access_token?{Authorization:`Bearer ${session.access_token}`}:{};}
 async function request(body?:any){const h=await headers();const r=await fetch("/api/admin/settings/license-master",{method:body?"POST":"GET",headers:{...h,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined,cache:"no-store"});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"API connection request failed");return j}
 async function load(){setBusy(true);setError("");try{const j=await request();setData(j);setMasterUrl(j.configuredUrl||"")}catch(e:any){setError(e?.message||"Unable to load API connections")}finally{setBusy(false)}}
 async function save(){setBusy(true);setMsg("");setError("");try{await request({action:"save",masterUrl});setMsg("Official License Manager API selected.");await load()}catch(e:any){setError(e?.message||"Could not save API connection")}finally{setBusy(false)}}
 async function test(){setBusy(true);setMsg("");setError("");try{const j=await request({action:"test"});setMsg(`Connected · ${j.latencyMs}ms · ${j.productCount} products`);await load()}catch(e:any){setError(e?.message||"Connection test failed")}finally{setBusy(false)}}
 useEffect(()=>{void load()},[]);
 const official=useMemo(()=>Array.isArray(data?.officialConnections)?data.officialConnections:[],[data]);
 const selected=official.find((x:any)=>x.base_url===masterUrl);
 const connection=data?.connection;
 return <main className="adminShell settingsCompact">
  <header className="adminTop"><div><p className="eyebrow">MY ORBITFS · API CONNECTIONS</p><h1>API Connections</h1><p className="muted">Billing Store can only connect to License Manager APIs published by the authoritative OrbitFS registry. Arbitrary URLs are rejected server-side.</p></div><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><Link className="buttonlink secondary" href="/admin/settings">System settings</Link><button className="buttonlink secondary" onClick={()=>void test()} disabled={busy}>{busy?"Working…":"Test selected API"}</button></div></header>

  <section className="panel"><div className="panelTitle"><div><p className="eyebrow">ACTIVE TECHNICAL AUTHORITY</p><h2>License Manager API</h2><p className="muted">This endpoint supplies licensing, release and deployment authority. Billing remains commerce/frontend only.</p></div><span className={connection?.last_error?"state waiting":"state ready"}>{connection?.last_error?"ERROR":"OFFICIAL"}</span></div>
   <div className="form">
    <label>Official API URL<input list="official-master-apis" value={masterUrl} onChange={e=>setMasterUrl(e.target.value)} placeholder="https://incendiarynetworks.cc/api/v1"/></label>
    <datalist id="official-master-apis">{official.map((x:any)=><option key={x.base_url} value={x.base_url}>{x.label}</option>)}</datalist>
    <label>Selected endpoint<input readOnly value={selected?.label||"Not an enabled official endpoint"}/></label>
    <label>Allowed use<input readOnly value="Billing → License Manager technical APIs"/></label>
    <label>Last successful test<input readOnly value={connection?.last_success_at?new Date(connection.last_success_at).toLocaleString():"Not tested"}/></label>
   </div>
   <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}><button className="buttonlink" onClick={save} disabled={busy||!masterUrl}>{busy?"Saving…":"Save official API"}</button><button className="buttonlink secondary" onClick={()=>{if(official[0]?.base_url)setMasterUrl(official[0].base_url)}} disabled={!official.length}>Use recommended</button></div>
   <p className="muted" style={{marginTop:10}}>You can paste/type a URL, but Billing will only save it when it exactly matches an enabled <code>billing_store</code> License Manager endpoint from the official registry.</p>
  </section>

  <section className="panel"><div className="panelTitle"><div><p className="eyebrow">LICENSE MANAGER REGISTRY</p><h2>Approved endpoints</h2><p className="muted">Read live from <code>/api/v1/api-connections</code>. This list is controlled in License Manager.</p></div><span className="state ready">{official.length} AVAILABLE</span></div>
   <div className="lmRuntimeList">{official.map((x:any)=><div key={x.base_url}><div><b>{x.label}</b><span>{x.base_url}</span></div><strong>{x.base_url===data?.configuredUrl?"Selected":"Available"}</strong></div>)}{!official.length&&<div><div><b>No registry entries returned</b><span>Billing will fall back only to the immutable canonical License Manager bootstrap URL.</span></div><strong>Fallback</strong></div>}</div>
  </section>

  <section className="panel"><h2>What belongs here</h2><div className="lmRuntimeList"><div><div><b>License Manager control API</b><span>Licensing, releases, entitlements, deployment authorization and runtime policy.</span></div><strong>Required</strong></div><div><div><b>Customer Vercel / Supabase</b><span>Customer deployment credentials and installation-specific URLs stay in the deployment execution workflow.</span></div><strong>Not here</strong></div><div><div><b>Dev Panel</b><span>Operational UI only. Billing does not route technical authority through Dev Panel.</span></div><strong>Not authority</strong></div></div></section>

  {msg&&<p className="inlineStatus">{msg}</p>}{error&&<p className="inlineStatus" style={{borderColor:"crimson"}}>{error}</p>}
 </main>;
}
