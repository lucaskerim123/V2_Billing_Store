"use client";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

type UpdateRelease={
 id:string;version:string;channel?:string;status?:string;reviewStatus?:string;releaseType?:string;
 title?:string;description?:string;changelog?:string;customerNotes?:string;internalNotes?:string;
 severity?:string;required?:boolean;rollout?:string;minimumVersion?:string|null;rollbackVersion?:string|null;
 components?:string[];sourceCommit?:string|null;sourceRepo?:string|null;sourceRef?:string|null;checksum?:string|null;
 validation?:{status?:string;checks?:Array<{key?:string;ok?:boolean;message?:string;fix?:string}>}|null;
 publishedAt?:string|null;updatedAt?:string|null;
};

const workingStatus=(value?:string)=>["queued","running","in_progress","processing","validating","reviewing"].includes(String(value||"").toLowerCase());
const failedStatus=(value?:string)=>["failed","failure","error","rejected"].includes(String(value||"").toLowerCase());

export default function OrbitFSUpdateReleaseDeployer(){
 const sb=useMemo(()=>createClient(),[]);
 const [releases,setReleases]=useState<UpdateRelease[]>([]);
 const [selectedId,setSelectedId]=useState("");
 const [busy,setBusy]=useState("");
 const [message,setMessage]=useState("");
 const [pipelineError,setPipelineError]=useState<number|null>(null);
 const [editing,setEditing]=useState(false);
 const [channels,setChannels]=useState<any[]>([]);
 const [targetChannel,setTargetChannel]=useState("");
 const [controls,setControls]=useState<any>({enabled:true,maintenance_mode:false,customer_updates_enabled:true,customer_rollbacks_enabled:true});
 const [draft,setDraft]=useState({title:"",description:"",changelog:"",customer_notes:"",internal_notes:"",severity:"normal",required:false,rollout:"public",minimum_version:"",rollback_version:""});

 async function auth(){const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)throw Error("Administrator session expired. Sign in again.");return {Authorization:"Bearer "+session.access_token};}
 async function load(options?:{silent?:boolean;preserveMessage?:boolean}){
  const silent=options?.silent===true;
  if(!silent)setBusy("load");if(!options?.preserveMessage)setMessage("");
  try{
   const h=await auth();
   const [r,cr,dr]=await Promise.all([
    fetch("/api/admin/orbitfs/release-handoff?action=history&type=update",{headers:{...h,Accept:"application/json"},cache:"no-store"}),
    fetch("/api/admin/orbitfs/release-channels",{headers:h,cache:"no-store"}),
    fetch("/api/admin/orbitfs/deployment-controls",{headers:h,cache:"no-store"})
   ]);
   const j=await r.json().catch(()=>({}));
   const cj=await cr.json().catch(()=>({}));
   const dj=await dr.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not load Update releases");
   const rows=(Array.isArray(j.releases)?j.releases:[]).filter((x:any)=>String(x.releaseType||x.release_type||"").toLowerCase()==="update");
   setReleases(rows);
   setChannels((Array.isArray(cj.channels)?cj.channels:[]).filter((x:any)=>x.enabled!==false&&x.customer_visible!==false));
   if(dr.ok&&dj.settings)setControls(dj.settings);
   setSelectedId(current=>rows.some((x:UpdateRelease)=>x.id===current)?current:(rows.find((x:UpdateRelease)=>x.status!=="published"&&!x.publishedAt)?.id||rows[0]?.id||""));
  }catch(e:any){setMessage(e?.message||"Could not load Update release state")}finally{if(!silent)setBusy("")}
 }
 useEffect(()=>{void load()},[]);

 const selected=releases.find(r=>r.id===selectedId)||releases[0]||null;
 useEffect(()=>{setTargetChannel(selected?.channel||"stable")},[selected?.id,selected?.channel]);
 useEffect(()=>{
  if(!selected||selected.status==="published"||busy)return;
  const timer=setInterval(()=>{if(document.visibilityState==="visible")void load({silent:true,preserveMessage:true})},30000);
  return()=>clearInterval(timer);
 },[selected?.id,selected?.status,busy]);
 const pending=useMemo(()=>releases.filter(r=>r.status!=="published"&&!r.publishedAt),[releases]);
 const published=useMemo(()=>releases.filter(r=>r.status==="published"),[releases]);
 const validationStatus=String(selected?.validation?.status||"");
 const reviewStatus=String(selected?.reviewStatus||"");
 const validationPassed=validationStatus==="passed";
 const reviewApproved=reviewStatus==="approved";
 const validationFailed=failedStatus(validationStatus);
 const reviewFailed=failedStatus(reviewStatus);
 const validationWorking=busy==="validate"||workingStatus(validationStatus);
 const reviewWorking=busy==="approve"||busy==="reject"||workingStatus(reviewStatus);
 const presentationReady=Boolean(selected?.title&&selected?.changelog);
 const rolloutPublishable=String(selected?.rollout||"public").toLowerCase()!=="internal";
 const finalReviewReady=Boolean(selected?.checksum&&selected?.channel&&presentationReady&&rolloutPublishable);
 const finalReviewWorking=busy==="channel"||busy==="edit";
 const portalPublished=selected?.status==="published";
 const publicationWorking=busy==="publish"||workingStatus(selected?.status);
 const canPublish=Boolean(selected&&!portalPublished&&!selected.publishedAt&&validationPassed&&reviewApproved&&finalReviewReady);
 const blockers=[!reviewApproved&&"Technical approval",!validationPassed&&"Validation",!selected?.checksum&&"Artifact checksum",!selected?.channel&&"Customer channel",!presentationReady&&"Customer title + changelog",!rolloutPublishable&&"Internal rollout cannot publish"].filter(Boolean) as string[];
 const stageClass=(state:"done"|"active"|"working"|"error"|"idle")=>"orbitStage "+(state==="idle"?"":state);
 const intakeStage=selected?"done":"active";
 const validationStage=pipelineError===2||validationFailed?"error":validationWorking?"working":validationPassed?"done":selected?"active":"idle";
 const reviewStage=pipelineError===3||reviewFailed?"error":reviewWorking?"working":reviewApproved?"done":validationPassed?"active":"idle";
 const finalReviewStage=pipelineError===4?"error":finalReviewWorking?"working":finalReviewReady&&reviewApproved?"done":reviewApproved?"active":"idle";
 const publicationStage=pipelineError===5?"error":portalPublished?"done":publicationWorking?"working":canPublish?"active":"idle";

 function beginEdit(r:UpdateRelease){
  setSelectedId(r.id);setPipelineError(null);
  setDraft({title:r.title||"",description:r.description||"",changelog:r.changelog||"",customer_notes:r.customerNotes||"",internal_notes:r.internalNotes||"",severity:r.severity||"normal",required:r.required===true,rollout:r.rollout||"public",minimum_version:r.minimumVersion||"",rollback_version:r.rollbackVersion||""});
  setEditing(true);
 }
 async function savePresentation(){
  if(!selected)return;
  setBusy("edit");setMessage("");setPipelineError(null);
  try{
   const r=await fetch("/api/admin/orbitfs/release-presentation",{method:"PATCH",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify({releaseId:selected.id,...draft})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not update release");
   setEditing(false);setMessage("Update release details saved.");await load({preserveMessage:true});
  }catch(e:any){setPipelineError(4);setMessage(e?.message||"Could not update release")}finally{setBusy("")}
 }
 async function setDeploymentControl(patch:any){
  setBusy("control");setMessage("");
  try{
   const r=await fetch("/api/admin/orbitfs/deployment-controls",{method:"POST",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify(patch)});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not update deployment control");
   setControls(j.settings||controls);
   setMessage("Billing Store deployment control updated.");
  }catch(e:any){setMessage(e?.message||"Could not update deployment control")}finally{setBusy("")}
 }
 async function reviewAction(action:"validate"|"approve"|"reject"){
  if(!selected)return;
  let reason="";
  if(action==="reject"){
   reason=prompt("Reason for rejecting this Update release:","")||"";
   if(!reason.trim())return;
  }
  setBusy(action);setMessage("");setPipelineError(null);
  try{
   const r=await fetch("/api/admin/orbitfs/release-handoff",{method:"POST",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify({releaseId:selected.id,action,reason:reason||undefined})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||("Could not "+action+" update release"));
   setMessage(action==="validate"?"Technical validation passed in License Manager.":action==="approve"?"Update technically approved in License Manager.":selected.status==="withdrawn"?"Update rejected and returned to Dev Panel Stage 1.":"Update rejected in License Manager and returned to Dev Panel.");
   await load({preserveMessage:true});
  }catch(e:any){
   setPipelineError(action==="validate"?2:3);
   setMessage(e?.message||("Could not "+action+" update release"));
   await load({preserveMessage:true});
  }finally{setBusy("")}
 }
 async function setChannel(){
  if(!selected||!targetChannel||targetChannel===selected.channel)return;
  if(!reviewApproved||!validationPassed){setMessage("Channel can only be changed after License Manager technical approval and validation.");return}
  setBusy("channel");setMessage("");setPipelineError(null);
  try{
   const r=await fetch("/api/admin/orbitfs/release-promote",{method:"POST",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify({releaseId:selected.id,targetChannel})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not set release channel");
   const nextId=String(j.release?.id||j.id||"");
   setMessage("Release channel set to "+targetChannel+".");
   await load({preserveMessage:true});
   if(nextId)setSelectedId(nextId);
  }catch(e:any){setPipelineError(4);setMessage(e?.message||"Could not set release channel")}finally{setBusy("")}
 }
 async function publish(){
  if(!selected||!canPublish)return;
  if(!confirm("Publish v"+selected.version+" to the "+(selected.channel||"stable")+" customer channel?"))return;
  setBusy("publish");setMessage("");setPipelineError(null);
  try{
   const r=await fetch("/api/admin/orbitfs/release-publish",{method:"POST",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify({releaseId:selected.id})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not publish update");
   setMessage("Update published to the customer portal.");await load({preserveMessage:true});
  }catch(e:any){setPipelineError(5);setMessage(e?.message||"Could not publish update")}finally{setBusy("")}
 }
 async function unpublish(r:UpdateRelease){
  if(!confirm("Unpublish v"+r.version+" from the customer portal?"))return;
  setBusy("unpublish:"+r.id);setMessage("");
  try{
   const res=await fetch("/api/admin/orbitfs/release-control",{method:"POST",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify({action:"withdraw",releaseId:r.id})});
   const j=await res.json().catch(()=>({}));
   if(!res.ok)throw Error(j.error||"Could not unpublish update");
   setMessage("Update removed from customer publication. You can now return it to Dev Panel.");await load({preserveMessage:true});
  }catch(e:any){setMessage(e?.message||"Could not unpublish update")}finally{setBusy("")}
 }
 async function returnToDev(r:UpdateRelease,deleteBillingCopy=false){
  const reason=prompt(deleteBillingCopy?"Reason for deleting the Billing copy and returning this release to Dev Panel:":"Reason for returning this release to Dev Panel:","")||"";
  if(!reason.trim())return;
  if(deleteBillingCopy&&!confirm("Delete Billing-owned presentation data for v"+r.version+" and return it to Dev Panel? License Manager publication/audit history will be retained."))return;
  const key=(deleteBillingCopy?"delete-return:":"return:")+r.id;
  setBusy(key);setMessage("");
  try{
   const res=await fetch("/api/admin/orbitfs/release-control",{method:"POST",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify({action:deleteBillingCopy?"delete_return_to_dev":"return_to_dev",releaseId:r.id,reason})});
   const j=await res.json().catch(()=>({}));
   if(!res.ok)throw Error(j.error||"Could not return update to Dev Panel");
   setMessage(deleteBillingCopy?"Billing copy deleted and release returned to Dev Panel.":"Release returned to Dev Panel for Stage 1 rework.");
   await load({preserveMessage:true});
  }catch(e:any){setMessage(e?.message||"Could not return update to Dev Panel")}finally{setBusy("")}
 }

 return <main className="orbitAdminPage">
  <header className="orbitAdminHeader">
   <div><p className="eyebrow">ORBITFS CONTROL · UPDATES</p><h1>Update releases</h1><p className="muted">Billing Store is the release-control workspace. Validate, approve, configure, publish and unpublish Updates here; License Manager records and enforces the authoritative technical state.</p></div>
   <div className="orbitAdminActions"><button className="orbitAction orbitActionSecondary" onClick={()=>void load()} disabled={busy==="load"}>{busy==="load"?"Refreshing…":"Refresh"}</button><a className="buttonlink orbitAction orbitActionSecondary" href="https://panel.incendiarynetworks.cc/releases/update" target="_blank" rel="noreferrer">Open License Manager</a></div>
  </header>

  {message&&<div className="orbitInlineNotice">{message}</div>}

  <section className="orbitCompactPanel">
   <div className="orbitPanelHead"><div><p className="eyebrow">RELEASE INTAKE</p><h2>Update release flow</h2></div><span className="orbitCount">{pending.length} pending</span></div>
   <div className="orbitPipeline orbitPipelineFive" role="status" aria-live="polite">
    <div className={stageClass(intakeStage)}><span>1</span><div><b>Intake</b><small>{selected?"v"+selected.version:"Waiting for release"}</small></div></div>
    <div className={stageClass(validationStage)}><span>2</span><div><b>Validation</b><small>{validationStage==="working"?"running…":validationStage==="error"?"failed":validationStatus||"not run"}</small></div></div>
    <div className={stageClass(reviewStage)}><span>3</span><div><b>Technical review</b><small>{reviewStage==="working"?"reviewing…":reviewStage==="error"?"rejected / error":reviewStatus||"pending"}</small></div></div>
    <div className={stageClass(finalReviewStage)}><span>4</span><div><b>Final customer review</b><small>{finalReviewStage==="working"?"working…":finalReviewStage==="error"?"error":!reviewApproved?"waiting for approval":finalReviewReady?"ready":"configuration required"}</small></div></div>
    <div className={stageClass(publicationStage)}><span>5</span><div><b>Publication</b><small>{publicationStage==="working"?"publishing…":publicationStage==="error"?"error":portalPublished?"live in portal":canPublish?"ready to publish":"blocked"}</small></div></div>
   </div>
   <div className="orbitSplit">
    <div className="orbitReleaseQueue">
     {pending.map(r=><button key={r.id} type="button" className={"orbitReleaseRow "+(selected?.id===r.id?"selected":"")} onClick={()=>{setSelectedId(r.id);setPipelineError(null)}}>
      <div><b>v{r.version}</b><span>{r.title||"OrbitFS update"} · {r.channel||"stable"}</span></div>
      <div className="orbitRowMeta"><span className={r.validation?.status==="passed"?"state ready":"state"}>{r.validation?.status||"validation pending"}</span><span className={r.reviewStatus==="approved"?"state ready":"state"}>{r.reviewStatus||"review pending"}</span></div>
     </button>)}
     {!pending.length&&<div className="orbitEmptyCompact">No Update releases are waiting for final publication.</div>}
    </div>

    <div className="orbitReviewPane">
     {selected?<>
      <div className="orbitReviewTop"><div><small>SELECTED RELEASE</small><h3>v{selected.version}</h3></div><span className={portalPublished?"state ready":"state"}>{portalPublished?"Published":selected.status||"pending"}</span></div>
      <div className="orbitFactGrid">
       <div><span>Technical review</span><b>{selected.reviewStatus||"Pending"}</b></div>
       <div><span>Validation</span><b>{selected.validation?.status||"Not run"}</b></div>
       <div><span>Channel</span><b>{selected.channel||"stable"}</b></div>
       <div><span>Rollout</span><b>{selected.rollout||"public"}</b></div>
       <div><span>Severity</span><b>{selected.severity||"normal"}</b></div>
       <div><span>Required</span><b>{selected.required?"Yes":"No"}</b></div>
       <div><span>Minimum Base</span><b>{selected.minimumVersion||"—"}</b></div>
       <div><span>Rollback</span><b>{selected.rollbackVersion||"—"}</b></div>
       <div className="wide"><span>Components</span><b>{selected.components?.length?selected.components.join(", "):"—"}</b></div>
       <div className="wide"><span>Checksum</span><b className="mono">{selected.checksum||"—"}</b></div>
      </div>
      <div className="orbitCheckLine"><span className={validationPassed?"ok":validationFailed?"error":""}>Validation</span><span className={reviewApproved?"ok":reviewFailed?"error":""}>Technical approval</span><span className={selected.checksum?"ok":""}>Artifact</span><span className={selected.channel?"ok":""}>Channel</span><span className={presentationReady?"ok":""}>Customer presentation</span><span className={portalPublished?"ok":canPublish?"ready":""}>Portal</span></div>{blockers.length>0&&!portalPublished&&<div className="orbitReviewBlockers"><b>Final review blocked by</b><div>{blockers.map(item=><span key={item}>{item}</span>)}</div></div>}
      <div className="orbitFinalReview">
       <div>
        <label>Customer channel</label>
        <div className="orbitAdminActions">
         <select value={targetChannel} onChange={e=>setTargetChannel(e.target.value)} disabled={selected.status==="published"||busy==="channel"}>
          {channels.map((ch:any)=><option key={ch.channel} value={ch.channel}>{ch.label||ch.channel}{ch.customer_visible===false?" · internal":""}</option>)}
          {!channels.length&&<option value={selected.channel||"stable"}>{selected.channel||"stable"}</option>}
         </select>
         <button className="orbitAction orbitActionChannel" disabled={selected.status==="published"||busy==="channel"||!targetChannel||targetChannel===selected.channel||!reviewApproved||!validationPassed} onClick={()=>void setChannel()}>{busy==="channel"?"Setting…":"Set channel"}</button>
        </div>
        <small className="muted">Changing channel creates the approved customer-publication revision in License Manager; it does not redo technical validation.</small>
       </div>
       <div>
        <b>Final publication review</b>
        <p className="muted">{presentationReady?"Customer title and changelog are ready.":"Add a customer-facing title and changelog before publishing."}</p>
        {selected.customerNotes&&<p><b>Customer notes:</b> {selected.customerNotes}</p>}
        {selected.internalNotes&&<p className="muted"><b>Internal review:</b> {selected.internalNotes}</p>}
       </div>
      </div>
      {selected.validation?.status==="failed"&&<div className="orbitValidationList">{(selected.validation.checks||[]).filter(c=>!c.ok).map((c,i)=><div key={c.key||i}><b>{c.key||"Validation check"}</b><span>{c.message||"Validation failed."}</span>{c.fix&&<small>Fix: {c.fix}</small>}</div>)}</div>}
      <div className="orbitAdminActions">
       {!portalPublished&&!selected.publishedAt&&validationPassed!==true&&<button className="orbitAction orbitActionPrimary" onClick={()=>void reviewAction("validate")} disabled={!!busy}>{busy==="validate"?"Validating…":"Run technical validation"}</button>}
       {!portalPublished&&!selected.publishedAt&&validationPassed===true&&selected.reviewStatus!=="approved"&&<button className="orbitAction orbitActionPrimary" onClick={()=>void reviewAction("approve")} disabled={!!busy}>{busy==="approve"?"Approving…":"Approve technical review"}</button>}
       {!portalPublished&&!selected.publishedAt&&selected.reviewStatus!=="rejected"&&<button className="orbitAction orbitActionDanger" onClick={()=>void reviewAction("reject")} disabled={!!busy}>{busy==="reject"?"Rejecting…":"Reject release"}</button>}
       {selected.status==="withdrawn"&&Boolean(selected.publishedAt)&&<>
        <button className="orbitAction orbitActionDanger" onClick={()=>void returnToDev(selected,false)} disabled={!!busy}>{busy==="return:"+selected.id?"Returning…":"Reject & return to Dev"}</button>
        <button className="orbitAction orbitActionDanger" onClick={()=>void returnToDev(selected,true)} disabled={!!busy}>{busy==="delete-return:"+selected.id?"Deleting…":"Delete Billing copy & return to Dev"}</button>
        <span className="muted">Published License Manager history is retained for audit and rollback; Dev Panel receives a new rejected handback revision.</span>
       </>}
       <button className="orbitAction orbitActionSecondary" onClick={()=>beginEdit(selected)} disabled={!!busy}>Review customer presentation</button>
       {selected.status!=="published"&&!selected.publishedAt&&<button className="orbitAction orbitActionPublish" onClick={()=>void publish()} disabled={!canPublish||busy==="publish"}>{busy==="publish"?"Publishing…":"Publish to customers"}</button>}
       {selected.status==="published"&&<button className="orbitAction orbitActionDanger" onClick={()=>void unpublish(selected)} disabled={busy.startsWith("unpublish")}>Unpublish</button>}
      </div>
     </>:<div className="orbitEmptyCompact">Select an Update release to review.</div>}
    </div>
   </div>
  </section>



  <section className="orbitCompactPanel orbitDeploymentControlStrip">
   <div className="orbitPanelHead"><div><p className="eyebrow">BILLING DEPLOYMENT CONTROL</p><h2>Customer update availability</h2><p className="muted">These Billing Store gates can pause customer Update or rollback execution even when License Manager technical authority remains enabled.</p></div><span className={controls.maintenance_mode?"state":"state ready"}>{controls.maintenance_mode?"Maintenance":"Available"}</span></div>
   <div className="orbitDeploymentToggles">
    <label><input type="checkbox" checked={controls.customer_updates_enabled!==false} disabled={busy==="control"} onChange={e=>void setDeploymentControl({customer_updates_enabled:e.target.checked})}/><span><b>Customer updates</b><small>Allow published Update releases to execute from the customer portal.</small></span></label>
    <label><input type="checkbox" checked={controls.customer_rollbacks_enabled!==false} disabled={busy==="control"} onChange={e=>void setDeploymentControl({customer_rollbacks_enabled:e.target.checked})}/><span><b>Customer rollbacks</b><small>Allow rollback execution when an Update recovery path requires it.</small></span></label>
    <label><input type="checkbox" checked={controls.maintenance_mode===true} disabled={busy==="control"} onChange={e=>void setDeploymentControl({maintenance_mode:e.target.checked})}/><span><b>Deployment maintenance</b><small>Pause customer deployment execution from Billing Store.</small></span></label>
   </div>
  </section>
  <section className="orbitCompactPanel">
   <div className="orbitPanelHead"><div><p className="eyebrow">RELEASE HISTORY</p><h2>Update history</h2></div><span className="orbitCount">{releases.length}</span></div>
   <div className="orbitHistoryTable">
    {releases.map(r=><div className="orbitHistoryRow" key={r.id}>
     <div><b>v{r.version}</b><span>{r.title||"OrbitFS update"}</span></div>
     <span>{r.channel||"stable"}</span>
     <span>{r.status||"draft"}</span>
     <div className="orbitRowActions"><button className="orbitAction orbitActionSecondary" onClick={()=>beginEdit(r)}>Edit</button><button className="orbitAction orbitActionQuiet" onClick={()=>{setSelectedId(r.id);setPipelineError(null)}}>View</button>{r.status==="published"&&<button className="orbitAction orbitActionDanger" onClick={()=>void unpublish(r)}>Unpublish</button>}{r.status==="withdrawn"&&Boolean(r.publishedAt)&&<><button className="orbitAction orbitActionDanger" onClick={()=>void returnToDev(r,false)}>Return to Dev</button><button className="orbitAction orbitActionDanger" onClick={()=>void returnToDev(r,true)}>Delete Billing copy</button></>}</div>
    </div>)}
    {!releases.length&&<div className="orbitEmptyCompact">No Update release history is available.</div>}
   </div>
  </section>

  {editing&&selected&&<div className="orbitModalBackdrop" onMouseDown={()=>setEditing(false)}>
   <div className="orbitModal" onMouseDown={e=>e.stopPropagation()}>
    <div className="orbitPanelHead"><div><p className="eyebrow">UPDATE PRESENTATION</p><h2>Edit v{selected.version}</h2></div><button className="orbitAction orbitActionQuiet" onClick={()=>setEditing(false)}>Close</button></div>
    <div className="orbitFormGrid">
     <label>Title<input value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
     <label>Severity<select value={draft.severity} onChange={e=>setDraft({...draft,severity:e.target.value})}><option value="normal">Normal</option><option value="important">Important</option><option value="critical">Critical</option></select></label>
     <label>Rollout<select value={draft.rollout} onChange={e=>setDraft({...draft,rollout:e.target.value})}><option value="public">Public</option><option value="staged">Staged</option><option value="limited">Limited</option><option value="internal">Internal</option></select></label>
     <label className="wide">Description<textarea rows={3} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
     <label className="wide">Customer changelog<textarea rows={6} value={draft.changelog} onChange={e=>setDraft({...draft,changelog:e.target.value})}/><small className="muted">Customer-facing only. Editing this does not alter the validated artifact or technical changelog.</small></label>
     <label className="wide">Customer notes<textarea rows={4} value={draft.customer_notes} onChange={e=>setDraft({...draft,customer_notes:e.target.value})}/></label>
     <label className="wide">Internal final-review notes<textarea rows={3} value={draft.internal_notes} onChange={e=>setDraft({...draft,internal_notes:e.target.value})}/></label>
     <label>Minimum Base<input value={draft.minimum_version} onChange={e=>setDraft({...draft,minimum_version:e.target.value})}/></label>
     <label>Rollback version<input value={draft.rollback_version} onChange={e=>setDraft({...draft,rollback_version:e.target.value})}/></label>
     <label className="orbitCheckLabel"><input type="checkbox" checked={draft.required} onChange={e=>setDraft({...draft,required:e.target.checked})}/> Required update</label>
    </div>
    <div className="orbitAdminActions"><button className="orbitAction orbitActionPrimary" onClick={()=>void savePresentation()} disabled={busy==="edit"}>{busy==="edit"?"Saving…":"Save review changes"}</button><button className="orbitAction orbitActionQuiet" onClick={()=>setEditing(false)}>Cancel</button></div>
   </div>
  </div>}
 </main>
}
