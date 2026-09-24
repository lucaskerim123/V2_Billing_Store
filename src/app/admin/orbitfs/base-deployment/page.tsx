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

  async function headers():Promise<Record<string,string>>{
    const {data:{session}}=await createClient().auth.getSession();
    return session?.access_token?{Authorization:`Bearer ${session.access_token}`}:{};
  }

  async function load(){
    setLoading(true);setError("");
    try{
      const h=await headers();
      const response=await fetch("/api/admin/orbitfs/release-handoff?action=history&type=base",{headers:h,cache:"no-store"});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||"Could not load Base releases from License Manager");
      setReleases(Array.isArray(body.releases)?body.releases:[]);
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
      <div className="sectionHead"><div><p className="eyebrow">DEPLOYMENT AUTHORITY</p><h2>License Manager controlled</h2><p className="muted">Base, Update and rollback authorization are controlled in License Manager. Billing Store only mirrors published releases and customer-facing publication state.</p></div><a className="buttonlink secondary" href="https://panel.incendiarynetworks.cc/settings" target="_blank" rel="noreferrer">Open API Control</a></div>
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
