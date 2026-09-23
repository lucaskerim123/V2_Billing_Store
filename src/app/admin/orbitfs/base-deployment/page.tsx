"use client";
import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";

type Release={
  id:string;version:string;channel:string;status:string;reviewStatus?:string;releaseType?:string;
  title?:string;description?:string;changelog?:string;sourceCommit?:string;sourceRepo?:string;sourceRef?:string;
  artifactName?:string;artifactRunId?:number|null;checksum?:string;publishedAt?:string|null;updatedAt?:string|null;
  validation?:{status?:string;checks?:Array<{key?:string;ok?:boolean;message?:string}>}|null;
};

export default function BaseDeploymentAdmin(){
  const [releases,setReleases]=useState<Release[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [systemSettings,setSystemSettings]=useState<any>(null);
  const [savingSetting,setSavingSetting]=useState("");

  async function headers():Promise<Record<string,string>>{
    const {data:{session}}=await createClient().auth.getSession();
    return session?.access_token?{Authorization:`Bearer ${session.access_token}`}:{};
  }

  async function load(){
    setLoading(true);setError("");
    try{
      const h=await headers();
      const [response,settingsResponse]=await Promise.all([
        fetch("/api/admin/orbitfs/release-handoff?action=history&type=base",{headers:h,cache:"no-store"}),
        fetch("/api/admin/orbitfs/deployment-settings",{headers:h,cache:"no-store"})
      ]);
      const body=await response.json().catch(()=>({}));
      const settingsBody=await settingsResponse.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||"Could not load Base releases from License Manager");
      if(!settingsResponse.ok)throw new Error(settingsBody.error||"Could not load customer deployment controls");
      setReleases(Array.isArray(body.releases)?body.releases:[]);
      setSystemSettings(settingsBody.settings||{});
    }catch(e:any){setError(e?.message||"Could not load Base release state")}
    finally{setLoading(false)}
  }

  useEffect(()=>{void load()},[]);
  const published=useMemo(()=>releases.filter(r=>r.status==="published"),[releases]);
  const current=published[0]||null;
  const queue=useMemo(()=>releases.filter(r=>r.status!=="published"),[releases]);
  const validation=(r:Release)=>String(r.validation?.status||"not run");
  const passing=(r:Release)=>(r.validation?.checks||[]).filter(x=>x.ok).length;
  const total=(r:Release)=>(r.validation?.checks||[]).length;

  async function setDeploymentSetting(key:string,value:boolean){
    setSavingSetting(key);setError("");
    try{
      const h=await headers();
      const response=await fetch("/api/admin/orbitfs/deployment-settings",{
        method:"PATCH",
        headers:{...h,"content-type":"application/json"},
        body:JSON.stringify({[key]:value})
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||"Could not update customer deployment controls");
      setSystemSettings(body.settings||{});
    }catch(e:any){setError(e?.message||"Could not update customer deployment controls")}
    finally{setSavingSetting("")}
  }

  const controls=[
    ["enabled","Customer deployment system","Master Billing-side gate for customer deployment execution."],
    ["customer_deploy_enabled","Base deployment","Allows customers to install or redeploy a published Base release."],
    ["customer_updates_enabled","Update deployment","Allows manifest-driven published Update releases to be applied."],
    ["customer_rollbacks_enabled","Rollback","Allows customer rollback to a previous successful Base deployment."]
  ] as const;

  return <main className="adminShell">
    <header className="adminTop">
      <div>
        <p className="eyebrow">ORBITFS CONTROL · BASE DEPLOYMENT</p>
        <h1>Base Deployment</h1>
        <p className="muted">License Manager owns Base validation, Base Deployment review, approval and publication. Billing Store mirrors the published Base release into My OrbitFS and the customer Base deployer.</p>
      </div>
      <div className="actions">
        <a className="buttonlink secondary" href="https://panel.incendiarynetworks.cc/releases/base" target="_blank" rel="noreferrer">Open License Manager</a>
        <Link className="buttonlink secondary" href="/admin/orbitfs/update-release-deployer">Update Release System</Link>
        <button className="buttonlink secondary" type="button" onClick={()=>void load()} disabled={loading}>{loading?"Refreshing…":"Refresh"}</button>
      </div>
    </header>

    {error&&<p className="inlineStatus" style={{borderColor:"crimson"}}>{error}</p>}

    <section className="panel">
      <div className="sectionHead"><div><p className="eyebrow">CUSTOMER DEPLOYMENT GATES</p><h2>Execution controls</h2><p className="muted">These Billing Store gates control whether the customer deployer may execute Base installs, Updates and rollbacks. They do not change License Manager release authority.</p></div></div>
      <div className="lmRuntimeList">
        {controls.map(([key,label,description])=>{const enabled=Boolean(systemSettings?.[key]);return <div key={key}><div><b>{label}</b><span>{description}</span></div><div style={{display:"flex",gap:8,alignItems:"center"}}><strong>{enabled?"Enabled":"Disabled"}</strong><button type="button" disabled={loading||!!savingSetting||!systemSettings} onClick={()=>void setDeploymentSetting(key,!enabled)}>{savingSetting===key?"Saving…":enabled?"Disable":"Enable"}</button></div></div>})}
      </div>
      {!systemSettings&&<p className="muted">Deployment controls are unavailable until the Billing Store release-system settings can be read.</p>}
    </section>

    <section className="panel">
      <p className="eyebrow">CURRENT PUBLISHED BASE</p>
      {current?<div>
        <h2>{current.title||`OrbitFS Base ${current.version}`}</h2>
        <p className="muted">{current.description||"Published Base release available to the customer deployment flow."}</p>
        <div className="lmRuntimeList">
          <div><div><b>Version</b><span>{current.version}</span></div><strong>Published</strong></div>
          <div><div><b>Channel</b><span>{current.channel||"stable"}</span></div><strong>{current.reviewStatus||"approved"}</strong></div>
          <div><div><b>Source</b><span>{current.sourceRepo||"—"} {current.sourceRef?`· ${current.sourceRef}`:""}</span></div><strong className="mono">{current.sourceCommit||"—"}</strong></div>
          <div><div><b>Artifact</b><span>{current.artifactName||"—"}</span></div><strong>{current.artifactRunId?`Run ${current.artifactRunId}`:"—"}</strong></div>
          <div><div><b>Integrity</b><span>{current.checksum||"—"}</span></div><strong>{validation(current)}</strong></div>
        </div>
      </div>:<div className="emptyState"><b>No published Base release</b><p className="muted">Approve and publish a validated Base candidate in License Manager.</p></div>}
    </section>

    <section className="panel">
      <div className="sectionHead"><div><p className="eyebrow">LICENSE MANAGER QUEUE</p><h2>Base candidates</h2><p className="muted">Read-only mirror. Technical actions and Base publication stay in License Manager.</p></div><span className="badge">{queue.length}</span></div>
      <div className="lmRuntimeList">
        {queue.map(r=><div key={r.id}>
          <div>
            <b>{r.version} · {r.channel||"stable"}</b>
            <span>{r.reviewStatus||"pending"} · validation {validation(r)} · {passing(r)}/{total(r)} checks</span>
          </div>
          <strong>{r.status}</strong>
        </div>)}
        {!queue.length&&<div><div><b>No pending Base candidates</b><span>New Base candidates will appear after the Base release workflow hands them to License Manager.</span></div><strong>Clear</strong></div>}
      </div>
    </section>

    <section className="panel">
      <div className="sectionHead"><div><p className="eyebrow">PUBLICATION HISTORY</p><h2>Published Base releases</h2></div><span className="badge">{published.length}</span></div>
      <div className="lmRuntimeList">
        {published.map(r=><div key={r.id}><div><b>{r.version} · {r.channel||"stable"}</b><span>{r.publishedAt?new Date(r.publishedAt).toLocaleString():"Published"} · {r.sourceCommit||"source commit unavailable"}</span></div><strong>Published</strong></div>)}
        {!published.length&&<div><div><b>No publication history</b><span>No Base release has been published yet.</span></div><strong>—</strong></div>}
      </div>
    </section>
  </main>;
}
