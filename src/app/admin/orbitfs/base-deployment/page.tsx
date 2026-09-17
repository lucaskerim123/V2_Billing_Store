"use client";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import Link from "next/link";

const PRODUCT="orbitfs_base";
const SOURCE_REPO="lucaskerim123/V1-vercel-base";
const SOURCE_BRANCH="base-release";

export default function AdminBaseDeployment(){
 const sb=useMemo(()=>createClient(),[]);
 const [releases,setReleases]=useState<any[]>([]),[busy,setBusy]=useState(false),[msg,setMsg]=useState("");
 async function request(path:string){
  const {data:{session}}=await sb.auth.getSession();
  if(!session?.access_token)throw Error("Administrator session expired.");
  const r=await fetch(`/api/admin/license-master?path=${encodeURIComponent(path)}`,{headers:{Authorization:`Bearer ${session.access_token}`},cache:"no-store"});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(j.error||`License Master returned ${r.status}`);
  return j;
 }
 async function load(){
  setBusy(true);setMsg("");
  try{
   const j=await request(`/api/releases?product=${encodeURIComponent(PRODUCT)}&channel=stable&type=base`);
   setReleases((j.releases||[]).sort((a:any,b:any)=>String(b.updated_at||b.created_at).localeCompare(String(a.updated_at||a.created_at))));
  }catch(e:any){setMsg(e.message||"Could not load Base release state.")}finally{setBusy(false)}
 }
 useEffect(()=>{void load()},[]);
 const published=releases.find(r=>r.status==="published")||null;
 return <main className="lmPage">
  <div className="lmHero"><div><div className="lmEyebrow">MY ORBITFS · BASE DEPLOYMENT</div><h1>Base Deployment</h1><p>This is the simple Base release handoff. It prepares the latest approved Base package for the customer Base Deployer; it does not deploy customer infrastructure from the Billing Store.</p></div><div className="lmHeroActions"><Link href="/admin/orbitfs">My OrbitFS</Link><Link href="/admin/orbitfs/update-release-deployer">Update Releaser</Link><button onClick={()=>void load()} disabled={busy}>{busy?"Refreshing…":"Refresh"}</button></div></div>
  <div className="lmGrid2">
   <section className="lmCard"><div className="lmKicker">CURRENT BASE</div><h2>{published?.version||"No published Base release"}</h2><div className="lmKV"><div><span>Product</span><b>{PRODUCT}</b></div><div><span>Source</span><b>{SOURCE_REPO}</b></div><div><span>Ref</span><b>{SOURCE_BRANCH}</b></div><div><span>Status</span><b>{published?.status||"waiting"}</b></div></div></section>
   <section className="lmCard"><div className="lmKicker">DEPLOYMENT BOUNDARY</div><h2>Prepare, don't execute</h2><div className="lmRuntimeList"><div><b>1 · License Master</b><span>Owns the canonical release, validation and publication state.</span></div><div><b>2 · Billing Store</b><span>Presents the approved Base package to the customer workflow.</span></div><div><b>3 · Customer Base Deployer</b><span>Runs the deployment using credentials belonging to that customer installation.</span></div></div></section>
  </div>
  <section className="lmCard" style={{marginTop:14}}><div className="lmKicker">RELEASE PACKAGE</div><h2>{published?`Base ${published.version} is published`:'Waiting for a published Base package'}</h2><p>{published?.notes||published?.changelog||"The Base builder must submit and License Master must validate and publish a release before it becomes customer-available."}</p><div className="actions" style={{marginTop:14}}><Link className="buttonlink" href="/admin/releases">Open release management</Link><Link className="buttonlink" href="/admin/orbitfs/releases">Release history</Link></div>{msg&&<div className="lmNotice" style={{marginTop:14}}>{msg}</div>}</section>
  <section className="lmCard" style={{marginTop:14}}><div className="lmKicker">RECENT BASE RELEASES</div><h2>Version history</h2>{releases.length?<div className="lmReleaseList">{releases.slice(0,10).map((r:any)=><div className="lmRelease" key={r.id}><div><b>{r.version||r.id}</b><small>{r.status||"draft"} · {r.channel||"stable"}</small><p>{r.notes||r.changelog||"No release notes"}</p><small>Source: {r.source_sha||r.source_commit||"not recorded"}</small></div><span className={`state ${r.status==="published"?"ready":r.status==="disabled"?"error":"waiting"}`}>{r.status||"draft"}</span><div className="actions"><Link className="buttonlink" href="/admin/releases">Manage</Link></div></div>)}</div>:<div className="lmEmpty">No Base releases are currently recorded.</div>}</section>
 </main>
}
