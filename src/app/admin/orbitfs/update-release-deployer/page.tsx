"use client";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import Link from "next/link";

const UPDATE_PRODUCTS=["orbitfs_mcp","orbitfs_apex","orbitfs_studio"];

export default function OrbitFSUpdateReleaseDeployer(){
 const sb=useMemo(()=>createClient(),[]);
 const [releases,setReleases]=useState<any[]>([]),[selected,setSelected]=useState<string>(""),[busy,setBusy]=useState(false),[msg,setMsg]=useState("");
 async function load(){
  setBusy(true);setMsg("");
  try{
   const {data:{session}}=await sb.auth.getSession();
   if(!session?.access_token)throw Error("Administrator session expired.");
   const r=await fetch(`/api/admin/license-master?path=${encodeURIComponent("/api/releases?channel=stable")}`,{headers:{Authorization:`Bearer ${session.access_token}`},cache:"no-store"});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||`License Master returned ${r.status}`);
   const rows=(j.releases||[]).filter((x:any)=>x.release_type==="update"||x.releaseType==="update").sort((a:any,b:any)=>String(b.updated_at||b.created_at).localeCompare(String(a.updated_at||a.created_at)));
   setReleases(rows);if(!selected&&rows[0]?.id)setSelected(rows[0].id);
  }catch(e:any){setMsg(e.message||"Could not load update release state.")}finally{setBusy(false)}
 }
 useEffect(()=>{void load()},[]);
 const chosen=releases.find(r=>r.id===selected)||releases[0]||null;
 const manifest=chosen?.manifest&&typeof chosen.manifest==="object"?chosen.manifest:{};
 return <main className="lmPage">
  <div className="lmHero"><div><div className="lmEyebrow">MY ORBITFS · UPDATE RELEASE CONTROL</div><h1>Update Release Releaser</h1><p>Detailed release control for version history, component targeting, validation state and rollback metadata. Customer deployments are intentionally outside this admin release screen.</p></div><div className="lmHeroActions"><Link href="/admin/orbitfs">My OrbitFS</Link><Link href="/admin/orbitfs/base-deployment">Base Deployment</Link><button onClick={()=>void load()} disabled={busy}>{busy?"Refreshing…":"Refresh"}</button></div></div>
  <div className="lmGrid2">
   <section className="lmCard"><div className="lmKicker">SELECTED RELEASE</div><h2>{chosen?.version||"No update releases"}</h2><div className="lmKV"><div><span>Status</span><b>{chosen?.status||"—"}</b></div><div><span>Review</span><b>{chosen?.review_status||chosen?.reviewStatus||"—"}</b></div><div><span>Source</span><b>{chosen?.source_sha||chosen?.source_commit||"—"}</b></div><div><span>Checksum</span><b>{chosen?.checksum||"—"}</b></div></div></section>
   <section className="lmCard"><div className="lmKicker">TARGETING</div><h2>Manifest-controlled update</h2><div className="lmKV"><div><span>Components</span><b>{Array.isArray(manifest.components)?manifest.components.join(", "):"—"}</b></div><div><span>Minimum version</span><b>{manifest.minimum_version||"—"}</b></div><div><span>Required</span><b>{manifest.required===true?"Yes":"No"}</b></div><div><span>Rollback version</span><b>{manifest.rollback_version||"—"}</b></div></div></section>
  </div>
  <section className="lmCard" style={{marginTop:14}}><div className="lmKicker">VERSION CONTROL</div><h2>Release history</h2>{releases.length?<div className="lmReleaseList">{releases.map((r:any)=><button key={r.id} type="button" className="lmRelease" onClick={()=>setSelected(r.id)} style={{textAlign:"left",width:"100%",border:selected===r.id?"1px solid currentColor":undefined}}><div><b>{r.version||r.id}</b><small>{r.status||"draft"} · {r.review_status||r.reviewStatus||"pending review"}</small><p>{r.changelog||r.notes||manifest.description||"No changelog"}</p><small>{r.source_repo||"Source repository not recorded"} · {r.source_ref||"ref not recorded"}</small></div><span>{selected===r.id?"SELECTED":r.release_type||r.releaseType||"update"}</span></button>)}</div>:<div className="lmEmpty">No update releases are currently recorded.</div>}</section>
  <section className="lmCard" style={{marginTop:14}}><div className="lmKicker">ROLLBACK & DELIVERY</div><h2>Authority boundaries</h2><div className="lmRuntimeList"><div><b>Rollback metadata</b><span>Each release records its rollback target in the manifest when one is supplied. Actual customer rollback is executed by the customer deployer.</span></div><div><b>Technical approval</b><span>License Master validates and approves the update before Billing Store can perform its final customer-facing publication.</span></div><div><b>Customer execution</b><span>This screen never accepts provider credentials and never deploys a customer's Vercel or Supabase resources.</span></div><div><b>Supported components</b><span>{UPDATE_PRODUCTS.join(", ")}.</span></div></div>{msg&&<div className="lmNotice" style={{marginTop:14}}>{msg}</div>}</section>
 </main>
}
