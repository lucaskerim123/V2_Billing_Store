"use client";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

type Release={
 id:string;version:string;channel?:string;status?:string;reviewStatus?:string;releaseType?:string;
 title?:string;description?:string;changelog?:string;customerNotes?:string;sourceCommit?:string;sourceRepo?:string;sourceRef?:string;
 artifactName?:string;artifactRunId?:number|null;checksum?:string;publishedAt?:string|null;updatedAt?:string|null;
 validation?:{status?:string;checks?:Array<{key?:string;ok?:boolean;message?:string}>}|null;
};
type ReleaseChannel={id?:string;channel:string;label?:string;enabled?:boolean;customer_visible?:boolean};

export default function BaseDeploymentAdmin(){
 const sb=useMemo(()=>createClient(),[]);
 const [releases,setReleases]=useState<Release[]>([]);
 const [channels,setChannels]=useState<ReleaseChannel[]>([]);
 const [selectedId,setSelectedId]=useState("");
 const [targetChannel,setTargetChannel]=useState("");
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState("");
 const [message,setMessage]=useState("");
 const [editing,setEditing]=useState(false);
 const [draft,setDraft]=useState({title:"",description:"",changelog:"",customer_notes:""});

 async function auth(){const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)throw Error("Administrator session expired. Sign in again.");return {Authorization:"Bearer "+session.access_token};}
 async function load(){
  setLoading(true);setMessage("");
  try{
   const r=await fetch("/api/admin/orbitfs/release-handoff?action=history&type=base",{headers:await auth(),cache:"no-store"});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not load Base releases from License Manager");
   const rows=Array.isArray(j.releases)?j.releases:[];
   setReleases(rows);
   setChannels(Array.isArray(j.channels)?j.channels:[]);
   setSelectedId(current=>rows.some((x:Release)=>x.id===current)?current:(rows.find((x:Release)=>x.status!=="published")?.id||rows[0]?.id||""));
  }catch(e:any){setMessage(e?.message||"Could not load Base release state")}finally{setLoading(false)}
 }
 useEffect(()=>{void load()},[]);
 const selected=releases.find(r=>r.id===selectedId)||releases[0]||null;
 const queue=useMemo(()=>releases.filter(r=>r.status!=="published"),[releases]);
 const published=useMemo(()=>releases.filter(r=>r.status==="published"),[releases]);

 const validationPassed=selected?.validation?.status==="passed";
 const reviewApproved=selected?.reviewStatus==="approved";
 const artifactReady=Boolean(selected?.artifactName||selected?.checksum);
 const presentationReady=Boolean(String(selected?.title||"").trim()&&String(selected?.changelog||"").trim());
 const portalPublished=selected?.status==="published";
 const canPublish=Boolean(selected&&validationPassed&&reviewApproved&&artifactReady&&presentationReady);
 const customerChannels=channels.filter(ch=>ch.enabled!==false&&ch.customer_visible!==false);

 function beginEdit(r:Release){setSelectedId(r.id);setDraft({title:r.title||"",description:r.description||"",changelog:r.changelog||"",customer_notes:r.customerNotes||""});setEditing(true)}
 async function changeChannel(){
  if(!selected||!targetChannel)return;
  setBusy("channel");setMessage("");
  try{
   const r=await fetch("/api/admin/orbitfs/release-promote",{method:"POST",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify({releaseId:selected.id,targetChannel})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not change Base release channel");
   setMessage(`Approved Base candidate copied to ${targetChannel}. It remains unpublished until final publication.`);
   setTargetChannel("");await load();
  }catch(e:any){setMessage(e?.message||"Could not change Base release channel")}finally{setBusy("")}
 }

 async function publishBase(){
  if(!selected)return;
  setBusy("publish");setMessage("");
  try{
   const r=await fetch("/api/admin/orbitfs/release-publish",{method:"POST",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify({releaseId:selected.id})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not publish Base release");
   setMessage(`Base v${selected.version} published to the Customer Portal/deployer.`);
   await load();
  }catch(e:any){setMessage(e?.message||"Could not publish Base release")}finally{setBusy("")}
 }

 async function savePresentation(){
  if(!selected)return;
  setBusy("edit");setMessage("");
  try{
   const r=await fetch("/api/admin/orbitfs/release-presentation",{method:"PATCH",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify({releaseId:selected.id,...draft})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not update customer-facing release details");
   setMessage("Customer-facing Base release details updated.");
   setEditing(false);await load();
  }catch(e:any){setMessage(e?.message||"Could not update release details")}finally{setBusy("")}
 }

 const stage=(done:boolean,current:boolean)=>"orbitStage "+(done?"done":current?"active":"");

 return <main className="orbitAdminPage">
  <header className="orbitAdminHeader">
   <div><p className="eyebrow">ORBITFS CONTROL · BASE RELEASES</p><h1>Base deployment</h1><p className="muted">Compact intake, readiness review and customer publication view. Technical approval remains authoritative in License Manager.</p></div>
   <div className="orbitAdminActions"><button className="orbitAction orbitActionSecondary" onClick={()=>void load()} disabled={loading}>{loading?"Refreshing…":"Refresh"}</button><a className="buttonlink orbitAction orbitActionSecondary" href="https://panel.incendiarynetworks.cc/releases/base" target="_blank" rel="noreferrer">Open License Manager</a></div>
  </header>

  {message&&<div className="orbitInlineNotice">{message}</div>}
  <section className="orbitCompactPanel">
   <div className="orbitPanelHead"><div><p className="eyebrow">RELEASE INTAKE</p><h2>Base release flow</h2></div><span className="orbitCount">{queue.length} pending</span></div>
   <div className="orbitPipeline">
    <div className={stage(Boolean(selected),true)}><span>1</span><div><b>Intake</b><small>{selected?"v"+selected.version:"Waiting for release"}</small></div></div>
    <div className={stage(validationPassed,Boolean(selected)&&!validationPassed)}><span>2</span><div><b>Validation</b><small>{selected?.validation?.status||"not run"}</small></div></div>
    <div className={stage(reviewApproved,validationPassed&&!reviewApproved)}><span>3</span><div><b>Technical review</b><small>{selected?.reviewStatus||"pending"}</small></div></div>
    <div className={stage(portalPublished,canPublish&&!portalPublished)}><span>4</span><div><b>Customer publication</b><small>{portalPublished?"live in portal":canPublish?"ready to publish":"blocked"}</small></div></div>
   </div>

   <div className="orbitSplit">
    <div className="orbitReleaseQueue">
     {queue.length?queue.map(r=><button key={r.id} type="button" className={"orbitReleaseRow "+(selected?.id===r.id?"selected":"")} onClick={()=>setSelectedId(r.id)}>
      <div><b>v{r.version}</b><span>{r.title||"Base release"} · {r.channel||"stable"}</span></div>
      <div className="orbitRowMeta"><span className={r.validation?.status==="passed"?"state ready":"state"}>{r.validation?.status||"validation pending"}</span><span className={r.reviewStatus==="approved"?"state ready":"state"}>{r.reviewStatus||"review pending"}</span></div>
     </button>):<div className="orbitEmptyCompact">No Base releases are waiting for review.</div>}
    </div>

    <div className="orbitReviewPane">
     {selected?<><div className="orbitReviewTop"><div><small>SELECTED RELEASE</small><h3>v{selected.version}</h3></div><span className={portalPublished?"state ready":"state"}>{portalPublished?"Published":selected.status||"pending"}</span></div>
      <div className="orbitFactGrid">
       <div><span>Validation</span><b>{selected.validation?.status||"Not run"}</b></div>
       <div><span>Review</span><b>{selected.reviewStatus||"Pending"}</b></div>
       <div><span>Channel</span><b>{selected.channel||"stable"}</b></div>
       <div><span>Artifact</span><b>{artifactReady?"Ready":"Missing"}</b></div>
       <div className="wide"><span>Source</span><b className="mono">{selected.sourceCommit||"—"}</b></div>
       <div className="wide"><span>Checksum</span><b className="mono">{selected.checksum||"—"}</b></div>
      </div>
      <div className="orbitCheckLine"><span className={validationPassed?"ok":""}>Validation</span><span className={reviewApproved?"ok":""}>Approval</span><span className={artifactReady?"ok":""}>Artifact</span><span className={presentationReady?"ok":""}>Portal copy</span><span className={portalPublished?"ok":canPublish?"ready":""}>Portal</span></div>
      <div className="orbitAdminActions">
       <button className="orbitAction orbitActionSecondary" type="button" onClick={()=>beginEdit(selected)}>Edit portal details</button>
       {!portalPublished&&<>
        <select value={targetChannel} onChange={e=>setTargetChannel(e.target.value)} disabled={busy!==""}>
         <option value="">Promote / demote channel…</option>
         {customerChannels.filter(ch=>String(ch.channel)!==String(selected.channel||"")).map(ch=><option key={ch.channel} value={ch.channel}>{ch.label||ch.channel}</option>)}
        </select>
        <button className="orbitAction orbitActionSecondary" type="button" disabled={busy!==""||!targetChannel||!validationPassed||!reviewApproved} onClick={()=>void changeChannel()}>{busy==="channel"?"Changing…":"Create channel candidate"}</button>
        <button className={"orbitAction "+(canPublish?"orbitActionPrimary":"orbitActionSecondary")} type="button" disabled={busy!==""||!canPublish} onClick={()=>void publishBase()}>{busy==="publish"?"Publishing…":"Publish to Customer Portal"}</button>
       </>}
       {portalPublished&&<span className="state ready">Available to customers</span>}
      </div>
      {!portalPublished&&!presentationReady&&<small className="muted">Add a customer-facing title and changelog before publication.</small>}
     </>:<div className="orbitEmptyCompact">Select a release to review.</div>}
    </div>
   </div>
  </section>

  <section className="orbitCompactPanel">
   <div className="orbitPanelHead"><div><p className="eyebrow">RELEASE HISTORY</p><h2>Published Base releases</h2></div><span className="orbitCount">{published.length}</span></div>
   <div className="orbitHistoryTable">
    {published.map(r=><div className="orbitHistoryRow" key={r.id}>
     <div><b>v{r.version}</b><span>{r.title||"Base release"}</span></div>
     <span>{r.channel||"stable"}</span>
     <span>{r.publishedAt?new Date(r.publishedAt).toLocaleString():"Published"}</span>
     <div className="orbitRowActions"><button className="orbitAction orbitActionSecondary" onClick={()=>beginEdit(r)}>Edit</button><button className="orbitAction orbitActionQuiet" onClick={()=>setSelectedId(r.id)}>View</button></div>
    </div>)}
    {!published.length&&<div className="orbitEmptyCompact">No published Base release history yet.</div>}
   </div>
  </section>

  {editing&&selected&&<div className="orbitModalBackdrop" onMouseDown={()=>setEditing(false)}>
   <div className="orbitModal" onMouseDown={e=>e.stopPropagation()}>
    <div className="orbitPanelHead"><div><p className="eyebrow">CUSTOMER PRESENTATION</p><h2>Edit v{selected.version}</h2></div><button className="orbitAction orbitActionQuiet" onClick={()=>setEditing(false)}>Close</button></div>
    <label>Title<input value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
    <label>Description<textarea rows={3} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
    <label>Changelog<textarea rows={6} value={draft.changelog} onChange={e=>setDraft({...draft,changelog:e.target.value})}/></label>
    <label>Customer notes<textarea rows={4} value={draft.customer_notes} onChange={e=>setDraft({...draft,customer_notes:e.target.value})}/></label>
    <div className="orbitAdminActions"><button className="orbitAction orbitActionPrimary" onClick={()=>void savePresentation()} disabled={busy==="edit"}>{busy==="edit"?"Saving…":"Save portal details"}</button><button className="orbitAction orbitActionQuiet" onClick={()=>setEditing(false)}>Cancel</button></div>
   </div>
  </div>}
 </main>
}
