"use client";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

type Release={
 id:string;version:string;revision?:number;attempt?:number;channel?:string;status?:string;reviewStatus?:string;releaseType?:string;
 title?:string;description?:string;changelog?:string;customerNotes?:string;sourceCommit?:string;sourceRepo?:string;sourceRef?:string;
 artifactName?:string;artifactRunId?:number|null;checksum?:string;publishedAt?:string|null;updatedAt?:string|null;billingPresentation?:boolean;
 validation?:{status?:string;checks?:Array<{key?:string;ok?:boolean;message?:string}>}|null;
};
type ReleaseChannel={id?:string;channel:string;label?:string;enabled?:boolean;customer_visible?:boolean};

const workingStatus=(value?:string)=>["queued","running","in_progress","processing","validating","reviewing"].includes(String(value||"").toLowerCase());
const failedStatus=(value?:string)=>["failed","failure","error","rejected"].includes(String(value||"").toLowerCase());

export default function BaseDeploymentAdmin(){
 const sb=useMemo(()=>createClient(),[]);
 const [releases,setReleases]=useState<Release[]>([]);
 const [channels,setChannels]=useState<ReleaseChannel[]>([]);
 const [selectedId,setSelectedId]=useState("");
 const [targetChannel,setTargetChannel]=useState("");
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState("");
 const [message,setMessage]=useState("");
 const [pipelineError,setPipelineError]=useState<number|null>(null);
 const [editing,setEditing]=useState(false);
 const [draft,setDraft]=useState({title:"",description:"",changelog:"",customer_notes:""});

 async function auth(){const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)throw Error("Administrator session expired. Sign in again.");return {Authorization:"Bearer "+session.access_token};}
 async function load(options?:{silent?:boolean;preserveMessage?:boolean}){
  const silent=options?.silent===true;
  if(!silent)setLoading(true);
  if(!options?.preserveMessage)setMessage("");
  try{
   const h=await auth();
   const [r,cr]=await Promise.all([
    fetch("/api/admin/orbitfs/release-handoff?action=history&type=base",{headers:h,cache:"no-store"}),
    fetch("/api/admin/orbitfs/release-channels",{headers:h,cache:"no-store"})
   ]);
   const j=await r.json().catch(()=>({}));
   const cj=await cr.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not load Base releases from License Manager");
   if(!cr.ok)throw Error(cj.error||"Could not load shared release channels from License Manager");
   const rows=(Array.isArray(j.releases)?j.releases:[]).filter((x:Release)=>String(x.releaseType||"").trim().toLowerCase()==="base");
   setReleases(rows);
   setChannels(Array.isArray(cj.channels)?cj.channels:[]);
   setSelectedId(current=>rows.some((x:Release)=>x.id===current)?current:(rows.find((x:Release)=>x.status!=="published"&&!x.publishedAt)?.id||rows[0]?.id||""));
  }catch(e:any){setMessage(e?.message||"Could not load Base release state")}finally{if(!silent)setLoading(false)}
 }
 useEffect(()=>{void load()},[]);
 const selected=releases.find(r=>r.id===selectedId)||releases[0]||null;
 const queue=useMemo(()=>releases.filter(r=>r.status!=="published"&&!r.publishedAt),[releases]);
 const published=useMemo(()=>releases.filter(r=>Boolean(r.publishedAt)),[releases]);

 const validationStatus=String(selected?.validation?.status||"");
 const reviewStatus=String(selected?.reviewStatus||"");
 const validationPassed=validationStatus==="passed";
 const reviewApproved=reviewStatus==="approved";
 const validationFailed=failedStatus(validationStatus);
 const reviewFailed=failedStatus(reviewStatus);
 const validationWorking=workingStatus(validationStatus);
 const reviewWorking=workingStatus(reviewStatus);
 const artifactReady=Boolean(selected?.artifactName||selected?.checksum);
 const presentationReady=Boolean(String(selected?.title||"").trim()&&String(selected?.changelog||"").trim());
 const portalPublished=selected?.status==="published";
 const publicationWorking=busy==="channel"||busy==="publish"||busy==="edit"||workingStatus(selected?.status);
 const canPublish=Boolean(selected&&!selected.publishedAt&&validationPassed&&reviewApproved&&artifactReady&&presentationReady);
 const canRepublish=Boolean(selected?.status==="withdrawn"&&selected.publishedAt&&validationPassed&&reviewApproved&&artifactReady&&presentationReady);
 const customerChannels=channels.filter(ch=>ch.enabled!==false&&ch.customer_visible!==false);
 const stageClass=(state:"done"|"active"|"working"|"error"|"idle")=>"orbitStage "+(state==="idle"?"":state);
 const intakeStage=selected?"done":"active";
 const validationStage=pipelineError===2||validationFailed?"error":validationWorking?"working":validationPassed?"done":selected?"active":"idle";
 const reviewStage=pipelineError===3||reviewFailed?"error":reviewWorking?"working":reviewApproved?"done":validationPassed?"active":"idle";
 const publicationStage=pipelineError===4?"error":portalPublished?"done":publicationWorking?"working":(canPublish||canRepublish)?"active":"idle";

 function beginEdit(r:Release){setSelectedId(r.id);setPipelineError(null);setDraft({title:r.title||"",description:r.description||"",changelog:r.changelog||"",customer_notes:r.customerNotes||""});setEditing(true)}
 async function changeChannel(){
  if(!selected||!targetChannel)return;
  setBusy("channel");setMessage("");setPipelineError(null);
  try{
   const r=await fetch("/api/admin/orbitfs/release-promote",{method:"POST",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify({releaseId:selected.id,targetChannel})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not change Base release channel");
   setMessage(`Approved Base candidate copied to ${targetChannel}. It remains unpublished until final publication.`);
   setTargetChannel("");await load();
  }catch(e:any){setPipelineError(4);setMessage(e?.message||"Could not change Base release channel")}finally{setBusy("")}
 }

 async function publishBase(){
  if(!selected)return;
  setBusy("publish");setMessage("");setPipelineError(null);
  try{
   const r=await fetch("/api/admin/orbitfs/release-publish",{method:"POST",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify({releaseId:selected.id})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not publish Base release");
   const publishedRelease=j?.release||j?.result?.release||j?.result||null;
   const publishedAt=publishedRelease?.published_at||publishedRelease?.publishedAt||new Date().toISOString();
   setReleases(current=>current.map(item=>item.id===selected.id?{
     ...item,
     status:"published",
     publishedAt,
     updatedAt:publishedRelease?.updated_at||publishedRelease?.updatedAt||new Date().toISOString()
   }:item));
   setMessage(`Base v${selected.version} published to the Customer Portal/deployer.`);
   await load({silent:true,preserveMessage:true});
  }catch(e:any){setPipelineError(4);setMessage(e?.message||"Could not publish Base release")}finally{setBusy("")}
 }

 async function unpublishBase(r:Release){
  if(!confirm("Unpublish Base v"+r.version+" from customer deployment?"))return;
  setBusy("unpublish:"+r.id);setMessage("");
  try{
   const res=await fetch("/api/admin/orbitfs/release-control",{method:"POST",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify({action:"withdraw",releaseId:r.id})});
   const j=await res.json().catch(()=>({}));
   if(!res.ok)throw Error(j.error||"Could not unpublish Base release");
   setMessage("Base release unpublished. You can republish the same release, delete its Billing presentation, or return it to Dev Panel.");
   await load({silent:true,preserveMessage:true});
  }catch(e:any){setMessage(e?.message||"Could not unpublish Base release")}finally{setBusy("")}
 }

 async function republishBase(r:Release){
  if(!confirm("Republish Base v"+r.version+" to the "+(r.channel||"stable")+" customer channel? This reuses the same License Manager release record and does not create another entry."))return;
  setBusy("republish:"+r.id);setMessage("");setPipelineError(null);
  try{
   const res=await fetch("/api/admin/orbitfs/release-control",{method:"POST",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify({action:"republish",releaseId:r.id})});
   const j=await res.json().catch(()=>({}));
   if(!res.ok)throw Error(j.error||"Could not republish Base release");
   setMessage("Base release republished. No duplicate release entry was created.");
   await load({silent:true,preserveMessage:true});
   setSelectedId(r.id);
  }catch(e:any){setPipelineError(4);setMessage(e?.message||"Could not republish Base release")}finally{setBusy("")}
 }

 async function deleteBillingCopy(r:Release){
  if(!confirm("Delete the Billing-owned customer presentation for Base v"+r.version+"? This will not create, reject, withdraw or return any License Manager release."))return;
  setBusy("delete-copy:"+r.id);setMessage("");
  try{
   const res=await fetch("/api/admin/orbitfs/release-control",{method:"POST",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify({action:"delete_billing_copy",releaseId:r.id})});
   const j=await res.json().catch(()=>({}));
   if(!res.ok)throw Error(j.error||"Could not delete Billing copy");
   setMessage("Billing presentation copy deleted. License Manager release history was left unchanged.");
   await load({silent:true,preserveMessage:true});
  }catch(e:any){setMessage(e?.message||"Could not delete Billing copy")}finally{setBusy("")}
 }

 async function returnToDev(r:Release){
  const reason=prompt("Reason for returning this Base release to Dev Panel:","")||"";
  if(!reason.trim())return;
  setBusy("return:"+r.id);setMessage("");
  try{
   const res=await fetch("/api/admin/orbitfs/release-control",{method:"POST",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify({action:"return_to_dev",releaseId:r.id,reason})});
   const j=await res.json().catch(()=>({}));
   if(!res.ok)throw Error(j.error||"Could not return Base release to Dev Panel");
   setMessage("Base release returned to Dev Panel for Stage 1 rework.");
   await load({silent:true,preserveMessage:true});
  }catch(e:any){setMessage(e?.message||"Could not return Base release to Dev Panel")}finally{setBusy("")}
 }

 async function savePresentation(){
  if(!selected)return;
  setBusy("edit");setMessage("");setPipelineError(null);
  try{
   const r=await fetch("/api/admin/orbitfs/release-presentation",{method:"PATCH",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify({releaseId:selected.id,...draft})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not update customer-facing release details");
   setMessage("Customer-facing Base release details updated.");
   setEditing(false);await load();
  }catch(e:any){setPipelineError(4);setMessage(e?.message||"Could not update release details")}finally{setBusy("")}
 }

 return <main className="orbitAdminPage">
  <header className="orbitAdminHeader">
   <div><p className="eyebrow">ORBITFS CONTROL · BASE RELEASES</p><h1>Base deployment</h1><p className="muted">Compact intake, readiness review and customer publication view. Technical approval remains authoritative in License Manager.</p></div>
   <div className="orbitAdminActions"><button className="orbitAction orbitActionSecondary" onClick={()=>void load()} disabled={loading}>{loading?"Refreshing…":"Refresh"}</button><a className="buttonlink orbitAction orbitActionSecondary" href="https://panel.incendiarynetworks.cc/releases/base" target="_blank" rel="noreferrer">Open License Manager</a></div>
  </header>

  {message&&<div className="orbitInlineNotice">{message}</div>}
  <section className="orbitCompactPanel">
   <div className="orbitPanelHead"><div><p className="eyebrow">RELEASE INTAKE</p><h2>Base release flow</h2></div><span className="orbitCount">{queue.length} pending</span></div>
   <div className="orbitPipeline" role="status" aria-live="polite">
    <div className={stageClass(intakeStage)}><span>1</span><div><b>Intake</b><small>{selected?"v"+selected.version:"Waiting for release"}</small></div></div>
    <div className={stageClass(validationStage)}><span>2</span><div><b>Validation</b><small>{validationStage==="working"?"running…":validationStage==="error"?"failed":validationStatus||"not run"}</small></div></div>
    <div className={stageClass(reviewStage)}><span>3</span><div><b>Technical review</b><small>{reviewStage==="working"?"reviewing…":reviewStage==="error"?"rejected / error":reviewStatus||"pending"}</small></div></div>
    <div className={stageClass(publicationStage)}><span>4</span><div><b>Customer publication</b><small>{publicationStage==="working"?"working…":publicationStage==="error"?"error":portalPublished?"live in portal":canPublish?"ready to publish":"blocked"}</small></div></div>
   </div>

   <div className="orbitSplit">
    <div className="orbitReleaseQueue">
     {queue.length?queue.map(r=><button key={r.id} type="button" className={"orbitReleaseRow "+(selected?.id===r.id?"selected":"")} onClick={()=>{setSelectedId(r.id);setPipelineError(null)}}>
      <div><b>v{r.version}</b><span>{r.title||"Base release"} · {r.channel||"stable"} · Attempt {r.attempt||1} · package r{r.revision||1}</span></div>
      <div className="orbitRowMeta"><span className={r.validation?.status==="passed"?"state ready":"state"}>{r.validation?.status||"validation pending"}</span><span className={r.reviewStatus==="approved"?"state ready":"state"}>{r.reviewStatus||"review pending"}</span></div>
     </button>):<div className="orbitEmptyCompact">No Base releases are waiting for review.</div>}
    </div>

    <div className="orbitReviewPane">
     {selected?<><div className="orbitReviewTop"><div><small>SELECTED RELEASE · Attempt {selected.attempt||1} · package r{selected.revision||1}</small><h3>v{selected.version}</h3></div><span className={portalPublished?"state ready":"state"}>{portalPublished?"Published":selected.status||"pending"}</span></div>
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
       {!portalPublished&&!selected.publishedAt&&<>
        <select value={targetChannel} onChange={e=>setTargetChannel(e.target.value)} disabled={busy!==""}>
         <option value="">Promote / demote channel…</option>
         {customerChannels.filter(ch=>String(ch.channel)!==String(selected.channel||"")).map(ch=><option key={ch.channel} value={ch.channel}>{ch.label||ch.channel}</option>)}
        </select>
        <button className="orbitAction orbitActionSecondary" type="button" disabled={busy!==""||!targetChannel||!validationPassed||!reviewApproved} onClick={()=>void changeChannel()}>{busy==="channel"?"Changing…":"Create channel candidate"}</button>
        <button className={"orbitAction "+(canPublish?"orbitActionPrimary":"orbitActionSecondary")} type="button" disabled={busy!==""||!canPublish} onClick={()=>void publishBase()}>{busy==="publish"?"Publishing…":"Publish to Customer Portal"}</button>
       </>}
       {selected.status==="withdrawn"&&Boolean(selected.publishedAt)&&<>
        <button className="orbitAction orbitActionPrimary" type="button" disabled={busy!==""||!canRepublish} onClick={()=>void republishBase(selected)}>{busy==="republish:"+selected.id?"Republishing…":"Republish to Customer Portal"}</button>
        {selected.billingPresentation&&<button className="orbitAction orbitActionDanger" type="button" disabled={busy!==""} onClick={()=>void deleteBillingCopy(selected)}>{busy==="delete-copy:"+selected.id?"Deleting…":"Delete Billing copy"}</button>}
        <button className="orbitAction orbitActionDanger" type="button" disabled={busy!==""} onClick={()=>void returnToDev(selected)}>{busy==="return:"+selected.id?"Returning…":"Reject & return to Dev"}</button>
        <span className="muted">Republish reuses this same release ID. Delete Billing copy only removes Billing-owned presentation data. Return to Dev is the only action that creates a technical handback revision.</span>
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
     <div className="orbitRowActions"><button className="orbitAction orbitActionSecondary" onClick={()=>beginEdit(r)}>Edit</button><button className="orbitAction orbitActionQuiet" onClick={()=>{setSelectedId(r.id);setPipelineError(null)}}>View</button>{r.status==="published"&&<button className="orbitAction orbitActionDanger" disabled={busy==="unpublish:"+r.id} onClick={()=>void unpublishBase(r)}>{busy==="unpublish:"+r.id?"Unpublishing…":"Unpublish"}</button>}{r.status==="withdrawn"&&<><button className="orbitAction orbitActionPrimary" disabled={busy!==""} onClick={()=>void republishBase(r)}>Republish</button>{r.billingPresentation&&<button className="orbitAction orbitActionDanger" disabled={busy!==""} onClick={()=>void deleteBillingCopy(r)}>Delete Billing copy</button>}<button className="orbitAction orbitActionDanger" disabled={busy!==""} onClick={()=>void returnToDev(r)}>Return to Dev</button></>}</div>
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
