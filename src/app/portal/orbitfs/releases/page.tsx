"use client";

import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";

export default function OrbitFSReleaseDeployer(){
 const sb=useMemo(()=>createClient(),[]);
 const [data,setData]=useState<any>(null);
 const [channelAccess,setChannelAccess]=useState<any>({channels:[],requests:[]});
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState("");
 const [loading,setLoading]=useState(true);
 const [selectedChannel,setSelectedChannel]=useState("");

 async function sessionHeaders():Promise<Record<string,string>>{const {data:{session}}=await sb.auth.getSession();return session?.access_token?{Authorization:"Bearer "+session.access_token}:{};}

 async function load(){
  setLoading(true);setMessage("");
  try{
   const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
   try{
    const r=await fetch("/api/orbitfs/status",{headers:await sessionHeaders(),cache:"no-store",signal:controller.signal});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(j.error||"Could not load releases ("+r.status+")");
    setData(j);
   }finally{clearTimeout(timer)}
  }catch(e:any){setData(null);setMessage(e?.name==="AbortError"?"License Manager status request timed out. Please retry.":e?.message||"Could not load releases.")}finally{setLoading(false)}
 }

 async function loadChannelAccess(){
  try{
   const r=await fetch("/api/orbitfs/release-channels",{headers:await sessionHeaders(),cache:"no-store"});
   const j=await r.json().catch(()=>({}));
   if(r.ok)setChannelAccess(j);
  }catch{}
 }

 useEffect(()=>{void load();void loadChannelAccess()},[]);

 async function channelAction(action:string,channel:string){
  setBusy("channel:"+channel);setMessage("");
  try{
   const r=await fetch("/api/orbitfs/release-channels",{method:"POST",headers:{...(await sessionHeaders()),"content-type":"application/json"},body:JSON.stringify({action,channel})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Channel access request failed.");
   setMessage(action==="request"?"Access request submitted.":action==="join"?"Joined "+channel+".":"Left "+channel+".");
   await Promise.all([loadChannelAccess(),load()]);
  }catch(e:any){setMessage(e?.message||"Channel access action failed.")}finally{setBusy("")}
 }

 const binding=(data?.bindings||[]).find((x:any)=>x.license_product_key==="orbitfs_base"||x.components?.orbitfs_base)||data?.bindings?.[0];
 const install=(data?.installations||[]).find((x:any)=>x.license_binding_id===binding?.id);
 const allowedChannels=Array.isArray(data?.settings?.release_channels)?data.settings.release_channels:["stable"];

 useEffect(()=>{
  if(install?.release_channel&&allowedChannels.includes(String(install.release_channel)))setSelectedChannel(String(install.release_channel));
  else if(!selectedChannel&&allowedChannels.length)setSelectedChannel(String(allowedChannels[0]));
 },[install?.release_channel,allowedChannels.join(",")]);

 const releases=(data?.publishedReleases||[]).filter((x:any)=>(x.release_type==="base"||x.release_type==="update")&&allowedChannels.includes(String(x.channel||"stable")));
 const settings=data?.settings||{};
 const deploymentUnavailable=!settings.enabled||settings.maintenance_mode===true||settings.license_authority_available===false||settings.release_authority_available===false||settings.deployment_authority_available===false;
 const appliedUpdate=install?.metadata?.appliedUpdate||null;
 const appliedUpdateVersion=String(appliedUpdate?.version||"");
 const appliedUpdateId=String(appliedUpdate?.releaseId||"");
 const latestUpdate=releases.find((x:any)=>x.release_type==="update"&&String(x.channel||"stable")===selectedChannel)||null;

 async function deploy(release:any){
  if(deploymentUnavailable)return setMessage(settings.maintenance_mode?(settings.maintenance_message||"OrbitFS deployment maintenance is active."):(settings.license_authority_notice||"License Manager release/deployment authority is unavailable."));
  if(!install)return setMessage("Start your OrbitFS installation first.");
  if(!selectedChannel||!allowedChannels.includes(selectedChannel))return setMessage("Select a release channel you have access to.");
  const version=String(release?.version||"");if(!version)return setMessage("Release version is missing.");
  const releaseId=String(release?.releaseId||release?.id||"");
  const isUpdate=String(release?.release_type||release?.releaseType||"")==="update";
  if(isUpdate&&!settings.customer_updates_enabled)return setMessage("Update deployment is disabled by an administrator.");
  if(!isUpdate&&!settings.customer_deploy_enabled)return setMessage("Base deployment is disabled by an administrator.");
  if(!confirm("Deploy OrbitFS "+(isUpdate?"update ":"")+version+"?"))return;
  setBusy("deploy:"+version);
  const requested=releaseId&&!isUpdate?"release:"+releaseId:isUpdate?"update:"+version:version;
  const r=await fetch("/api/orbitfs/installations/"+install.id+"/deploy",{method:"POST",headers:{...(await sessionHeaders()),"content-type":"application/json"},body:JSON.stringify({action:install.release_version?(isUpdate?"update":"deploy"):"deploy",version:requested,releaseId:releaseId||undefined,channel:selectedChannel})});
  const j=await r.json().catch(()=>({}));
  setBusy("");setMessage(r.ok?(j.message||"Deployment started."):(j.error||"Deployment failed."));
  if(r.ok)await load();
 }

 if(loading)return <main className="portalReleasePage orbitfsReleasesV3"><section className="portalCompactPanel"><h2>Loading releases…</h2><p className="muted">Checking publication and deployment access.</p></section></main>;
 if(!data)return <main className="portalReleasePage"><section className="portalCompactPanel"><h2>Release service unavailable</h2><p className="muted">{message||"Could not load release status."}</p><button onClick={()=>void load()}>Retry</button></section></main>;

 return <main className="portalReleasePage">
  <header className="portalReleaseHeader">
   <div><p className="eyebrow">MY ORBITFS · RELEASES</p><h1>Releases & channels</h1><p className="muted">Manage channel access and deploy published Base or Update releases.</p></div>
   <div className="portalHeaderActions"><Link className="buttonlink secondary" href="/portal/orbitfs">My OrbitFS</Link><Link className="buttonlink secondary" href="/portal/orbitfs/license">License</Link></div>
  </header>

  {message&&<div className="orbitInlineNotice">{message}</div>}

  {deploymentUnavailable&&<section className="portalCompactPanel portalWarning">
   <div><p className="eyebrow">{settings.maintenance_mode?"MAINTENANCE":"DEPLOYMENT UNAVAILABLE"}</p><h2>{settings.maintenance_mode?"Release deployment maintenance is active":"Customer deployment is currently unavailable"}</h2></div>
   <p className="muted">{settings.maintenance_mode?(settings.maintenance_message||"OrbitFS deployment services are temporarily unavailable."):(settings.license_authority_notice||"Published release information remains visible while deployment is unavailable.")}</p>
  </section>}

  <section className="portalCompactPanel">
   <div className="orbitPanelHead"><div><p className="eyebrow">RELEASE CHANNELS</p><h2>Channel access</h2><p className="muted">Stable is included automatically. Other channels may be open, self-join, request-only or admin assigned.</p></div></div>
   <div className="portalChannelGrid">
    {(channelAccess.channels||[]).map((c:any)=>{
     const has=allowedChannels.includes(String(c.channel));
     const request=(channelAccess.requests||[]).find((x:any)=>x.channel===c.channel&&x.status==="pending");
     const canJoin=c.access_mode==="open"||c.self_join_enabled;
     return <article className={"portalChannelCard "+(has?"active":"")} key={c.channel}>
      <div className="portalChannelTop"><div><b>{c.label||c.channel}</b><span>{c.channel}</span></div><span className={has?"state ready":"state"}>{has?"Access":"No access"}</span></div>
      <p>{c.description||"Release channel"}</p>
      <small>{c.channel==="stable"?"Included with every active OrbitFS licence.":canJoin?"You can join this channel immediately.":c.access_request_enabled?"Request approval from OrbitFS staff.":"Access is assigned by an administrator."}</small>
      <div className="portalChannelActions">
       {c.channel==="stable"&&<span className="state ready">Included</span>}
       {c.channel!=="stable"&&has&&<button className="secondary" disabled={!!busy} onClick={()=>void channelAction("leave",c.channel)}>Leave</button>}
       {c.channel!=="stable"&&!has&&canJoin&&<button disabled={!!busy} onClick={()=>void channelAction("join",c.channel)}>{busy==="channel:"+c.channel?"Joining…":"Join channel"}</button>}
       {c.channel!=="stable"&&!has&&!canJoin&&c.access_request_enabled&&<button disabled={!!busy||!!request} onClick={()=>void channelAction("request",c.channel)}>{request?"Request pending":"Request access"}</button>}
       {c.channel!=="stable"&&!has&&!canJoin&&!c.access_request_enabled&&<span className="state">Admin assigned</span>}
      </div>
     </article>
    })}
   </div>
  </section>

  <section className="portalCompactPanel">
   <div className="portalInstallRow">
    <div><p className="eyebrow">CURRENT INSTALLATION</p><h2>{install?.vercel_project_name||"OrbitFS Panel"}</h2><p className="muted">{install?.release_version?"Installed v"+install.release_version:"Base release not deployed yet"} · {install?.state||"waiting"}</p></div>
    <label className="portalChannelPicker">Active channel<select value={selectedChannel} onChange={e=>setSelectedChannel(e.target.value)}>{allowedChannels.map((channel:string)=><option key={channel} value={channel}>{channel}</option>)}</select></label>
   </div>
   {latestUpdate&&appliedUpdateVersion!==String(latestUpdate.version)&&<div className="portalUpdateStrip"><div><b>Update available: v{latestUpdate.version}</b><span>{latestUpdate.title||"Published update"}</span></div><button disabled={!!busy||deploymentUnavailable||!settings.customer_updates_enabled} onClick={()=>void deploy(latestUpdate)}>{busy==="deploy:"+latestUpdate.version?"Starting…":"Deploy update"}</button></div>}
  </section>

  <section className="portalCompactPanel">
   <div className="orbitPanelHead"><div><p className="eyebrow">PUBLISHED RELEASES</p><h2>Available to your account</h2></div><span className="orbitCount">{releases.length}</span></div>
   <div className="portalReleaseList">
    {releases.map((r:any)=>{
     const installed=r.release_type==="base"&&install?.release_id===r.id||r.release_type==="update"&&(appliedUpdateId===String(r.id)||appliedUpdateVersion===String(r.version));
     return <article className="portalReleaseRow" key={r.id||r.version}>
      <div className="portalReleaseIdentity"><span className="state">{r.release_type==="base"?"BASE":"UPDATE"}</span><div><b>v{r.version} · {r.title||"OrbitFS release"}</b><small>{r.channel||"stable"} · {r.published_at?new Date(r.published_at).toLocaleDateString():"Published"}</small></div></div>
      <p>{r.description||r.changelog||"No customer release notes supplied."}</p>
      <div className="portalReleaseActions">{installed?<span className="state ready">Installed</span>:<button disabled={!!busy||!install||deploymentUnavailable||(r.release_type==="update"?!settings.customer_updates_enabled:!settings.customer_deploy_enabled)} onClick={()=>void deploy(r)}>{busy==="deploy:"+r.version?"Starting…":r.release_type==="base"?"Deploy Base":"Deploy update"}</button>}</div>
     </article>
    })}
    {!releases.length&&<div className="orbitEmptyCompact">No published releases are currently available for your channel access.</div>}
   </div>
  </section>
 </main>
}
