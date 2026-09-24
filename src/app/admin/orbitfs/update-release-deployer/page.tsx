"use client";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import DeliveryControls from "../DeliveryControls";

const UPDATE_PRODUCTS=["orbitfs_base","orbitfs_mcp","orbitfs_apex","orbitfs_studio"];

export default function OrbitFSUpdateReleaseDeployer(){
 const sb=useMemo(()=>createClient(),[]);
 const [releases,setReleases]=useState<any[]>([]),[channels,setChannels]=useState<any[]>([]),[selected,setSelected]=useState<string>(""),[target,setTarget]=useState(""),[busy,setBusy]=useState(false),[msg,setMsg]=useState("");
 async function adminHeaders():Promise<Record<string,string>>{const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)throw Error("Administrator session expired. Sign in again.");return {Authorization:`Bearer ${session.access_token}`};}
 async function load(){
  setBusy(true);setMsg("");
  try{
   const auth=await adminHeaders();
   const r=await fetch("/api/admin/orbitfs/release-handoff?action=history&type=update",{headers:{...auth,Accept:"application/json"},cache:"no-store"});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||`License Master returned HTTP ${r.status}`);
   const rows=(Array.isArray(j.releases)?j.releases:Array.isArray(j)?j:[]).filter((x:any)=>String(x.release_type||x.releaseType||"").toLowerCase()==="update").sort((a:any,b:any)=>String(b.updatedAt||b.updated_at||b.created_at||"").localeCompare(String(a.updatedAt||a.updated_at||a.created_at||"")));
   setReleases(rows);setSelected(current=>rows.some((r:any)=>r.id===current)?current:(rows[0]?.id||""));const cr=await fetch("/api/admin/orbitfs/release-channels",{headers:auth,cache:"no-store"});const cj=await cr.json().catch(()=>({}));setChannels((cj.channels||[]).filter((x:any)=>x.enabled&&x.customer_visible));
  }catch(e:any){setMsg(e instanceof TypeError?"Could not reach the License Master connection endpoint. Check the Billing Store → License Master connection and server-side API configuration.":(e?.message||"Could not load update release state."))}
  finally{setBusy(false)}
 }
 useEffect(()=>{void load()},[]);
 const chosen=releases.find(r=>r.id===selected)||releases[0]||null;
 async function promote(){if(!chosen||!target)return;setBusy(true);setMsg("");try{const auth=await adminHeaders();const r=await fetch("/api/admin/orbitfs/release-promote",{method:"POST",headers:{...auth,"content-type":"application/json"},body:JSON.stringify({releaseId:chosen.id,targetChannel:target})}),j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||"Could not promote release");setMsg("Release promoted to "+target+".");setTarget("");await load()}catch(e:any){setMsg(e?.message||"Could not promote release")}finally{setBusy(false)}}
 async function publishUpdate(){if(!chosen)return;setBusy(true);setMsg("");try{const auth=await adminHeaders();const r=await fetch("/api/admin/orbitfs/release-publish",{method:"POST",headers:{...auth,"content-type":"application/json"},body:JSON.stringify({releaseId:chosen.id})}),j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||"Could not publish update");setMsg("Update published to the Customer Portal.");await load()}catch(e:any){setMsg(e?.message||"Could not publish update")}finally{setBusy(false)}}
 const manifest=chosen?.manifest&&typeof chosen.manifest==="object"?chosen.manifest:{components:chosen?.components||[],validation:chosen?.validation||null,minimumVersion:chosen?.minimumVersion,rollbackVersion:chosen?.rollbackVersion,required:chosen?.required,title:chosen?.title};
 const components=Array.isArray(manifest.components)?manifest.components:[];
 return <main className="orbitfsControlPage">
  <section className="orbitfsControlHero">
   <div><div className="orbitfsEyebrow">MY ORBITFS · RELEASE UPDATES</div><h1>Update Release Control</h1><p>Version control, technical validation state, manifest targeting and rollback metadata for OrbitFS component updates. Customer infrastructure deployment is deliberately outside this screen.</p></div>
   <div className="orbitfsHeroActions"><button type="button" onClick={()=>void load()} disabled={busy}>{busy?"Refreshing…":"Refresh"}</button></div>
  </section>

  {msg&&<div className="orbitfsNotice">{msg}</div>}
  <DeliveryControls compact />
  {chosen?.manifest?.validation?.status === "failed" && <section className="orbitfsCard" style={{marginTop:12,border:"1px solid currentColor"}}>
   <div className="orbitfsCardHeader"><div><div className="orbitfsKicker">VALIDATION FAILED</div><h2>Release is blocked</h2><p className="orbitfsMuted">Fix the failed checks below, then re-run validation in License Master. Nothing should be published while validation is failed.</p></div></div>
   <div>{(Array.isArray(chosen.manifest.validation.checks)?chosen.manifest.validation.checks:[]).filter((c:any)=>!c.ok).map((c:any,i:number)=><div key={c.key||i} style={{padding:"10px 0",borderTop:"1px solid rgba(127,127,127,.2)"}}><b>✕ {c.key||"check"}</b><div className="orbitfsMuted">{c.message||"Validation check failed."}</div>{c.fix&&<div className="orbitfsMuted" style={{marginTop:4}}><b>Fix:</b> {c.fix}</div>}<pre style={{whiteSpace:"pre-wrap",marginTop:6}}>{c.prompt||("Fix the "+(c.key||"failed")+" validation check. Inspect the related release data/code, make the smallest production-safe fix, then run validation again.")}</pre></div>)}</div>
  </section>}

  <div className="orbitfsGrid" style={{marginTop:msg?10:0}}>
   <section className="orbitfsCard">
    <div className="orbitfsCardHeader"><div><div className="orbitfsKicker">Selected release</div><h2>{chosen?.version||"No update release selected"}</h2></div><span className="orbitfsBadge">{chosen?.release_type||chosen?.releaseType||"update"}</span></div>
    <div className="orbitfsDataGrid">
     <div className="orbitfsData"><span>Status</span><b>{chosen?.status||"—"}</b></div>
     <div className="orbitfsData"><span>Technical review</span><b>{chosen?.review_status||chosen?.reviewStatus||"—"}</b></div><div className="orbitfsData"><span>Release channel</span><b>{chosen?.channel||"stable"}</b></div>
     <div className="orbitfsData"><span>Source commit</span><b>{chosen?.source_sha||chosen?.source_commit||"—"}</b></div>
     <div className="orbitfsData"><span>Artifact checksum</span><b>{chosen?.checksum||chosen?.sha256||"—"}</b></div>
    </div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
      {chosen&&chosen.status!=="published"&&<button type="button" disabled={busy} onClick={async()=>{const title=prompt("Customer-facing title",String(chosen.manifest?.title||""));if(title===null)return;setBusy(true);try{const auth=await adminHeaders();const r=await fetch("/api/admin/orbitfs/release-presentation",{method:"PATCH",headers:{...auth,"content-type":"application/json"},body:JSON.stringify({releaseId:chosen.id,title})});const j=await r.json().catch(()=>({}));setMsg(r.ok?"Release presentation updated.":j.error||"Could not edit release.")}finally{setBusy(false)}await load()}}>Edit release</button>}
      {chosen&&chosen.status!=="published"&&(chosen.review_status||chosen.reviewStatus)==="approved"&&chosen.manifest?.validation?.status==="passed"&&<button type="button" disabled={busy} onClick={()=>void publishUpdate()}>Publish update to Customer Portal</button>}
      {chosen?.status==="published"&&<button type="button" className="secondary" disabled={busy} onClick={async()=>{if(!confirm("Unpublish this update from the Customer Portal?"))return;setBusy(true);try{const auth=await adminHeaders();const r=await fetch("/api/admin/orbitfs/release-control",{method:"POST",headers:{...auth,"content-type":"application/json"},body:JSON.stringify({action:"withdraw",releaseId:chosen.id})});const j=await r.json().catch(()=>({}));setMsg(r.ok?"Update unpublished.":j.error||"Could not unpublish update.")}finally{setBusy(false)}await load()}}>Unpublish</button>}
    </div>
   </section>

   <section className="orbitfsCard">
    <div className="orbitfsCardHeader"><div><div className="orbitfsKicker">Manifest targeting</div><h2>Component update</h2></div></div>
    <div className="orbitfsDataGrid">
     <div className="orbitfsData"><span>Components</span><b>{components.length?components.join(", "):"—"}</b></div>
     <div className="orbitfsData"><span>Minimum Base version</span><b>{manifest.minimumBaseVersion||manifest.minimum_version||"—"}</b></div>
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
