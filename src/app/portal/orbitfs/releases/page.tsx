"use client";

import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";
import {compareOrbitReleaseVersions} from "@/lib/orbitfs-version";

export default function OrbitFSReleaseDeployer(){
 const sb=useMemo(()=>createClient(),[]);
 const [data,setData]=useState<any>(null);
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

 useEffect(()=>{void load()},[]);

 const binding=(data?.bindings||[]).find((x:any)=>x.license_product_key==="orbitfs_base"||x.components?.orbitfs_base)||data?.bindings?.[0];
 const install=(data?.installations||[]).find((x:any)=>x.license_binding_id===binding?.id);
 const allowedChannels=Array.isArray(data?.settings?.release_channels)?data.settings.release_channels:["stable"];

 useEffect(()=>{
  if(install?.release_channel&&allowedChannels.includes(String(install.release_channel)))setSelectedChannel(String(install.release_channel));
  else if(!selectedChannel&&allowedChannels.length)setSelectedChannel(String(allowedChannels[0]));
 },[install?.release_channel,allowedChannels.join(",")]);

 const releases=(data?.publishedReleases||[]).filter((x:any)=>String(x.release_type||x.releaseType)==="update"&&allowedChannels.includes(String(x.channel||"stable"))).sort((a:any,b:any)=>String(b.published_at||b.publishedAt||"").localeCompare(String(a.published_at||a.publishedAt||""))||(compareOrbitReleaseVersions(String(b.version||""),String(a.version||""))??0));
 const settings=data?.settings||{};
 const authorityUnavailable=!settings.enabled||settings.maintenance_mode===true||settings.license_authority_available===false||settings.release_authority_available===false||settings.deployment_authority_available===false;
 const updateUnavailable=authorityUnavailable||settings.customer_updates_enabled===false;
 const rollbackUnavailable=authorityUnavailable||settings.customer_rollbacks_enabled===false;
 const appliedUpdate=data?.normalUpdate?.applied||install?.metadata?.appliedUpdate||null;
 const appliedUpdateVersion=String(appliedUpdate?.version||"");
 const appliedUpdateId=String(appliedUpdate?.releaseId||"");
 const selectedChannelReleases=releases.filter((x:any)=>String(x.channel||"stable")===selectedChannel);
 const latestUpdate=selectedChannelReleases[0]||null;
 const latestComparison=latestUpdate?.version&&appliedUpdateVersion?compareOrbitReleaseVersions(String(latestUpdate.version),appliedUpdateVersion):latestUpdate?.version?1:null;
 const updateAvailable=Boolean(latestUpdate&&(!appliedUpdateVersion||latestComparison===1));

 async function deploy(release:any){
  if(updateUnavailable)return setMessage(settings.maintenance_mode?(settings.maintenance_message||"OrbitFS deployment maintenance is active."):settings.customer_updates_enabled===false?"Update deployment is disabled by an administrator.":(settings.license_authority_notice||"License Manager release/deployment authority is unavailable."));
  if(!install)return setMessage("Start your OrbitFS installation first.");
  if(!selectedChannel||!allowedChannels.includes(selectedChannel))return setMessage("Select a release channel you have access to.");
  const version=String(release?.version||"");if(!version)return setMessage("Release version is missing.");
  const releaseId=String(release?.releaseId||release?.id||"");
  if(String(release?.release_type||release?.releaseType||"")!=="update")return setMessage("Only OrbitFS Update releases can be installed from this page.");
  if(!install.release_version||!install.vercel_project_id)return setMessage("Deploy OrbitFS Base first.");
  if(!settings.customer_updates_enabled)return setMessage("Update deployment is disabled by an administrator.");
  if(!confirm("Deploy OrbitFS update "+version+"?"))return;
  setBusy("deploy:"+version);
  const requested="update:"+version;
  const r=await fetch("/api/orbitfs/installations/"+install.id+"/deploy",{method:"POST",headers:{...(await sessionHeaders()),"content-type":"application/json"},body:JSON.stringify({action:"update",version:requested,releaseId:releaseId||undefined,channel:selectedChannel})});
  const j=await r.json().catch(()=>({}));
  setBusy("");setMessage(r.ok?(j.message||"Deployment started."):(j.error||"Deployment failed."));
  if(r.ok)await load();
 }

 async function rollbackUpdate(){
  if(!install||!appliedUpdateVersion)return;
  if(rollbackUnavailable)return setMessage(settings.maintenance_mode?(settings.maintenance_message||"OrbitFS deployment maintenance is active."):settings.customer_rollbacks_enabled===false?"Update rollback is disabled by an administrator.":(settings.license_authority_notice||"License Manager release/deployment authority is unavailable."));
  const reason=prompt("Why are you rolling back Update "+appliedUpdateVersion+"?","")?.trim()||"";
  if(!reason)return;
  if(!confirm("Roll back OrbitFS Update "+appliedUpdateVersion+"? Engine targets will restore their checkpoint where available. Forward-compatible database migrations remain applied."))return;
  setBusy("rollback");
  try{
   const r=await fetch("/api/orbitfs/installations/"+install.id+"/rollback-update",{method:"POST",headers:{...(await sessionHeaders()),"content-type":"application/json"},body:JSON.stringify({reason})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Update rollback failed.");
   setMessage("OrbitFS Update "+appliedUpdateVersion+" rolled back.");
   await load();
  }catch(e:any){setMessage(e?.message||"Update rollback failed.")}
  finally{setBusy("")}
 }

 if(loading)return <main className="portalReleasePage orbitfsReleasesV3"><section className="portalCompactPanel"><h2>Loading releases…</h2><p className="muted">Checking publication and deployment access.</p></section></main>;
 if(!data)return <main className="portalReleasePage orbitfsReleasesV3"><section className="portalCompactPanel"><h2>Release service unavailable</h2><p className="muted">{message||"Could not load release status."}</p><button onClick={()=>void load()}>Retry</button></section></main>;

 return <main className="portalReleasePage orbitfsReleasesV3">
  <header className="portalReleaseHeader">
   <div><p className="eyebrow">MY ORBITFS · UPDATES</p><h1>Updates</h1><p className="muted">Install published OrbitFS Update releases available through your current release-channel access.</p></div>
   <div className="portalHeaderActions"><button className="secondary" disabled={loading||!!busy} onClick={()=>void load()}>{loading?"Refreshing…":"Refresh updates"}</button><Link className="buttonlink secondary" href="/portal/orbitfs">Base Deployment</Link><Link className="buttonlink secondary" href="/portal/orbitfs/channels">Release Channels</Link><Link className="buttonlink secondary" href="/portal/orbitfs/license">Licence</Link></div>
  </header>

  {message&&<div className="orbitInlineNotice">{message}</div>}

  {updateUnavailable&&<section className="portalCompactPanel portalWarning">
   <div><p className="eyebrow">{settings.maintenance_mode?"MAINTENANCE":"DEPLOYMENT UNAVAILABLE"}</p><h2>{settings.maintenance_mode?"Release deployment maintenance is active":"Customer deployment is currently unavailable"}</h2></div>
   <p className="muted">{settings.maintenance_mode?(settings.maintenance_message||"OrbitFS deployment services are temporarily unavailable."):(settings.customer_updates_enabled===false?"License Manager Update deployment authorization is disabled. Published updates remain visible, but installation is blocked.":(settings.license_authority_notice||"Published release information remains visible while deployment is unavailable."))}</p>
  </section>}

  <section className="portalCompactPanel">
   <div className="portalInstallRow">
    <div><p className="eyebrow">CURRENT INSTALLATION</p><h2>{install?.vercel_project_name||"OrbitFS Panel"}</h2><p className="muted">{install?.release_version?"Base v"+install.release_version:"Base release not deployed yet"} · {appliedUpdateVersion?"Update v"+appliedUpdateVersion:"No Update installed"} · {install?.state||"waiting"}</p></div>
    <label className="portalChannelPicker">Active channel<select value={selectedChannel} onChange={e=>setSelectedChannel(e.target.value)}>{allowedChannels.map((channel:string)=><option key={channel} value={channel}>{channel}</option>)}</select></label>
   </div>
   {updateAvailable&&latestUpdate&&<div className="portalUpdateStrip"><div><b>Update available: v{latestUpdate.version}</b><span>{latestUpdate.title||"Published update"}{latestUpdate.components?.length?" · "+latestUpdate.components.join(", "):""}</span></div><button disabled={!!busy||updateUnavailable} onClick={()=>void deploy(latestUpdate)}>{busy==="deploy:"+latestUpdate.version?"Installing…":"Install update"}</button></div>}
   {!updateAvailable&&install?.release_version&&<div className="portalUpdateStrip"><div><b>{appliedUpdateVersion?"Update v"+appliedUpdateVersion+" installed":"No Update installed"}</b><span>{latestUpdate?"You are current for "+selectedChannel+".":"No published Update is available in "+selectedChannel+"."}</span></div>{appliedUpdateVersion&&<button className="secondary" disabled={!!busy||rollbackUnavailable} onClick={()=>void rollbackUpdate()}>{busy==="rollback"?"Rolling back…":"Rollback Update"}</button>}</div>}
  </section>

  <section className="portalCompactPanel">
   <div className="orbitPanelHead"><div><p className="eyebrow">PUBLISHED UPDATES</p><h2>Available in {selectedChannel||"your channel"}</h2></div><span className="orbitCount">{selectedChannelReleases.length}</span></div>
   <div className="portalReleaseList">
    {selectedChannelReleases.map((r:any)=>{
     const installed=appliedUpdateId?appliedUpdateId===String(r.id):appliedUpdateVersion===String(r.version)&&String(appliedUpdate?.channel||install?.release_channel||"stable")===String(r.channel||"stable");
     return <article className="portalReleaseRow" key={r.id||r.version}>
      <div className="portalReleaseIdentity"><span className="state">UPDATE</span><div><b>v{r.version} · {r.title||"OrbitFS Update"}</b><small>{r.channel||"stable"} · {r.published_at?new Date(r.published_at).toLocaleDateString():"Published"}</small></div></div>
      <p>{r.description||r.changelog||"No customer release notes supplied."}</p>
      <div className="portalReleaseActions">{installed?<span className="state ready">Installed</span>:latestUpdate&&String(r.id||r.releaseId||"")===String(latestUpdate.id||latestUpdate.releaseId||"")&&updateAvailable?<span className="state current">Recommended above</span>:appliedUpdateVersion&&(compareOrbitReleaseVersions(String(r.version||""),appliedUpdateVersion)??0)<=0?<span className="state">Previous release</span>:<button disabled={!!busy||!install?.release_version||updateUnavailable} onClick={()=>void deploy(r)}>{busy==="deploy:"+r.version?"Installing…":"Install update"}</button>}</div>
     </article>
    })}
    {!selectedChannelReleases.length&&<div className="orbitEmptyCompact">No published Update releases are currently available in {selectedChannel||"this channel"}.</div>}
   </div>
  </section>
 </main>
}
