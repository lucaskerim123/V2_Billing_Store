"use client";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

const UPDATE_PRODUCTS=["orbitfs_mcp","orbitfs_apex","orbitfs_studio"];

export default function OrbitFSUpdateReleaseDeployer(){
 const sb=useMemo(()=>createClient(),[]);
 const [releases,setReleases]=useState<any[]>([]),[channels,setChannels]=useState<any[]>([]),[selected,setSelected]=useState<string>(""),[target,setTarget]=useState(""),[busy,setBusy]=useState(false),[msg,setMsg]=useState("");
 async function load(){
  setBusy(true);setMsg("");
  try{
   const {data:{session}}=await sb.auth.getSession();
   if(!session?.access_token)throw Error("Administrator session expired. Sign in again.");
   const target="/api/releases?type=update";
   const r=await fetch(`/api/admin/license-master?path=${encodeURIComponent(target)}`,{headers:{Authorization:`Bearer ${session.access_token}`,Accept:"application/json"},cache:"no-store"});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||`License Master returned HTTP ${r.status}`);
   const rows=(Array.isArray(j.releases)?j.releases:Array.isArray(j)?j:[]).filter((x:any)=>String(x.release_type||x.releaseType||"").toLowerCase()==="update").sort((a:any,b:any)=>String(b.updated_at||b.created_at||"").localeCompare(String(a.updated_at||a.created_at||"")));
   setReleases(rows);setSelected(current=>rows.some((r:any)=>r.id===current)?current:(rows[0]?.id||""));const cr=await fetch("/api/admin/orbitfs/release-channels",{cache:"no-store"});const cj=await cr.json().catch(()=>({}));setChannels((cj.channels||[]).filter((x:any)=>x.enabled&&x.customer_visible));
  }catch(e:any){setMsg(e instanceof TypeError?"Could not reach the License Master connection endpoint. Check the Billing Store → License Master connection and server-side API configuration.":(e?.message||"Could not load update release state."))}
  finally{setBusy(false)}
 }
 useEffect(()=>{void load()},[]);
 const chosen=releases.find(r=>r.id===selected)||releases[0]||null;
 async function promote(){if(!chosen||!target)return;setBusy(true);setMsg("");try{const r=await fetch("/api/admin/orbitfs/release-promote",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({releaseId:chosen.id,targetChannel:target})}),j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||"Could not promote release");setMsg("Release promoted to "+target+".");setTarget("");await load()}catch(e:any){setMsg(e?.message||"Could not promote release")}finally{setBusy(false)}}
 const manifest=chosen?.manifest&&typeof chosen.manifest==="object"?chosen.manifest:{};
 const components=Array.isArray(manifest.components)?manifest.components:[];
 return <main className="orbitfsControlPage">
  <section className="orbitfsControlHero">
   <div><div className="orbitfsEyebrow">MY ORBITFS · RELEASE UPDATES</div><h1>Update Release Control</h1><p>Version control, technical validation state, manifest targeting and rollback metadata for OrbitFS component updates. Customer infrastructure deployment is deliberately outside this screen.</p></div>
   <div className="orbitfsHeroActions"><button type="button" onClick={()=>void load()} disabled={busy}>{busy?"Refreshing…":"Refresh"}</button></div>
  </section>

  {msg&&<div className="orbitfsNotice">{msg}</div>}

  <div className="orbitfsGrid" style={{marginTop:msg?10:0}}>
   <section className="orbitfsCard">
    <div className="orbitfsCardHeader"><div><div className="orbitfsKicker">Selected release</div><h2>{chosen?.version||"No update release selected"}</h2></div><span className="orbitfsBadge">{chosen?.release_type||chosen?.releaseType||"update"}</span></div>
    <div className="orbitfsDataGrid">
     <div className="orbitfsData"><span>Status</span><b>{chosen?.status||"—"}</b></div>
     <div className="orbitfsData"><span>Technical review</span><b>{chosen?.review_status||chosen?.reviewStatus||"—"}</b></div><div className="orbitfsData"><span>Release channel</span><b>{chosen?.channel||"stable"}</b></div>
     <div className="orbitfsData"><span>Source commit</span><b>{chosen?.source_sha||chosen?.source_commit||"—"}</b></div>
     <div className="orbitfsData"><span>Artifact checksum</span><b>{chosen?.checksum||chosen?.sha256||"—"}</b></div>
    </div>
   </section>

   <section className="orbitfsCard">
    <div className="orbitfsCardHeader"><div><div className="orbitfsKicker">Manifest targeting</div><h2>Component update</h2></div></div>
    <div className="orbitfsDataGrid">
     <div className="orbitfsData"><span>Components</span><b>{components.length?components.join(", "):"—"}</b></div>
     <div className="orbitfsData"><span>Minimum version</span><b>{manifest.minimum_version||"—"}</b></div>
     <div className="orbitfsData"><span>Required</span><b>{manifest.required===true?"Yes":"No"}</b></div>
     <div className="orbitfsData"><span>Rollback version</span><b>{manifest.rollback_version||"—"}</b></div>
    </div>
   </section>
  </div>

  <section className="orbitfsCard" style={{marginTop:12}}>
   <div className="orbitfsCardHeader"><div><div className="orbitfsKicker">Version control</div><h2>Release history</h2></div></div>
   {releases.length?<div className="orbitfsReleaseList">{releases.map((r:any)=><button key={r.id} type="button" className={`orbitfsRelease ${selected===r.id?"selected":""}`} onClick={()=>setSelected(r.id)}><div><strong>{r.version||r.id}</strong><small>{r.status||"draft"} · {r.review_status||r.reviewStatus||"pending review"}</small><p>{r.changelog||r.notes||"No changelog recorded."}</p><small>{r.source_repo||"Source repository not recorded"} · {r.source_ref||"ref not recorded"}</small></div><span className="orbitfsBadge">{selected===r.id?"Selected":"Update"}</span></button>)}</div>:<div className="orbitfsEmpty">No update releases are currently recorded in License Master.</div>}
  </section>

  <section className="orbitfsCard" style={{marginTop:12}}>
   <div className="orbitfsCardHeader"><div><div className="orbitfsKicker">Authority boundaries</div><h2>Release control responsibilities</h2></div></div>
   <div className="orbitfsAuthority">
    <div className="orbitfsAuthorityRow"><b>Technical approval</b><span>License Master validates and approves the update before Billing Store performs final customer-facing publication.</span></div>
    <div className="orbitfsAuthorityRow"><b>Manifest targeting</b><span>The release manifest identifies the components and update targets. It is the source of truth for the customer update deployer.</span></div>
    <div className="orbitfsAuthorityRow"><b>Rollback</b><span>Rollback metadata is recorded with the release. Actual customer rollback is executed by the customer deployment system.</span></div>
    <div className="orbitfsAuthorityRow"><b>Provider execution</b><span>This admin release screen never accepts customer provider credentials and never deploys customer infrastructure.</span></div>
    <div className="orbitfsAuthorityRow"><b>Supported components</b><span>{UPDATE_PRODUCTS.join(", ")}.</span></div>
   </div>
  </section>
 </main>
}
