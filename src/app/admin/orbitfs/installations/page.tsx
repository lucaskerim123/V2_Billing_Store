"use client";

import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";

type Installation=any;

function displayVersion(value:any){
  const raw=String(value||"").trim();
  if(!raw)return "—";
  return raw.startsWith("v")?raw:`v${raw}`;
}
function displayDate(value:any){
  if(!value)return "—";
  const date=new Date(value);
  return Number.isNaN(date.getTime())?"—":date.toLocaleString();
}
function safeUrl(value:any){
  const raw=String(value||"").trim();
  if(!raw)return "";
  return /^https?:\/\//i.test(raw)?raw:`https://${raw}`;
}
function domainOf(value:any){
  const raw=safeUrl(value);
  if(!raw)return "";
  try{return new URL(raw).hostname}catch{return String(value||"")}
}

export default function InstallationsPage(){
  const sb=useMemo(()=>createClient(),[]);
  const [items,setItems]=useState<Installation[]>([]);
  const [loading,setLoading]=useState(true);
  const [checking,setChecking]=useState(false);
  const [message,setMessage]=useState("");
  const [query,setQuery]=useState("");
  const [filter,setFilter]=useState<"all"|"locked"|"attention">("all");
  const [lockTarget,setLockTarget]=useState<Installation|null>(null);
  const [lockReason,setLockReason]=useState("");
  const [busyId,setBusyId]=useState<string|null>(null);
  const [fetchedAt,setFetchedAt]=useState<string|null>(null);

  async function load(kind:"initial"|"manual"="manual"){
    if(kind==="manual"){setChecking(true);setMessage("Checking License Manager for new or changed installations…");}
    else setLoading(true);
    try{
      const {data:{session}}=await sb.auth.getSession();
      if(!session?.access_token)throw new Error("Administrator session expired.");
      const response=await fetch("/api/admin/orbitfs/installations",{headers:{authorization:`Bearer ${session.access_token}`},cache:"no-store"});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data?.error||"Could not load installations.");
      setItems(Array.isArray(data.installations)?data.installations:[]);
      setFetchedAt(data.fetched_at||new Date().toISOString());
      if(kind==="manual")setMessage(`Check complete. ${Array.isArray(data.installations)?data.installations.length:0} installation${data.installations?.length===1?"":"s"} loaded from Billing + License Manager authority.`);
    }catch(error:any){
      setMessage(error?.message||"Could not load installations.");
    }finally{
      setLoading(false);
      setChecking(false);
    }
  }

  useEffect(()=>{void load("initial")},[]);

  async function setLock(item:Installation,action:"lock"|"unlock",reason?:string){
    setBusyId(item.installation_id);
    setMessage(action==="lock"?"Locking deployment in License Manager…":"Unlocking deployment in License Manager…");
    try{
      const {data:{session}}=await sb.auth.getSession();
      if(!session?.access_token)throw new Error("Administrator session expired.");
      const response=await fetch("/api/admin/orbitfs/installations",{
        method:"POST",
        headers:{authorization:`Bearer ${session.access_token}`,"content-type":"application/json"},
        body:JSON.stringify({
          action,
          installation_id:item.installation_id,
          license_id:item.license_id||undefined,
          reason:action==="lock"?String(reason||"").trim():undefined,
        }),
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data?.error||`Could not ${action} deployment.`);
      const authority=data?.result?.installation||data?.result?.result?.installation||null;
      setItems(current=>current.map(row=>{
        if(row.installation_id!==item.installation_id)return row;
        return {...row,deployment_lock:{
          ...row.deployment_lock,
          locked:action==="lock",
          reason:action==="lock"?(authority?.deployment_lock_reason||reason||null):null,
          changed_at:authority?.deployment_lock_changed_at||new Date().toISOString(),
          changed_by:authority?.deployment_lock_changed_by||"License Manager",
          authority:"orbitfs-license-master-v2",
        }};
      }));
      setLockTarget(null);setLockReason("");
      setMessage(action==="lock"?"Deployment locked by License Manager.":"Deployment unlocked by License Manager.");
    }catch(error:any){
      setMessage(error?.message||`Could not ${action} deployment.`);
    }finally{setBusyId(null)}
  }

  const filtered=items.filter(item=>{
    const hay=[
      item.customer?.name,item.customer?.customer_number,item.customer?.id,item.customer?.email,
      item.installation_id,item.license_id,item.network?.ip,item.network?.hostname,
      item.network?.panel_url,item.network?.engine_url,item.projects?.panel_project_name,
      item.projects?.engine_project_name,
    ].map(value=>String(value||"").toLowerCase()).join(" ");
    const matches=!query.trim()||hay.includes(query.trim().toLowerCase());
    if(!matches)return false;
    if(filter==="locked")return item.deployment_lock?.locked===true;
    if(filter==="attention")return Boolean(item.authority_error||item.runtime?.last_error||String(item.runtime?.health||"").toLowerCase()==="unhealthy");
    return true;
  });

  const lockedCount=items.filter(item=>item.deployment_lock?.locked).length;
  const attentionCount=items.filter(item=>item.authority_error||item.runtime?.last_error||String(item.runtime?.health||"").toLowerCase()==="unhealthy").length;

  if(loading)return <main className="adminShell"><header className="adminTop"><div><p className="eyebrow">ORBITFS CONTROL</p><h1>Installations</h1><p className="muted">Loading installation authority view…</p></div></header></main>;

  return <main className="adminShell">
    <header className="adminTop">
      <div>
        <p className="eyebrow">ORBITFS CONTROL · LICENSE MANAGER AUTHORITY</p>
        <h1>Installations</h1>
        <p className="muted">Customer installation identity, running versions, domains, provider links and deployment controls. Billing presents the data; License Manager remains authoritative for deployment authorization and lock state.</p>
      </div>
      <div className="adminTopActions">
        <button onClick={()=>void load("manual")} disabled={checking}>{checking?"Checking…":"Check for new installations"}</button>
      </div>
    </header>

    <section className="stats four">
      <article><small>Installations</small><strong>{items.length}</strong><span>Billing + authority projection</span></article>
      <article><small>Deploy locked</small><strong>{lockedCount}</strong><span>License Manager enforced</span></article>
      <article><small>Need attention</small><strong>{attentionCount}</strong><span>Health / authority errors</span></article>
      <article><small>Last checked</small><strong>{fetchedAt?new Date(fetchedAt).toLocaleTimeString():"—"}</strong><span>No background polling</span></article>
    </section>

    <section className="panel">
      <div className="panelTitle">
        <div><h2>Installation registry</h2><p className="muted">Search by customer, installation ID, licence ID, IP, hostname, project or domain.</p></div>
        <span>{filtered.length} shown</span>
      </div>
      <div className="form">
        <div className="two">
          <label>Search<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Customer, ID, IP, domain, project…"/></label>
          <label>View<select value={filter} onChange={event=>setFilter(event.target.value as any)}><option value="all">All installations</option><option value="locked">Deploy locked</option><option value="attention">Needs attention</option></select></label>
        </div>
      </div>
    </section>

    {filtered.length?filtered.map(item=>{
      const customerName=item.customer?.name||item.customer?.email||item.customer?.customer_number||"Unmatched customer";
      const panelUrl=safeUrl(item.network?.panel_url);
      const engineUrl=safeUrl(item.network?.engine_url);
      const domain=domainOf(panelUrl)||item.network?.hostname||"—";
      const locked=item.deployment_lock?.locked===true;
      const attention=Boolean(item.authority_error||item.runtime?.last_error);
      return <section className="panel" key={item.installation_id} style={{marginTop:14}}>
        <div className="panelTitle">
          <div>
            <p className="eyebrow">INSTALLATION · {item.authority_only?"AUTHORITY ONLY":"BILLING LINKED"}</p>
            <h2>{customerName}</h2>
            <p className="muted">{item.customer?.customer_number||"No customer number"} · {item.installation_id}</p>
          </div>
          <div className="actionStack" style={{minWidth:190}}>
            <span className={"state "+(locked?"error":attention?"waiting":"ok")}>{locked?"Deploy locked":attention?"Attention":String(item.runtime?.state||"ready").replaceAll("_"," ")}</span>
          </div>
        </div>

        <div className="stats four">
          <article><small>Version running</small><strong>{displayVersion(item.versions?.running)}</strong><span>Runtime report</span></article>
          <article><small>Base</small><strong>{displayVersion(item.versions?.base)}</strong><span>{item.versions?.channel||"No channel"}</span></article>
          <article><small>Update release system</small><strong>{displayVersion(item.versions?.update)}</strong><span>{item.versions?.update_release_id?"Last applied update":"No update recorded"}</span></article>
          <article><small>Health</small><strong>{item.runtime?.health||"unknown"}</strong><span>{item.runtime?.last_seen_at?"Seen "+displayDate(item.runtime.last_seen_at):"No runtime check-in"}</span></article>
        </div>

        <div className="adminGrid">
          <div>
            <h3>Customer & installation</h3>
            <div className="listrow"><b>Customer name</b><span>{item.customer?.name||"—"}</span></div>
            <div className="listrow"><b>Customer ID</b><span>{item.customer?.customer_number||item.customer?.id||"—"}</span></div>
            <div className="listrow"><b>Installation ID</b><span>{item.installation_id}</span></div>
            <div className="listrow"><b>Licence ID</b><span>{item.license_id||"—"}</span></div>
            <div className="listrow"><b>IP / hostname</b><span>{item.network?.ip||item.network?.hostname||"—"}</span></div>
            <div className="listrow"><b>Domain</b><span>{domain}</span></div>
          </div>
          <div>
            <h3>Projects & links</h3>
            <div className="listrow"><b>Panel</b><span>{panelUrl?<a href={panelUrl} target="_blank" rel="noreferrer">{domainOf(panelUrl)||"Open panel"}</a>:"Not deployed"}</span></div>
            <div className="listrow"><b>Engine</b><span>{engineUrl?<a href={engineUrl} target="_blank" rel="noreferrer">{domainOf(engineUrl)||"Open engine"}</a>:"Not installed / not linked"}</span></div>
            <div className="listrow"><b>Panel project</b><span>{item.projects?.panel_project_name||item.projects?.panel_project_id||"—"}</span></div>
            <div className="listrow"><b>Engine project</b><span>{item.projects?.engine_project_name||item.projects?.engine_project_id||"—"}</span></div>
            <div className="listrow"><b>Supabase</b><span>{item.projects?.supabase_project_name||item.projects?.supabase_project_ref||"—"}</span></div>
            <div className="listrow"><b>Schema</b><span>{item.runtime?.schema_version||"—"}</span></div>
          </div>
        </div>

        <div className="adminGrid" style={{marginTop:12}}>
          <div className="panel">
            <h3>Deployment authority</h3>
            <div className="listrow"><b>Authority</b><span>License Manager</span></div>
            <div className="listrow"><b>Deploy state</b><span>{locked?"Locked":"Unlocked"}</span></div>
            <div className="listrow"><b>Last operation</b><span>{item.runtime?.last_operation||"—"}</span></div>
            <div className="listrow"><b>Deployment count</b><span>{item.runtime?.deployment_count??"—"}</span></div>
            {locked&&<div className="notice"><b>Deployment locked</b><span>{item.deployment_lock?.reason||"No reason recorded."}</span><span>{item.deployment_lock?.changed_at?displayDate(item.deployment_lock.changed_at):""}</span></div>}
            {item.authority_error&&<div className="notice"><b>Authority mismatch</b><span>{item.authority_error}</span></div>}
            {item.runtime?.last_error&&<div className="notice"><b>Latest runtime error</b><span>{item.runtime.last_error}</span></div>}
          </div>
          <div className="panel">
            <h3>Controls</h3>
            <p className="muted">These controls do not create Billing-owned technical state. Lock/unlock is written to License Manager and enforced during deployment authorization.</p>
            <div className="actionStack">
              {item.customer?.auth_user_id&&<Link className="button secondary" href={`/admin/customers/${item.customer.auth_user_id}`}>Open customer</Link>}
              {panelUrl&&<a className="button secondary" href={panelUrl} target="_blank" rel="noreferrer">Open Panel</a>}
              {engineUrl&&<a className="button secondary" href={engineUrl} target="_blank" rel="noreferrer">Open Engine</a>}
              {locked
                ?<button onClick={()=>void setLock(item,"unlock")} disabled={busyId===item.installation_id}>{busyId===item.installation_id?"Unlocking…":"Unlock deployment"}</button>
                :<button className="danger" onClick={()=>{setLockTarget(item);setLockReason("")}} disabled={busyId===item.installation_id}>Lock deployment</button>}
            </div>
          </div>
        </div>
      </section>
    }):<section className="panel"><h2>No installations found</h2><p className="muted">Use “Check for new installations” to request a fresh License Manager projection.</p></section>}

    {message&&<p className="muted" style={{marginTop:16}}>{message}</p>}

    {lockTarget&&<div className="orderModalBackdrop" onMouseDown={()=>!busyId&&setLockTarget(null)}>
      <section className="orderModal" onMouseDown={event=>event.stopPropagation()}>
        <div className="panelTitle"><div><p className="eyebrow">LICENSE MANAGER CONTROL</p><h2>Lock deployment</h2><p className="muted">{lockTarget.customer?.name||lockTarget.installation_id}</p></div><button className="small secondary" onClick={()=>setLockTarget(null)} disabled={Boolean(busyId)}>Close</button></div>
        <div className="form">
          <div className="notice"><b>What this blocks</b><span>Base deploy, Base update, redeploy, rollback and Update deployment authorization for this installation until an admin unlocks it.</span></div>
          <label>Reason<textarea rows={4} value={lockReason} onChange={event=>setLockReason(event.target.value)} placeholder="Required reason for the deployment lock"/></label>
          <button className="danger" disabled={!lockReason.trim()||Boolean(busyId)} onClick={()=>void setLock(lockTarget,"lock",lockReason)}>{busyId?"Locking…":"Lock deployment in License Manager"}</button>
        </div>
      </section>
    </div>}
  </main>;
}
