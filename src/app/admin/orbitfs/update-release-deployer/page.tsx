"use client";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import DeliveryControls from "../DeliveryControls";

type UpdateRelease={
 id:string;version:string;channel?:string;status?:string;reviewStatus?:string;releaseType?:string;
 title?:string;description?:string;changelog?:string;customerNotes?:string;internalNotes?:string;
 severity?:string;required?:boolean;rollout?:string;minimumVersion?:string|null;rollbackVersion?:string|null;
 components?:string[];sourceCommit?:string|null;sourceRepo?:string|null;sourceRef?:string|null;checksum?:string|null;
 validation?:{status?:string;checks?:Array<{key?:string;ok?:boolean;message?:string;fix?:string}>}|null;
 publishedAt?:string|null;updatedAt?:string|null;
};

export default function OrbitFSUpdateReleaseDeployer(){
 const sb=useMemo(()=>createClient(),[]);
 const [releases,setReleases]=useState<UpdateRelease[]>([]);
 const [selectedId,setSelectedId]=useState("");
 const [busy,setBusy]=useState("");
 const [message,setMessage]=useState("");
 const [editing,setEditing]=useState(false);
 const [draft,setDraft]=useState({title:"",description:"",changelog:"",customer_notes:"",internal_notes:"",severity:"normal",required:false,rollout:"public",minimum_version:"",rollback_version:""});

 async function auth(){const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)throw Error("Administrator session expired. Sign in again.");return {Authorization:"Bearer "+session.access_token};}
 async function load(){
  setBusy("load");setMessage("");
  try{
   const r=await fetch("/api/admin/orbitfs/release-handoff?action=history&type=update",{headers:{...(await auth()),Accept:"application/json"},cache:"no-store"});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not load Update releases");
   const rows=(Array.isArray(j.releases)?j.releases:[]).filter((x:any)=>String(x.releaseType||x.release_type||"").toLowerCase()==="update");
   setReleases(rows);
   setSelectedId(current=>rows.some((x:UpdateRelease)=>x.id===current)?current:(rows.find((x:UpdateRelease)=>x.status!=="published")?.id||rows[0]?.id||""));
  }catch(e:any){setMessage(e?.message||"Could not load Update release state")}finally{setBusy("")}
 }
 useEffect(()=>{void load()},[]);

 const selected=releases.find(r=>r.id===selectedId)||releases[0]||null;
 const pending=useMemo(()=>releases.filter(r=>r.status!=="published"),[releases]);
 const published=useMemo(()=>releases.filter(r=>r.status==="published"),[releases]);
 const validationPassed=selected?.validation?.status==="passed";
 const reviewApproved=selected?.reviewStatus==="approved";
 const canPublish=Boolean(selected&&selected.status!=="published"&&validationPassed&&reviewApproved&&selected.checksum);

 function beginEdit(r:UpdateRelease){
  setSelectedId(r.id);
  setDraft({title:r.title||"",description:r.description||"",changelog:r.changelog||"",customer_notes:r.customerNotes||"",internal_notes:r.internalNotes||"",severity:r.severity||"normal",required:r.required===true,rollout:r.rollout||"public",minimum_version:r.minimumVersion||"",rollback_version:r.rollbackVersion||""});
  setEditing(true);
 }
 async function savePresentation(){
  if(!selected)return;
  setBusy("edit");setMessage("");
  try{
   const r=await fetch("/api/admin/orbitfs/release-presentation",{method:"PATCH",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify({releaseId:selected.id,...draft})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not update release");
   setEditing(false);setMessage("Update release details saved.");await load();
  }catch(e:any){setMessage(e?.message||"Could not update release")}finally{setBusy("")}
 }
 async function publish(){
  if(!selected||!canPublish)return;
  setBusy("publish");setMessage("");
  try{
   const r=await fetch("/api/admin/orbitfs/release-publish",{method:"POST",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify({releaseId:selected.id})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not publish update");
   setMessage("Update published to the customer portal.");await load();
  }catch(e:any){setMessage(e?.message||"Could not publish update")}finally{setBusy("")}
 }
 async function unpublish(r:UpdateRelease){
  if(!confirm("Unpublish v"+r.version+" from the customer portal?"))return;
  setBusy("unpublish:"+r.id);setMessage("");
  try{
   const res=await fetch("/api/admin/orbitfs/release-control",{method:"POST",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify({action:"withdraw",releaseId:r.id})});
   const j=await res.json().catch(()=>({}));
   if(!res.ok)throw Error(j.error||"Could not unpublish update");
   setMessage("Update removed from customer publication.");await load();
  }catch(e:any){setMessage(e?.message||"Could not unpublish update")}finally{setBusy("")}
 }

 return <main className="orbitAdminPage">
  <header className="orbitAdminHeader">
   <div><p className="eyebrow">ORBITFS CONTROL · UPDATES</p><h1>Update releases</h1><p className="muted">Final customer publication workspace for technically approved, validated manifest-driven updates.</p></div>
   <div className="orbitAdminActions"><button className="secondary" onClick={()=>void load()} disabled={busy==="load"}>{busy==="load"?"Refreshing…":"Refresh"}</button></div>
  </header>

  {message&&<div className="orbitInlineNotice">{message}</div>}
  <DeliveryControls compact />

  <section className="orbitCompactPanel">
   <div className="orbitPanelHead"><div><p className="eyebrow">FINAL REVIEW</p><h2>Publication queue</h2></div><span className="orbitCount">{pending.length} pending</span></div>
   <div className="orbitSplit">
    <div className="orbitReleaseQueue">
     {pending.map(r=><button key={r.id} type="button" className={"orbitReleaseRow "+(selected?.id===r.id?"selected":"")} onClick={()=>setSelectedId(r.id)}>
      <div><b>v{r.version}</b><span>{r.title||"OrbitFS update"} · {r.channel||"stable"}</span></div>
      <div className="orbitRowMeta"><span className={r.validation?.status==="passed"?"state ready":"state"}>{r.validation?.status||"validation pending"}</span><span className={r.reviewStatus==="approved"?"state ready":"state"}>{r.reviewStatus||"review pending"}</span></div>
     </button>)}
     {!pending.length&&<div className="orbitEmptyCompact">No Update releases are waiting for final publication.</div>}
    </div>

    <div className="orbitReviewPane">
     {selected?<>
      <div className="orbitReviewTop"><div><small>SELECTED UPDATE</small><h3>v{selected.version}</h3></div><span className={selected.status==="published"?"state ready":"state"}>{selected.status||"pending"}</span></div>
      <div className="orbitFactGrid">
       <div><span>Technical review</span><b>{selected.reviewStatus||"Pending"}</b></div>
       <div><span>Validation</span><b>{selected.validation?.status||"Not run"}</b></div>
       <div><span>Channel</span><b>{selected.channel||"stable"}</b></div>
       <div><span>Required</span><b>{selected.required?"Yes":"No"}</b></div>
       <div><span>Minimum Base</span><b>{selected.minimumVersion||"—"}</b></div>
       <div><span>Rollback</span><b>{selected.rollbackVersion||"—"}</b></div>
       <div className="wide"><span>Components</span><b>{selected.components?.length?selected.components.join(", "):"—"}</b></div>
       <div className="wide"><span>Checksum</span><b className="mono">{selected.checksum||"—"}</b></div>
      </div>
      <div className="orbitCheckLine"><span className={reviewApproved?"ok":""}>Technical approval</span><span className={validationPassed?"ok":""}>Validation</span><span className={selected.checksum?"ok":""}>Artifact</span><span className={selected.status==="published"?"ok":canPublish?"ready":""}>Portal</span></div>
      {selected.validation?.status==="failed"&&<div className="orbitValidationList">{(selected.validation.checks||[]).filter(c=>!c.ok).map((c,i)=><div key={c.key||i}><b>{c.key||"Validation check"}</b><span>{c.message||"Validation failed."}</span>{c.fix&&<small>Fix: {c.fix}</small>}</div>)}</div>}
      <div className="orbitAdminActions">
       <button className="secondary" onClick={()=>beginEdit(selected)}>Edit</button>
       {selected.status!=="published"&&<button onClick={()=>void publish()} disabled={!canPublish||busy==="publish"}>{busy==="publish"?"Publishing…":"Publish to customer portal"}</button>}
       {selected.status==="published"&&<button className="secondary" onClick={()=>void unpublish(selected)} disabled={busy.startsWith("unpublish")}>Unpublish</button>}
      </div>
     </>:<div className="orbitEmptyCompact">Select an Update release to review.</div>}
    </div>
   </div>
  </section>

  <section className="orbitCompactPanel">
   <div className="orbitPanelHead"><div><p className="eyebrow">RELEASE HISTORY</p><h2>Update history</h2></div><span className="orbitCount">{releases.length}</span></div>
   <div className="orbitHistoryTable">
    {releases.map(r=><div className="orbitHistoryRow" key={r.id}>
     <div><b>v{r.version}</b><span>{r.title||"OrbitFS update"}</span></div>
     <span>{r.channel||"stable"}</span>
     <span>{r.status||"draft"}</span>
     <div className="orbitRowActions"><button className="secondary" onClick={()=>beginEdit(r)}>Edit</button><button className="secondary" onClick={()=>setSelectedId(r.id)}>View</button>{r.status==="published"&&<button className="secondary" onClick={()=>void unpublish(r)}>Unpublish</button>}</div>
    </div>)}
    {!releases.length&&<div className="orbitEmptyCompact">No Update release history is available.</div>}
   </div>
  </section>

  {editing&&selected&&<div className="orbitModalBackdrop" onMouseDown={()=>setEditing(false)}>
   <div className="orbitModal" onMouseDown={e=>e.stopPropagation()}>
    <div className="orbitPanelHead"><div><p className="eyebrow">UPDATE PRESENTATION</p><h2>Edit v{selected.version}</h2></div><button className="secondary" onClick={()=>setEditing(false)}>Close</button></div>
    <div className="orbitFormGrid">
     <label>Title<input value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
     <label>Severity<select value={draft.severity} onChange={e=>setDraft({...draft,severity:e.target.value})}><option value="normal">Normal</option><option value="important">Important</option><option value="critical">Critical</option></select></label>
     <label className="wide">Description<textarea rows={3} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
     <label className="wide">Changelog<textarea rows={6} value={draft.changelog} onChange={e=>setDraft({...draft,changelog:e.target.value})}/></label>
     <label className="wide">Customer notes<textarea rows={4} value={draft.customer_notes} onChange={e=>setDraft({...draft,customer_notes:e.target.value})}/></label>
     <label>Minimum Base<input value={draft.minimum_version} onChange={e=>setDraft({...draft,minimum_version:e.target.value})}/></label>
     <label>Rollback version<input value={draft.rollback_version} onChange={e=>setDraft({...draft,rollback_version:e.target.value})}/></label>
     <label className="orbitCheckLabel"><input type="checkbox" checked={draft.required} onChange={e=>setDraft({...draft,required:e.target.checked})}/> Required update</label>
    </div>
    <div className="orbitAdminActions"><button onClick={()=>void savePresentation()} disabled={busy==="edit"}>{busy==="edit"?"Saving…":"Save changes"}</button><button className="secondary" onClick={()=>setEditing(false)}>Cancel</button></div>
   </div>
  </div>}
 </main>
}
