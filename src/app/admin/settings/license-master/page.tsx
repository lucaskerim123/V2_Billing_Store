"use client";
import {useEffect,useState} from "react";
import {createClient} from "@/lib/supabase";
import Link from "next/link";

export default function LicenseMasterSettings(){
 const [data,setData]=useState<any>(null),[busy,setBusy]=useState(false),[editing,setEditing]=useState(false),[msg,setMsg]=useState(""),[error,setError]=useState("");
 const [masterUrl,setMasterUrl]=useState(""),[adminUrl,setAdminUrl]=useState("");
 async function headers():Promise<Record<string,string>>{const {data:{session}}=await createClient().auth.getSession();return session?.access_token?{Authorization:`Bearer ${session.access_token}`}:{};}
 async function request(body?:any){const h=await headers();const r=await fetch("/api/admin/settings/license-master",{method:body?"POST":"GET",headers:{...h,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined,cache:"no-store"});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"License Manager request failed");return j}
 async function load(test=false){setBusy(true);setMsg("");setError("");try{const j=test?await request({action:"test"}):await request();if(test){setMsg(`License Manager connected · ${j.latencyMs}ms · ${j.productCount} products`);await load(false);return}setData(j);setMasterUrl(j.configuredUrl||j.connection?.master_url||masterUrl);setAdminUrl(j.masterPanelUrl||j.connection?.admin_url||adminUrl)}catch(e:any){setError(e?.message||"License Manager unavailable")}finally{setBusy(false)}}
 async function saveConnection(){setBusy(true);setMsg("");setError("");try{await request({action:"save",masterUrl,adminUrl,enabled:true});setEditing(false);setMsg("License Manager connection saved.");await load(false)}catch(e:any){setError(e?.message||"Could not save connection")}finally{setBusy(false)}}
 useEffect(()=>{void load(false)},[]);
 const c=data?.connection,connections=Array.isArray(data?.connections)?data.connections:[],pulse=data?.pulse||{},authority=pulse?.authority||{},policy=pulse?.runtime_policy||{};
 const masterSettings=(data?.masterPanelUrl||"https://panel.incendiarynetworks.cc").replace(/\/+$/,"")+"/settings";
 return <main className="adminShell settingsCompact">
  <header className="adminTop"><div><p className="eyebrow">MY ORBITFS · LICENSE MANAGER CONNECTION</p><h1>License Manager connection</h1><p className="muted">Billing Store is a client. Technical licensing, release, deployment and runtime policy are configured only in License Manager.</p></div><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><a className="buttonlink" href={masterSettings} target="_blank" rel="noreferrer">Open authoritative settings</a><Link className="buttonlink secondary" href="/admin/licensing">Authority status</Link><button className="buttonlink secondary" onClick={()=>setEditing(v=>!v)} disabled={busy}>{editing?"Cancel":"Edit connection"}</button><button className="buttonlink secondary" onClick={()=>void load(true)} disabled={busy}>{busy?"Testing…":"Test connection"}</button></div></header>

  <section className="panel"><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}><div><h2>Billing connection</h2><p className="muted">This only tells Billing Store where the authoritative <code>/api/v1</code> service lives. It does not create licensing state.</p></div>{editing&&<button className="buttonlink" onClick={saveConnection} disabled={busy}>{busy?"Saving…":"Save connection"}</button>}</div>
   <div className="form"><label>License Manager API<input value={masterUrl} onChange={e=>setMasterUrl(e.target.value)} readOnly={!editing}/></label><label>Manager UI<input readOnly value={adminUrl}/></label><label>Status<input readOnly value={c?.enabled!==false?(c?.last_error?"Error":"Connected"):"Disabled"}/></label><label>Last successful test<input readOnly value={c?.last_success_at?new Date(c.last_success_at).toLocaleString():"Not tested"}/></label><label>Last error<input readOnly value={c?.last_error||"None"}/></label></div>
  </section>

  <section className="panel"><div className="panelTitle"><div><p className="eyebrow">LIVE AUTHORITY</p><h2>License Manager state</h2><p className="muted">Read live from License Manager. There are no Billing Store authority switches here.</p></div><span className={authority.system_enabled&&authority.licensing_enabled&&!authority.maintenance_mode?"state ready":"state waiting"}>{authority.system_enabled&&authority.licensing_enabled&&!authority.maintenance_mode?"ONLINE":"RESTRICTED"}</span></div>
   <div className="lmRuntimeList">
    <div><div><b>System API</b><span>Authoritative external API state.</span></div><strong>{authority.system_enabled?"ON":"OFF"}</strong></div>
    <div><div><b>Licensing</b><span>Validation, issuance and entitlement authority.</span></div><strong>{authority.licensing_enabled?"ON":"OFF"}</strong></div>
    <div><div><b>Release system</b><span>Technical release authority.</span></div><strong>{authority.release_system_enabled===false?"OFF":"ON"}</strong></div>
    <div><div><b>Deployment authorization</b><span>Base, Update and rollback authorization.</span></div><strong>{authority.deployment_enabled===false?"OFF":"ON"}</strong></div>
    <div><div><b>Maintenance</b><span>{authority.maintenance_mode?"Authority maintenance is active.":"Normal authority mode."}</span></div><strong>{authority.maintenance_mode?"ON":"OFF"}</strong></div>
   </div>
  </section>

  <section className="panel"><div className="panelTitle"><div><p className="eyebrow">LIVE RUNTIME POLICY</p><h2>Validation and pulse</h2><p className="muted">Read-only in Billing Store. Change these values in License Manager API Control.</p></div><span className="state ready">Pulse #{Number(pulse.pulse_revision||0)}</span></div>
   <div className="lmRuntimeList">
    <div><div><b>Validation cache TTL</b><span>Successful validation cache lifetime.</span></div><strong>{Number(policy.validation_ttl_seconds||0)}s</strong></div>
    <div><div><b>Pulse poll interval</b><span>Runtime authority refresh interval.</span></div><strong>{Number(policy.pulse_poll_seconds||0)}s</strong></div>
    <div><div><b>Failed validations</b><span>Lock guidance after repeated failures.</span></div><strong>{Number(policy.max_failed_validations||0)}</strong></div>
    <div><div><b>Offline grace</b><span>Authority-defined offline allowance.</span></div><strong>{policy.allow_offline_grace?`${Number(policy.offline_grace_seconds||0)}s`:"OFF"}</strong></div>
   </div>
   <div className="listrow"><div><b>Last pulse</b><span>{pulse.pulse_at?new Date(pulse.pulse_at).toLocaleString():"Never"} · {pulse.pulse_reason||"No reason recorded"}</span></div><a className="buttonlink secondary" href={masterSettings} target="_blank" rel="noreferrer">Manage in License Manager</a></div>
  </section>

  <section className="panel"><h2>Billing product connections</h2><p className="muted">Billing-owned product mappings connected to the canonical License Manager catalogue.</p><div className="lmRuntimeList">{connections.map((x:any)=><div key={x.code}><div><b>{x.code}</b><span>{x.master?.name||"Not found in License Manager"}</span></div><strong>{x.connected?"Connected":"Not connected"}</strong></div>)}{!connections.length&&<div><b>No product data</b><span>Test the connection to load the canonical catalogue.</span></div>}</div></section>
  {msg&&<p className="inlineStatus">{msg}</p>}{error&&<p className="inlineStatus" style={{borderColor:"crimson"}}>{error}</p>}
 </main>;
}
