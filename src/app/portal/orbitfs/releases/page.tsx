"use client";

import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";
import {compareOrbitReleaseVersions} from "@/lib/orbitfs-version";

type Release={
  id?:string;releaseId?:string;version?:string;title?:string;description?:string;
  release_type?:string;releaseType?:string;channel?:string;status?:string;
  published_at?:string;publishedAt?:string;changelog?:string;customer_notes?:string;
  components?:string[];minimum_version?:string;minimumVersion?:string;severity?:string;
  required?:boolean;sha256?:string;checksum?:string;
};
type UpdateEvent={id:string;type:string;status:string;message:string;createdAt:string;releaseId:string;releaseVersion:string};
type UpdateProgress={
  installationId:string;installationState:string|null;lastError:string|null;
  installedBaseVersion:string|null;
  appliedUpdate:{releaseId:string;version:string;channel:string;components:string[];appliedAt:string|null}|null;
  events:UpdateEvent[];
};
type Stage=1|2|3|4|5;
type UpdateMode="update"|"rollback";
const stages:{id:Stage;title:string;description:string}[]=[
  {id:1,title:"Installation",description:"Check your installed Base and licence."},
  {id:2,title:"Channel / Update",description:"Choose an authorized published Update."},
  {id:3,title:"Review",description:"Review changes and compatibility."},
  {id:4,title:"Live Progress",description:"Follow actual update execution."},
  {id:5,title:"Finished",description:"See the installed Update and recovery controls."}
];
const idOf=(release:Release|null|undefined)=>String(release?.id||release?.releaseId||"");
const versionOf=(release:Release|null|undefined)=>String(release?.version||"");
const dateLabel=(raw:unknown)=>{if(!raw)return "";const date=new Date(String(raw));return Number.isNaN(date.getTime())?"":date.toLocaleString()};
const isUpdateEvent=(event:UpdateEvent,mode:UpdateMode)=>mode==="rollback"?event.type.startsWith("update.rollback."):event.type.startsWith("update.")&&!event.type.startsWith("update.rollback.");
function phaseStatus(events:UpdateEvent[],started:string,completed:string){
  if(events.some(event=>event.type===completed))return "complete";
  if(events.some(event=>event.type===started))return "running";
  return "waiting";
}

