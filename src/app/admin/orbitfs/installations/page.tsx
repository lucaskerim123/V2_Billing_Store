"use client";

import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import {usePermissions} from "@/lib/usePermissions";
import V6ConfirmDialog from "@/components/V6ConfirmDialog";

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
function shortId(value:any){
  const text=String(value||"");
  return text.length>24?text.slice(0,10)+"…"+text.slice(-8):text||"—";
}

export default function InstallationsPage(){
  const sb=useMemo(()=>createClient(),[]);
  const {can}=usePermissions();
  const [items,setItems]=useState<Installation[]>([]);
  const [loading,setLoading]=useState(true);
  const [checking,setChecking]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [query,setQuery]=useState("");
  const [filter,setFilter]=useState<"all"|"locked"|"attention">("all");
  const [selectedId,setSelectedId]=useState("");
  const [lockTarget,setLockTarget]=useState<Installation|null>(null);
  const [unlockTarget,setUnlockTarget]=useState<Installation|null>(null);
  const [lockReason,setLockReason]=useState("");
  const [busyId,setBusyId]=useState<string|null>(null);
  const [fetchedAt,setFetchedAt]=useState<string|null>(null);

  async function load(kind:"initial"|"manual"="manual"){
    if(kind==="manual"){setChecking(true);setMessage("");setError("")}
    else setLoading(true);
    try{
      const {data:{session}}=await sb.auth.getSession();
      if(!session?.access_token)throw new Error("Administrator session expired.");
      const response=await fetch("/api/admin/orbitfs/installations",{headers:{authorization:`Bearer ${session.access_token}`},cache:"no-store"});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data?.error||"Could not load installations.");
      const rows=Array.isArray(data.installations)?data.installations:[];
      setItems(rows);
      setFetchedAt(data.fetched_at||new Date().toISOString());
      setSelectedId(current=>rows.some((row:any)=>String(row.installation_id)===current)?current:String(rows[0]?.installation_id||""));
      if(kind==="manual")setMessage(`Check complete. ${rows.length} current installation${rows.length===1?"":"s"} found.`);
    }catch(error:any){
      setError(error?.message||"Could not load installations.");
    }finally{
      setLoading(false);
      setChecking(false);
    }
  }

  useEffect(()=>{void load("initial")},[]);

  async function setLock(item:Installation,action:"lock"|"unlock",reason?:string){
    setBusyId(item.installation_id);setMessage("");setError("");
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
          reason:action==="lock"?String(reason||"").trim():undefined
        })
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
          authority:"orbitfs-license-master-v2"
        }};
      }));
      setLockTarget(null);setUnlockTarget(null);setLockReason("");
      setMessage(action==="lock"?"Deployment locked by License Manager.":"Deployment unlocked by License Manager.");
    }catch(error:any){
      setError(error?.message||`Could not ${action} deployment.`);
    }finally{setBusyId(null)}
  }

  const filtered=items.filter(item=>{
    const hay=[
      item.customer?.name,item.customer?.customer_number,item.customer?.id,item.customer?.email,
      item.installation_id,item.license_id,item.network?.ip,item.network?.hostname,
      item.network?.panel_url,item.network?.engine_url,item.projects?.panel_project_name,
      item.projects?.engine_project_name
    ].map(value=>String(value||"").toLowerCase()).join(" ");
    const matches=!query.trim()||hay.includes(query.trim().toLowerCase());
    if(!matches)return false;
    if(filter==="locked")return item.deployment_lock?.locked===true;
    if(filter==="attention")return Boolean(item.authority_error||item.runtime?.last_error||String(item.runtime?.health||"").toLowerCase()==="unhealthy");
    return true;
  });

  const selected=filtered.find(item=>String(item.installation_id)===selectedId)||filtered[0]||null;
  const lockedCount=items.filter(item=>item.deployment_lock?.locked).length;
  const deployerCount=items.filter(item=>item.deployment_source==="deployer").length;
  const externalCount=items.filter(item=>item.deployment_source==="external").length;

  if(loading)return <main className="adminShell orbitPhaseOne orbitInstallationsPhase"><section className="orbitAdminLoading"><b>Loading installations</b><span>Reading current deployment authority from License Manager.</span></section></main>;

  return <main className="adminShell orbitPhaseOne orbitInstallationsPhase">
    <header className="orbitReferenceHero orbitPhaseHero">
      <div>
        <p className="eyebrow">ORBITFS CONTROL · INSTALLATIONS</p>
        <h1>Installations</h1>
        <p className="muted">Current customer installations projected from License Manager. Billing presents operational controls without becoming deployment authority.</p>
      </div>
      <div className="orbitReferenceHeroActions">
        <button className="secondary" type="button" onClick={()=>void load("manual")} disabled={checking}>{checking?"Checking…":"Check for changes"}</button>
      </div>
    </header>

    {error&&<div className="orbitReferenceNotice danger" role="alert"><b>Installation action failed</b><span>{error}</span></div>}
    {message&&<div className="orbitReferenceNotice" role="status"><b>Updated</b><span>{message}</span></div>}

    <section className="orbitInstallationStats">
      <article><span>Current installations</span><b>{items.length}</b><small>Active/current authority records</small></article>
      <article><span>Deployer managed</span><b>{deployerCount}</b><small>Billing deployer execution path</small></article>
      <article><span>External / manual</span><b>{externalCount}</b><small>Authority bindings outside Billing deployer</small></article>
      <article><span>Deploy locked</span><b>{lockedCount}</b><small>License Manager enforced locks</small></article>
    </section>

    <section className="orbitInstallationToolbar">
      <label><span>Search installations</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Customer, installation ID, IP, domain, project…"/></label>
      <label><span>View</span><select value={filter} onChange={event=>setFilter(event.target.value as any)}><option value="all">Current installations</option><option value="locked">Deploy locked</option><option value="attention">Needs attention</option></select></label>
      <div><span>LAST CHECK</span><b>{fetchedAt?displayDate(fetchedAt):"Not recorded"}</b><small>{filtered.length} shown</small></div>
    </section>

    {filtered.length?<div className="orbitReferenceSplit orbitInstallationWorkspace">
      <aside className="orbitReferenceRail orbitInstallationRail">
        <div className="orbitReferenceRailHead"><div><b>Current installations</b><span>{filtered.length} matching this view</span></div><small>Select one installation to inspect runtime, projects and authority controls.</small></div>
        <div className="orbitReferenceRailList">
          {filtered.map(item=>{
            const customerName=item.customer?.name||item.customer?.email||item.customer?.customer_number||"Unmatched customer";
            const locked=item.deployment_lock?.locked===true;
            const attention=Boolean(item.authority_error||item.runtime?.last_error||String(item.runtime?.health||"").toLowerCase()==="unhealthy");
            const active=String(item.installation_id)===String(selected?.installation_id);
            return <button type="button" key={item.installation_id} className={"orbitReferenceRailCard orbitInstallationChoice "+(active?"active":"")} onClick={()=>setSelectedId(String(item.installation_id))}>
              <div className="orbitReferenceRailCardTop"><b>{customerName}</b><span className={"orbitMiniState "+(locked?"suspended":attention?"":"live")}>{locked?"Locked":attention?"Attention":"Current"}</span></div>
              <small>{shortId(item.installation_id)}</small>
              <div className="orbitReferenceRailMeta"><span>{displayVersion(item.versions?.base)}</span><span>{item.versions?.channel||"No channel"}</span><span>{item.deployment_source==="external"?"External":"Deployer"}</span></div>
            </button>
          })}
        </div>
      </aside>

      <section className="orbitReferenceWorkspace orbitInstallationDetail">
        {selected&&(()=>{
          const item=selected;
          const customerName=item.customer?.name||item.customer?.email||item.customer?.customer_number||"Unmatched customer";
          const panelUrl=safeUrl(item.network?.panel_url);
          const engineUrl=safeUrl(item.network?.engine_url);
          const domain=domainOf(panelUrl)||item.network?.hostname||"—";
          const locked=item.deployment_lock?.locked===true;
          const attention=Boolean(item.authority_error||item.runtime?.last_error||String(item.runtime?.health||"").toLowerCase()==="unhealthy");
          return <>
            <div className="orbitReferenceWorkspaceHead orbitInstallationHead">
              <div>
                <p className="eyebrow">{item.deployment_source==="external"?"EXTERNAL / MANUAL":"DEPLOYER MANAGED"}</p>
                <div className="orbitReferenceTitleLine"><h2>{customerName}</h2><span className={"orbitMiniState "+(locked?"suspended":attention?"":"live")}>{locked?"Deploy locked":attention?"Needs attention":String(item.runtime?.state||"ready").replaceAll("_"," ")}</span></div>
                <p>{item.customer?.customer_number||"No customer number"} · installation <code>{shortId(item.installation_id)}</code></p>
              </div>
              <div className="orbitReferenceActions">
                {item.customer?.auth_user_id&&<Link className="buttonlink secondary" href={`/admin/customers/${item.customer.auth_user_id}`}>Open customer</Link>}
                {panelUrl&&<a className="buttonlink secondary" href={panelUrl} target="_blank" rel="noreferrer">Open Panel ↗</a>}
              </div>
            </div>

            <div className="orbitReferenceFacts orbitInstallationFacts">
              <div><span>Running version</span><b>{displayVersion(item.versions?.running)}</b><small>Runtime report</small></div>
              <div><span>Base release</span><b>{displayVersion(item.versions?.base)}</b><small>Channel {item.versions?.channel||"—"}</small></div>
              <div><span>Applied Update</span><b>{displayVersion(item.versions?.update)}</b><small>{item.versions?.update_release_id?"Update release recorded":"No Update recorded"}</small></div>
              <div><span>Health</span><b>{item.runtime?.health||"unknown"}</b><small>{item.runtime?.last_seen_at?"Seen "+displayDate(item.runtime.last_seen_at):"No runtime check-in"}</small></div>
            </div>

            {locked&&<div className="orbitReferenceNotice danger"><b>Deployment locked</b><span>{item.deployment_lock?.reason||"No reason recorded."} {item.deployment_lock?.changed_at?"· "+displayDate(item.deployment_lock.changed_at):""}</span></div>}
            {item.authority_error&&<div className="orbitReferenceNotice danger"><b>Authority mismatch</b><span>{item.authority_error}</span></div>}
            {item.runtime?.last_error&&<div className="orbitReferenceNotice danger"><b>Latest runtime error</b><span>{item.runtime.last_error}</span></div>}

            <div className="orbitInstallationColumns">
              <section className="orbitReferenceSection">
                <div className="orbitReferenceSectionHead"><div><b>Customer & installation</b><small>Authoritative installation identity and network record.</small></div><span>{item.deployment_source==="external"?"External":"Deployer"}</span></div>
                <div className="orbitInstallationKeyList">
                  <div><span>Customer</span><b>{item.customer?.name||"—"}</b></div>
                  <div><span>Customer ID</span><b>{item.customer?.customer_number||item.customer?.id||"—"}</b></div>
                  <div><span>Installation ID</span><b className="orbitMono">{item.installation_id}</b></div>
                  <div><span>Licence ID</span><b className="orbitMono">{item.license_id||"—"}</b></div>
                  <div><span>IP / hostname</span><b>{item.network?.ip||item.network?.hostname||"—"}</b></div>
                  <div><span>Domain</span><b>{domain}</b></div>
                </div>
              </section>

              <section className="orbitReferenceSection">
                <div className="orbitReferenceSectionHead"><div><b>Provider projects</b><small>Customer infrastructure connected to this installation.</small></div><span>{panelUrl||engineUrl?"Live links":"No links"}</span></div>
                <div className="orbitInstallationKeyList">
                  <div><span>Panel</span><b>{panelUrl?<a href={panelUrl} target="_blank" rel="noreferrer">{domainOf(panelUrl)||"Open Panel ↗"}</a>:"Not deployed"}</b></div>
                  <div><span>Engine</span><b>{engineUrl?<a href={engineUrl} target="_blank" rel="noreferrer">{domainOf(engineUrl)||"Open Engine ↗"}</a>:"Not installed / not linked"}</b></div>
                  <div><span>Panel project</span><b>{item.projects?.panel_project_name||item.projects?.panel_project_id||"—"}</b></div>
                  <div><span>Engine project</span><b>{item.projects?.engine_project_name||item.projects?.engine_project_id||"—"}</b></div>
                  <div><span>Supabase</span><b>{item.projects?.supabase_project_name||item.projects?.supabase_project_ref||"—"}</b></div>
                  <div><span>Schema</span><b>{item.runtime?.schema_version||"—"}</b></div>
                </div>
              </section>
            </div>

            <section className="orbitReferenceSection orbitInstallationAuthority">
              <div className="orbitReferenceSectionHead"><div><b>Deployment authority</b><small>Lock state is written to and enforced by License Manager during deployment authorization.</small></div><span className={"orbitMiniState "+(locked?"suspended":"live")}>{locked?"Locked":"Unlocked"}</span></div>
              <div className="orbitInstallationAuthorityGrid">
                <div><span>Authority</span><b>License Manager</b></div>
                <div><span>Deployment source</span><b>{item.deployment_source==="external"?"External / manual":"Billing deployer"}</b></div>
                <div><span>Last operation</span><b>{item.runtime?.last_operation||"—"}</b></div>
                <div><span>Deployment count</span><b>{item.runtime?.deployment_count??"—"}</b></div>
              </div>
              <div className="orbitInstallationActions">
                {engineUrl&&<a className="buttonlink secondary" href={engineUrl} target="_blank" rel="noreferrer">Open Engine ↗</a>}
                {!can("licenses.manage")
                  ?<button className="secondary" disabled>View-only deployment control</button>
                  :!item.license_id
                    ?<button className="secondary" disabled title="License Manager has not returned an authoritative activation for this installation">Lock unavailable until authority links</button>
                    :locked
                      ?<button type="button" onClick={()=>setUnlockTarget(item)} disabled={busyId===item.installation_id}>{busyId===item.installation_id?"Unlocking…":"Unlock deployment"}</button>
                      :<button type="button" className="danger" onClick={()=>{setLockTarget(item);setLockReason("")}} disabled={busyId===item.installation_id}>Lock deployment</button>}
              </div>
            </section>
          </>
        })()}
      </section>
    </div>:<section className="orbitReferenceEmpty"><b>No installations found</b><span>Change the search/filter or run “Check for changes” to request a fresh License Manager projection.</span></section>}

    <V6ConfirmDialog
      open={Boolean(lockTarget)}
      title="Lock deployment?"
      description="Base deploy, Base update, redeploy, rollback and Update deployment authorization will be blocked for this installation until an administrator unlocks it."
      confirmLabel="Lock deployment"
      danger
      busy={Boolean(busyId)}
      confirmDisabled={!lockReason.trim()}
      onCancel={()=>{setLockTarget(null);setLockReason("")}}
      onConfirm={()=>{if(lockTarget)void setLock(lockTarget,"lock",lockReason)}}
    >
      <label className="v6ConfirmReason"><span>Required reason</span><textarea rows={4} value={lockReason} onChange={event=>setLockReason(event.target.value)} placeholder="Reason for the deployment lock"/></label>
    </V6ConfirmDialog>

    <V6ConfirmDialog
      open={Boolean(unlockTarget)}
      title="Unlock deployment?"
      description="Deployment authorization will be available again if the licence and release policy otherwise allow it."
      confirmLabel="Unlock deployment"
      busy={Boolean(busyId)}
      onCancel={()=>setUnlockTarget(null)}
      onConfirm={()=>{if(unlockTarget)void setLock(unlockTarget,"unlock")}}
    />
  </main>;
}