export default function OrbitFSUpdateReleaseSystem(){
  const sb=useMemo(()=>createClient(),[]);
  const [data,setData]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState("");
  const [channel,setChannel]=useState("");
  const [selectedId,setSelectedId]=useState("");
  const [stage,setStage]=useState<Stage>(1);
  const [confirmed,setConfirmed]=useState(false);
  const [progress,setProgress]=useState<UpdateProgress|null>(null);
  const [progressTarget,setProgressTarget]=useState("");
  const [progressMode,setProgressMode]=useState<UpdateMode>("update");
  const [progressIssue,setProgressIssue]=useState("");
  const [rollbackReason,setRollbackReason]=useState("");
  const requestInFlight=useRef(false);
  const completionReported=useRef("");
  const statusInitialised=useRef(false);

  const headers=useCallback(async():Promise<Record<string,string>>=>{
    const {data:{session}}=await sb.auth.getSession();
    if(!session?.access_token)throw Error("Your session has expired. Sign in again.");
    return {Authorization:"Bearer "+session.access_token};
  },[sb]);

  const load=useCallback(async(background=false)=>{
    if(!background)setLoading(true);
    try{
      const abort=new AbortController();
      const timer=setTimeout(()=>abort.abort(),25000);
      try{
        const res=await fetch("/api/orbitfs/status",{headers:await headers(),cache:"no-store",signal:abort.signal});
        const body=await res.json().catch(()=>({}));
        if(!res.ok)throw Error(body.error||"Could not load your Update status.");
        setData(body);
      }finally{clearTimeout(timer)}
    }catch(error:any){
      setMessage(error?.name==="AbortError"?"The update status request timed out. Refresh to retry.":error?.message||"Could not load Update information.");
      if(!background)setData(null);
    }finally{if(!background)setLoading(false)}
  },[headers]);

  useEffect(()=>{void load()},[load]);

  const binding=(data?.bindings||[]).find((value:any)=>value.license_product_key==="orbitfs_base"||value.components?.orbitfs_base||value.components?.orbitfs_panel)||null;
  const install=(data?.installations||[]).find((value:any)=>String(value.license_binding_id)===String(binding?.id))||null;
  const settings=data?.settings||{};
  const allowedChannels:string[]=Array.isArray(settings.release_channels)&&settings.release_channels.length
    ?[...new Set<string>(settings.release_channels.map((value:unknown)=>String(value)))]:["stable"];
  const channelsKey=allowedChannels.join("|");
  const installedChannel=String(install?.release_channel||"");

  useEffect(()=>{
    if(!data)return;
    setChannel(current=>current&&allowedChannels.includes(current)?current:
      installedChannel&&allowedChannels.includes(installedChannel)?installedChannel:allowedChannels[0]);
  },[data,channelsKey,installedChannel]);

  const authorityUnavailable=settings.enabled===false||settings.maintenance_mode===true||
    settings.license_authority_available===false||settings.release_authority_available===false||
    settings.deployment_authority_available===false;
  const updateUnavailable=authorityUnavailable||settings.customer_updates_enabled===false;
  const rollbackUnavailable=authorityUnavailable||settings.customer_rollbacks_enabled===false;
  const publishedUpdates:Release[]=(data?.publishedReleases||[])
    .filter((value:Release)=>String(value.release_type||value.releaseType||"")==="update"&&
      allowedChannels.includes(String(value.channel||"stable"))&&
      (!value.status||String(value.status)==="published"))
    .sort((a:Release,b:Release)=>{
      const published=String(b.published_at||b.publishedAt||"").localeCompare(String(a.published_at||a.publishedAt||""));
      return published||compareOrbitReleaseVersions(versionOf(b),versionOf(a))||0;
    });
  const releases=publishedUpdates.filter(release=>String(release.channel||"stable")===channel);
  const selected=releases.find(release=>idOf(release)===selectedId)||null;
  const latest=releases[0]||null;
  const applied=progress?.appliedUpdate||data?.normalUpdate?.applied||install?.metadata?.appliedUpdate||null;
  const appliedVersion=String(applied?.version||"");
  const appliedId=String(applied?.releaseId||"");
  const baseVersion=String(install?.release_version||"");
  const baseReady=Boolean(install?.vercel_project_id&&baseVersion&&
    ["ready","deployed","active"].includes(String(install?.state||"").toLowerCase()));
  const licenceReady=Boolean(install?.metadata?.licenseRegistration?.valid===true);
  const hasBase=Boolean(install?.vercel_project_id&&baseVersion);
  const blockingBaseOperation=Boolean(data?.activeOperation);
  const selectedComparison=selected&&appliedVersion?compareOrbitReleaseVersions(versionOf(selected),appliedVersion):null;
  const alreadyInstalled=Boolean(selected&&(appliedId&&appliedId===idOf(selected)||
    appliedVersion&&appliedVersion===versionOf(selected)&&String(applied?.channel||channel)===channel));
  const isPrevious=Boolean(selected&&appliedVersion&&selectedComparison!==null&&selectedComparison<=0&&!alreadyInstalled);
  const requiredBase=String(selected?.minimum_version||selected?.minimumVersion||"");
  const compatible=Boolean(!selected||!requiredBase||
    (baseVersion&&compareOrbitReleaseVersions(baseVersion,requiredBase)!==null&&
      (compareOrbitReleaseVersions(baseVersion,requiredBase)??-1)>=0));
  const canInstall=Boolean(selected&&baseReady&&licenceReady&&compatible&&!isPrevious&&!alreadyInstalled&&
    !updateUnavailable&&!blockingBaseOperation&&!busy&&data?.releaseDiscoveryAvailable!==false);

  useEffect(()=>{
    if(!data||statusInitialised.current)return;
    statusInitialised.current=true;
    const bindings=(data.bindings||[]).find((value:any)=>value.license_product_key==="orbitfs_base"||value.components?.orbitfs_base||value.components?.orbitfs_panel);
    const current=(data.installations||[]).find((value:any)=>String(value.license_binding_id)===String(bindings?.id));
    setStage(current?.release_version&&current?.vercel_project_id?2:1);
  },[data]);

  useEffect(()=>{
    if(!selectedId)return;
    if(!releases.some(release=>idOf(release)===selectedId)){
      setSelectedId("");setConfirmed(false);
      setStage(current=>current===3?2:current);
    }
  },[selectedId,channel,Array.from(releases,release=>idOf(release)).join("|")]);

  const refreshProgress=useCallback(async(installationId:string)=>{
    try{
      const result=await fetch("/api/orbitfs/installations/"+encodeURIComponent(installationId)+"/update-status",{
        headers:await headers(),cache:"no-store"
      });
      const payload=await result.json().catch(()=>({}));
      if(!result.ok)throw Error(payload.error||"Could not read Update progress.");
      setProgress(payload as UpdateProgress);
      setProgressIssue("");
      return payload as UpdateProgress;
    }catch(error:any){
      setProgressIssue(error?.message||"Update progress is temporarily unavailable.");
      return null;
    }
  },[headers]);

  useEffect(()=>{
    if(!install?.id)return;
    void refreshProgress(String(install.id));
  },[install?.id,refreshProgress]);

  useEffect(()=>{
    if(stage!==4||!install?.id)return;
    let active=true;
    const tick=async()=>{
      if(!active)return;
      const next=await refreshProgress(String(install.id));
      if(!active||!next||requestInFlight.current)return;
      const target=progressTarget;
      const events=(next.events||[]).filter(event=>isUpdateEvent(event,progressMode)&&
        (target?event.releaseId===target:false));
      const completed=progressMode==="update"?"update.completed":"update.rollback.completed";
      const failed=progressMode==="update"?"update.failed":"update.rollback.failed";
      const success=events.find(event=>event.type===completed);
      const error=events.find(event=>event.type===failed);
      if(success&&completionReported.current!==success.id){
        completionReported.current=success.id;
        setMessage(success.message||"Update operation completed.");
        setBusy("");
        setStage(5);
        await load(true);
      }else if(error){
        setMessage(error.message||"Update operation failed. Review the recorded error.");
        setBusy("");
      }
    };
    void tick();
    const timer=setInterval(()=>{void tick()},4500);
    return()=>{active=false;clearInterval(timer)};
  },[stage,install?.id,progressTarget,progressMode,refreshProgress,load]);

  // Recover a running update after a page reload using only recorded event history.
  useEffect(()=>{
    if(!progress||!install||requestInFlight.current||stage!==2||progressTarget)return;
    const chronological=progress.events.filter(event=>isUpdateEvent(event,"update")&&event.releaseId);
    const latestStart=chronological.find(event=>event.type==="update.started");
    if(!latestStart)return;
    const newerTerminal=chronological.some(event=>(event.type==="update.completed"||event.type==="update.failed")&&
      event.releaseId===latestStart.releaseId&&Date.parse(event.createdAt)>=Date.parse(latestStart.createdAt));
    const recent=Date.now()-Date.parse(latestStart.createdAt)<45*60*1000;
    if(!newerTerminal&&recent){
      setProgressMode("update");
      setProgressTarget(latestStart.releaseId);
      setStage(4);
    }
  },[progress?.installationId,progress?.events?.[0]?.id,install?.id,stage,progressTarget]);

  async function beginInstall(){
    if(!canInstall||!selected||!install)return;
    const version=versionOf(selected),releaseId=idOf(selected);
    if(!confirmed){setMessage("Review and confirm the Update before installing.");setStage(3);return}
    if(!window.confirm("Install published OrbitFS Update v"+version+" from "+channel+"?"))return;
    setProgressTarget(releaseId);setProgressMode("update");setProgress(null);
    completionReported.current="";setStage(4);setBusy("update");setMessage("");
    requestInFlight.current=true;
    try{
      const res=await fetch("/api/orbitfs/installations/"+install.id+"/deploy",{
        method:"POST",
        headers:{...(await headers()),"content-type":"application/json"},
        body:JSON.stringify({action:"update",version:"update:"+version,releaseId,channel})
      });
      const response=await res.json().catch(()=>({}));
      if(!res.ok)throw Error(response.error||"The Update request was not completed.");
      await refreshProgress(String(install.id));
      setMessage("Update v"+version+" completed. Confirmed installation details are shown below.");
      setStage(5);
      await load(true);
    }catch(error:any){
      setMessage((error?.message||"The update request did not return a result.")+
        " Check recorded progress before attempting another installation.");
      await refreshProgress(String(install.id));
    }finally{requestInFlight.current=false;setBusy("")}
  }

  async function rollback(){
    if(!install||!appliedVersion||rollbackUnavailable||busy)return;
    const reason=rollbackReason.trim();
    if(!reason){setMessage("Enter a rollback reason before proceeding.");return}
    if(!window.confirm("Roll back installed Update v"+appliedVersion+"? Forward-compatible database migrations will remain applied."))return;
    const releaseId=String(applied?.releaseId||"");
    setProgressTarget(releaseId);setProgressMode("rollback");setProgress(null);setStage(4);
    setBusy("rollback");setMessage("");completionReported.current="";
    requestInFlight.current=true;
    try{
      const res=await fetch("/api/orbitfs/installations/"+install.id+"/rollback-update",{
        method:"POST",headers:{...(await headers()),"content-type":"application/json"},
        body:JSON.stringify({reason})
      });
      const response=await res.json().catch(()=>({}));
      if(!res.ok)throw Error(response.error||"The Update rollback request failed.");
      await refreshProgress(String(install.id));setRollbackReason("");
      setMessage("Update rollback completed. Forward-compatible database migrations remain applied.");
      setStage(5);await load(true);
    }catch(error:any){
      setMessage((error?.message||"Rollback did not return a result.")+
        " Review the recorded events before retrying.");
      await refreshProgress(String(install.id));
    }finally{requestInFlight.current=false;setBusy("")}
  }

  const trackedEvents=(progress?.events||[]).filter(event=>isUpdateEvent(event,progressMode)&&
    (!progressTarget||event.releaseId===progressTarget));
  const failedEvent=trackedEvents.find(event=>event.type===(progressMode==="rollback"?"update.rollback.failed":"update.failed"));
  const completedEvent=trackedEvents.find(event=>event.type===(progressMode==="rollback"?"update.rollback.completed":"update.completed"));
  const stageDone=(n:Stage)=>n===1?hasBase:n===2?Boolean(selected):n===3?confirmed:n===4?Boolean(completedEvent):false;
  const updateComponents=Array.isArray(selected?.components)?selected.components:[];
  const progressComponents=progressMode==="rollback"?Array.isArray(applied?.components)?applied.components:[]:
    Array.isArray(publishedUpdates.find(release=>idOf(release)===progressTarget)?.components)?
      publishedUpdates.find(release=>idOf(release)===progressTarget)?.components||[]:updateComponents;
  const phases=progressMode==="rollback"?[
    {label:"Authorize rollback",start:"update.rollback.started",end:"update.rollback.completed"},
    {label:"Restore saved components",start:"update.rollback.started",end:"update.rollback.completed"},
    {label:"Record rollback",start:"update.rollback.started",end:"update.rollback.completed"}
  ]:[
    {label:"Validate artifact & authorize",start:"update.started",end:"update.database.started"},
    {label:"Database migrations",start:"update.database.started",end:"update.database.completed"},
    ...(progressComponents.includes("base")?[{label:"Deploy Panel payload",start:"update.panel.started",end:"update.panel.completed"}]:[]),
    ...(progressComponents.some(value=>value!=="base")?[{label:"Apply Engine payload",start:"update.engine.started",end:"update.engine.completed"}]:[]),
    {label:"Record and report completion",start:"update.recording",end:"update.completed"}
  ];
  const recentActivity=(progress?.events||[]).filter(event=>isUpdateEvent(event,"update")||isUpdateEvent(event,"rollback")).slice(0,8);

  if(loading)return <main className="portalOverviewV2 orbitV5Updater"><section className="panel orbitV5UpdatePanel"><h2>Loading Update Release System…</h2><p className="muted">Checking your installation and authorized published releases.</p></section></main>;
  if(!data)return <main className="portalOverviewV2 orbitV5Updater"><section className="panel orbitV5UpdatePanel"><h2>Update Release System unavailable</h2><p>{message||"Could not load update status."}</p><button type="button" onClick={()=>void load()}>Retry</button></section></main>;

  return <main className="portalOverviewV2 orbitV5Updater">
    <header className="orbitV5UpdateHero">
      <div><p className="eyebrow">MY ORBITFS · UPDATE CENTER</p><h1>Update Release System</h1>
        <p>Choose an authorized Update, review exactly what changes and follow deployment in one place.</p></div>
      <div className="orbitV5UpdateHeroActions">
        <button type="button" className="secondary" disabled={!!busy} onClick={()=>void load(true)}>Refresh releases</button>
        <Link className="buttonlink secondary" href="/portal/orbitfs">Base control panel ↗</Link>
      </div>
    </header>

    {message&&<section className={"orbitV5UpdateMessage "+(failedEvent?"error":"")} role="status">{message}</section>}
    {(authorityUnavailable||settings.customer_updates_enabled===false)&&<section className="orbitV5UpdateWarning" role="status">
      <b>{settings.maintenance_mode?"Deployment maintenance":authorityUnavailable?"Deployment authority unavailable":"Customer Updates paused"}</b>
      <p>{settings.maintenance_mode?(settings.maintenance_message||"Update installation is temporarily unavailable."):
        authorityUnavailable?(settings.license_authority_notice||"License Manager has not authorized Update installation."):
        "Published releases remain visible, but customer Update execution is disabled."}</p>
    </section>}

    <section className="orbitV5UpdateJourney" aria-label="Update installation stages">
      <div className="orbitV5UpdateSectionTitle">
        <div><p className="eyebrow">UPDATE FLOW</p><h2>From your current Base to the next Update</h2></div>
        <span>{stage===5?"FINISHED":"STEP "+stage+" / 5"}</span>
      </div>
      <nav className="orbitV5UpdateSteps" aria-label="Update progress">
        {stages.map(item=><button key={item.id} type="button" className={"orbitV5UpdateStep "+(stage===item.id?"active":stageDone(item.id)?"done":"")}
          aria-current={stage===item.id?"step":undefined}
          disabled={!!busy||(item.id===3&&!selected)||(item.id===4&&!progressTarget)||(item.id===5&&!appliedVersion&&!completedEvent)}
          onClick={()=>{if(item.id===3&&!selected)return;if(item.id===5&&!appliedVersion&&!completedEvent)return;setMessage("");setStage(item.id)}}>
          <span className="orbitV5UpdateCircle">{stageDone(item.id)?"✓":item.id}</span>
          <span><b>{item.title}</b><small>{item.description}</small></span>
        </button>)}
      </nav>
    </section>

    {stage===1&&<section className="panel orbitV5UpdatePanel">
      <div className="orbitV5UpdatePanelHeading"><div><p className="eyebrow">STEP 1 · INSTALLATION</p><h2>Check your OrbitFS Base</h2>
        <p>Your Base System must already be installed before an Update can run.</p></div>
        <span className={"state "+(hasBase?"ready":"waiting")}>{hasBase?"BASE FOUND":"BASE REQUIRED"}</span></div>
      <div className="orbitV5UpdateFacts">
        <div><small>BASE VERSION</small><b>{baseVersion?"v"+baseVersion:"Not installed"}</b></div>
        <div><small>VERCEL PROJECT</small><b>{install?.vercel_project_name||"Not connected"}</b></div>
        <div><small>LICENCE</small><b>{licenceReady?"Registered":"Registration required"}</b></div>
        <div><small>CURRENT UPDATE</small><b>{appliedVersion?"v"+appliedVersion:"None installed"}</b></div>
      </div>
      {hasBase&&!baseReady&&<p className="orbitV5UpdateHint">Your Base is not currently in a ready state. Review its control panel before updating.</p>}
      {hasBase&&!licenceReady&&<p className="orbitV5UpdateHint">Register your installation licence in Base Deployment before proceeding.</p>}
      {!hasBase&&<Link className="buttonlink" href="/portal/orbitfs">Set up Base deployment →</Link>}
      <div className="orbitV5UpdateActions">
        <button type="button" disabled={!baseReady||!licenceReady||updateUnavailable||blockingBaseOperation} onClick={()=>setStage(2)}>Continue to Update selection →</button>
      </div>
    </section>}

    {stage===2&&<section className="panel orbitV5UpdatePanel">
      <div className="orbitV5UpdatePanelHeading">
        <div><p className="eyebrow">STEP 2 · CHANNEL & RELEASE</p><h2>Choose your Update</h2>
          <p>Only published Update releases available to this licence are shown.</p></div>
        <button type="button" className="secondary" disabled={!!busy} onClick={()=>void load(true)}>Refresh</button>
      </div>
      <div className="orbitV5UpdateFilter">
        <label htmlFor="orbit-update-channel">Update channel
          <select id="orbit-update-channel" value={channel} onChange={event=>{setChannel(event.target.value);setSelectedId("");setConfirmed(false)}}>
            {allowedChannels.map(name=><option value={name} key={name}>{name}</option>)}
          </select>
        </label>
        <div><small>INSTALLED UPDATE</small><b>{appliedVersion?"v"+appliedVersion:"No Update installed"}</b></div>
        <Link className="buttonlink secondary" href="/portal/orbitfs/channels">Manage channel access ↗</Link>
      </div>
      {!data.releaseDiscoveryAvailable&&<p className="orbitV5UpdateHint">Release discovery is currently unavailable. Existing results may be incomplete. Installation remains disabled until authority returns.</p>}
      <div className="orbitV5UpdateReleaseList">
        {releases.map(release=>{
          const rid=idOf(release);
          const compare=appliedVersion?compareOrbitReleaseVersions(versionOf(release),appliedVersion):null;
          const installed=Boolean(appliedId&&appliedId===rid||appliedVersion&&appliedVersion===versionOf(release)&&String(applied?.channel||channel)===channel);
          const older=Boolean(appliedVersion&&compare!==null&&compare<=0&&!installed);
          const minBase=String(release.minimum_version||release.minimumVersion||"");
          const cmpBase=minBase&&baseVersion?compareOrbitReleaseVersions(baseVersion,minBase):null;
          const compatibleRelease=!minBase||cmpBase!==null&&cmpBase>=0;
          const selectable=!installed&&!older&&compatibleRelease;
          return <article key={rid} className={"orbitV5UpdateRelease "+(rid===selectedId?"selected":"")}>
            <div className="orbitV5UpdateReleaseMain">
              <div><p className="eyebrow">UPDATE · {release.channel||channel}</p><h3>{release.title||"OrbitFS Update"}</h3>
                <p>v{release.version} · {dateLabel(release.published_at||release.publishedAt)||"Published Update"}</p>
                {release.description&&<p>{release.description}</p>}
                {Array.isArray(release.components)&&release.components.length>0&&<div className="orbitV5UpdateChips">{release.components.map(name=><span key={name}>{name}</span>)}</div>}
              </div>
              <span className={"state "+(installed?"ready":selectable?"current":"waiting")}>{installed?"INSTALLED":older?"OLDER":!compatibleRelease?"INCOMPATIBLE":"PUBLISHED"}</span>
            </div>
            {minBase&&<small className="orbitV5UpdateMinBase">Minimum Base: v{minBase}</small>}
            <div className="orbitV5UpdateReleaseActions">
              <details><summary>Release notes</summary><p className="orbitV5UpdateNotes">{release.changelog||release.description||"No customer release notes supplied."}</p>
                {release.customer_notes&&<p className="orbitV5UpdateNotes">{release.customer_notes}</p>}</details>
              {selectable&&<button type="button" className={rid===selectedId?"secondary":""} disabled={!!busy} onClick={()=>{setSelectedId(rid);setConfirmed(false);setMessage("");setStage(3)}}>{rid===selectedId?"Review selected Update":"Select & review →"}</button>}
            </div>
          </article>;
        })}
        {!releases.length&&<div className="orbitV5UpdateEmpty">
          <h3>No published Updates in {channel||"this channel"}</h3>
          <p>Approved Updates will appear after customer publication. You can refresh or choose another authorized channel.</p>
        </div>}
      </div>
      {appliedVersion&&<div className="orbitV5UpdateActions"><button type="button" className="secondary" onClick={()=>setStage(5)}>View installed Update & recovery →</button></div>}
    </section>}

    {stage===3&&<section className="panel orbitV5UpdatePanel">
      <div className="orbitV5UpdatePanelHeading"><div><p className="eyebrow">STEP 3 · REVIEW</p><h2>Review the selected Update</h2>
        <p>Check the release, targeted components and prerequisites before starting.</p></div>
        <span className={"state "+(canInstall?"ready":"waiting")}>{canInstall?"READY TO REVIEW":"CHECK REQUIREMENTS"}</span></div>
      {selected?<><div className="orbitV5UpdateFacts">
        <div><small>SELECTED UPDATE</small><b>v{selected.version}</b><span>{selected.title||"OrbitFS Update"}</span></div>
        <div><small>CHANNEL</small><b>{channel}</b><span>Authorized channel</span></div>
        <div><small>INSTALLED BASE</small><b>{baseVersion?"v"+baseVersion:"Not installed"}</b></div>
        <div><small>COMPONENTS</small><b>{updateComponents.length?updateComponents.join(", "):"See release manifest"}</b></div>
      </div>
      <div className="orbitV5UpdateReview">
        <div><p className="eyebrow">RELEASE NOTES</p><h3>{selected.title||"Update v"+selected.version}</h3>
          <p className="orbitV5UpdateNotes">{selected.changelog||selected.description||"No customer release notes supplied."}</p>
          {selected.customer_notes&&<><p className="eyebrow">CUSTOMER NOTES</p><p className="orbitV5UpdateNotes">{selected.customer_notes}</p></>}
        </div>
        <div className="orbitV5UpdateChecks"><p className="eyebrow">PRE-DEPLOYMENT CHECK</p>
          <div><span className={hasBase?"ok":"blocked"}>{hasBase?"✓":"!"}</span><p>Installed Base {hasBase?"found":"required"}</p></div>
          <div><span className={licenceReady?"ok":"blocked"}>{licenceReady?"✓":"!"}</span><p>Installation licence {licenceReady?"registered":"required"}</p></div>
          <div><span className={compatible?"ok":"blocked"}>{compatible?"✓":"!"}</span><p>{requiredBase?"Requires Base v"+requiredBase: "No minimum Base version specified"}{!compatible?" · incompatible":""}</p></div>
          <div><span className={!updateUnavailable?"ok":"blocked"}>{!updateUnavailable?"✓":"!"}</span><p>{updateUnavailable?"Update execution currently disabled":"Update authority available"}</p></div>
          {blockingBaseOperation&&<p className="orbitV5UpdateHint">Finish the active Base operation before installing an Update.</p>}
          {(alreadyInstalled||isPrevious)&&<p className="orbitV5UpdateHint">{alreadyInstalled?"This Update is already installed.":"This version is not newer than your recorded installed Update."}</p>}
        </div>
      </div>
      <label className="orbitV5UpdateConfirm">
        <input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>
        <span>I have reviewed the published Update and want to apply it to this installation.</span>
      </label>
      <div className="orbitV5UpdateActions">
        <button type="button" className="secondary" onClick={()=>{setConfirmed(false);setStage(2)}}>← Change Update</button>
        <button type="button" disabled={!canInstall||!confirmed} onClick={()=>void beginInstall()}>Install Update v{selected.version} →</button>
      </div></>:<div className="orbitV5UpdateEmpty"><p>Select a published Update first.</p><button onClick={()=>setStage(2)}>Browse Updates</button></div>}
    </section>}

    {stage===4&&<section className="panel orbitV5UpdatePanel orbitV5UpdateLive">
      <div className="orbitV5UpdatePanelHeading"><div><p className="eyebrow">STEP 4 · LIVE PROGRESS</p>
        <h2>{progressMode==="rollback"?"Rolling back installed Update":"Installing OrbitFS Update"}</h2>
        <p>{progressMode==="rollback"?"Using the existing authorized rollback workflow. Database migrations remain applied.":"The steps below reflect actual execution events, not estimated percentages."}</p>
        </div><span className={"state "+(failedEvent?"waiting":completedEvent?"ready":"current")}>{failedEvent?"NEEDS ATTENTION":completedEvent?"COMPLETE":"IN PROGRESS"}</span></div>
      <div className="orbitV5UpdateTimeline">
        {phases.map((phase,index)=>{
          const status=phaseStatus(trackedEvents,phase.start,phase.end);
          return <div key={phase.label} className={"orbitV5UpdatePhase "+status}>
            <span className="orbitV5UpdatePhaseNumber">{status==="complete"?"✓":index+1}</span>
            <div><b>{phase.label}</b><small>{status==="complete"?"Recorded complete":status==="running"?"Running":"Waiting for execution event"}</small></div>
          </div>;
        })}
      </div>
      {failedEvent&&<div className="orbitV5UpdateWarning"><b>Update operation needs attention</b><p>{failedEvent.message}</p></div>}
      {progressIssue&&<p className="orbitV5UpdateHint">{progressIssue} Progress can be refreshed without restarting the operation.</p>}
      {!trackedEvents.length&&<p className="orbitV5UpdateHint">Waiting for the server to validate the selected release and report its first event.</p>}
      <details className="orbitV5UpdateActivity" open={Boolean(failedEvent)}>
        <summary>Execution events ({trackedEvents.length})</summary>
        {trackedEvents.length?<ol>{trackedEvents.slice(0,15).map(event=><li key={event.id}>
          <span>{dateLabel(event.createdAt)||"Recorded"}</span><p>{event.message}</p>
        </li>)}</ol>:<p>No execution events have been received yet.</p>}
      </details>
      <div className="orbitV5UpdateActions">
        <button type="button" className="secondary" disabled={!install?.id} onClick={()=>void refreshProgress(String(install.id))}>Refresh progress</button>
        {!busy&&(failedEvent||completedEvent||progressIssue)&&<button type="button" className="secondary" onClick={()=>setStage(2)}>Return to Update selection</button>}
        {completedEvent&&!busy&&<button type="button" onClick={()=>{void load(true);setStage(5)}}>View completed Update →</button>}
      </div>
    </section>}

    {stage===5&&<section className="panel orbitV5UpdatePanel">
      <div className="orbitV5UpdatePanelHeading"><div><p className="eyebrow">STEP 5 · INSTALLED & RECOVERY</p>
        <h2>{appliedVersion?"Update v"+appliedVersion+" installed":"Update operation complete"}</h2>
        <p>Review the recorded installation and manage permitted recovery actions.</p></div>
        <span className={"state "+(appliedVersion?"ready":"waiting")}>{appliedVersion?"UPDATE INSTALLED":"NO UPDATE ACTIVE"}</span></div>
      <div className="orbitV5UpdateFacts">
        <div><small>INSTALLED BASE</small><b>{baseVersion?"v"+baseVersion:"Not installed"}</b></div>
        <div><small>APPLIED UPDATE</small><b>{appliedVersion?"v"+appliedVersion:"None"}</b></div>
        <div><small>CHANNEL</small><b>{applied?.channel||channel||"—"}</b></div>
        <div><small>APPLIED</small><b>{dateLabel(applied?.appliedAt)||"Not recorded"}</b></div>
      </div>
      {appliedVersion&&<details className="orbitV5UpdateRecovery"><summary>Rollback installed Update</summary>
        <p>Rollback requires License Manager authorization and may restore Panel and Engine checkpoints where available. Forward-compatible database migrations remain applied.</p>
        <label htmlFor="orbit-update-rollback-reason">Reason for rollback
          <textarea id="orbit-update-rollback-reason" value={rollbackReason} onChange={event=>setRollbackReason(event.target.value)} rows={3} placeholder="Reason for this rollback"/>
        </label>
        <button className="secondary" type="button" disabled={rollbackUnavailable||!!busy||!rollbackReason.trim()} onClick={()=>void rollback()}>Rollback Update v{appliedVersion}</button>
        {rollbackUnavailable&&<p className="orbitV5UpdateHint">Rollback is unavailable under current deployment authority or Billing controls.</p>}
      </details>}
      <details className="orbitV5UpdateActivity"><summary>Recent Update activity</summary>
        {recentActivity.length?<ol>{recentActivity.map(event=><li key={event.id}><span>{dateLabel(event.createdAt)||"Recorded"}</span><p>{event.message}</p></li>)}</ol>:<p>No Update activity recorded.</p>}
      </details>
      <div className="orbitV5UpdateActions">
        <Link className="buttonlink secondary" href="/portal/orbitfs">Open Base control panel ↗</Link>
        <button type="button" onClick={()=>{setSelectedId("");setConfirmed(false);setStage(2);void load(true)}}>Browse further Updates →</button>
      </div>
    </section>}

    <section className="orbitV5UpdateSupport">
      <div><p className="eyebrow">NEED HELP?</p><h2>Update support</h2><p>Need help with a release, update failure or recovery?</p></div>
      <Link className="buttonlink secondary" href="/portal/support">Contact support ↗</Link>
    </section>
  </main>;
}
