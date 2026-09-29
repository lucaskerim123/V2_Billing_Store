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

  async function sessionHeaders():Promise<Record<string,string>>{
    const {data:{session}}=await sb.auth.getSession();
    return session?.access_token?{Authorization:"Bearer "+session.access_token}:{};
  }

  async function load(background=false){
    if(!background)setLoading(true);
    setMessage("");
    try{
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),15000);
      try{
        const response=await fetch("/api/orbitfs/status",{headers:await sessionHeaders(),cache:"no-store",signal:controller.signal});
        const payload=await response.json().catch(()=>({}));
        if(!response.ok)throw Error(payload.error||"Could not load Updates ("+response.status+")");
        setData(payload);
      }finally{clearTimeout(timer)}
    }catch(error:any){
      setData(null);
      setMessage(error?.name==="AbortError"?"Update release status request timed out. Please retry.":error?.message||"Could not load Updates.");
    }finally{if(!background)setLoading(false)}
  }

  useEffect(()=>{void load()},[]);

  const binding=(data?.bindings||[]).find((item:any)=>item.license_product_key==="orbitfs_base"||item.components?.orbitfs_base||item.components?.orbitfs_panel)||(data?.bindings||[])[0]||null;
  const install=(data?.installations||[]).find((item:any)=>String(item.license_binding_id)===String(binding?.id))||null;
  const settings=data?.settings||{};
  const allowedChannels=Array.isArray(settings.release_channels)&&settings.release_channels.length?settings.release_channels:["stable"];

  useEffect(()=>{
    const installedChannel=String(install?.release_channel||"");
    if(installedChannel&&allowedChannels.includes(installedChannel))setSelectedChannel(installedChannel);
    else if(!selectedChannel&&allowedChannels.length)setSelectedChannel(String(allowedChannels[0]));
  },[install?.release_channel,allowedChannels.join(","),selectedChannel]);

  const authorityUnavailable=!settings.enabled||settings.maintenance_mode===true||settings.license_authority_available===false||settings.release_authority_available===false||settings.deployment_authority_available===false;
  const updateUnavailable=authorityUnavailable||settings.customer_updates_enabled===false;
  const rollbackUnavailable=authorityUnavailable||settings.customer_rollbacks_enabled===false;
  const publishedUpdates=(data?.publishedReleases||[])
    .filter((release:any)=>String(release.release_type||release.releaseType)==="update"&&allowedChannels.includes(String(release.channel||"stable")))
    .sort((a:any,b:any)=>{
      const published=String(b.published_at||b.publishedAt||"").localeCompare(String(a.published_at||a.publishedAt||""));
      if(published)return published;
      return compareOrbitReleaseVersions(String(b.version||""),String(a.version||""))??0;
    });
  const channelUpdates=publishedUpdates.filter((release:any)=>String(release.channel||"stable")===selectedChannel);
  const latestUpdate=channelUpdates[0]||null;
  const appliedUpdate=data?.normalUpdate?.applied||install?.metadata?.appliedUpdate||null;
  const appliedUpdateVersion=String(appliedUpdate?.version||"");
  const appliedUpdateId=String(appliedUpdate?.releaseId||"");
  const latestComparison=latestUpdate?.version&&appliedUpdateVersion?compareOrbitReleaseVersions(String(latestUpdate.version),appliedUpdateVersion):latestUpdate?.version?1:null;
  const updateAvailable=Boolean(latestUpdate&&(!appliedUpdateVersion||(latestComparison!==null&&latestComparison>0)));

  function installedRelease(release:any){
    if(appliedUpdateId)return appliedUpdateId===String(release.id||release.releaseId||"");
    return Boolean(appliedUpdateVersion&&appliedUpdateVersion===String(release.version||"")&&String(appliedUpdate?.channel||install?.release_channel||"stable")===String(release.channel||"stable"));
  }

  async function deploy(release:any){
    if(updateUnavailable){
      setMessage(settings.maintenance_mode?(settings.maintenance_message||"OrbitFS deployment maintenance is active."):settings.customer_updates_enabled===false?"Customer Update deployment is disabled.":(settings.license_authority_notice||"License Manager release/deployment authority is unavailable."));
      return;
    }
    if(!install?.release_version||!install?.vercel_project_id){
      setMessage("Deploy OrbitFS Base before installing an Update.");
      return;
    }
    const version=String(release?.version||"").trim();
    const releaseId=String(release?.releaseId||release?.id||"").trim();
    if(!version||!releaseId){setMessage("The selected Update release is missing its authoritative release identity.");return}
    if(String(release?.release_type||release?.releaseType||"")!=="update"){setMessage("Only Update releases can be installed here.");return}
    if(!selectedChannel||!allowedChannels.includes(selectedChannel)){setMessage("Select an available release channel.");return}
    if(!confirm("Install OrbitFS Update "+version+" from "+selectedChannel+"?"))return;

    setBusy("deploy:"+releaseId);
    setMessage("");
    try{
      const response=await fetch("/api/orbitfs/installations/"+install.id+"/deploy",{
        method:"POST",
        headers:{...(await sessionHeaders()),"content-type":"application/json"},
        body:JSON.stringify({action:"update",version:"update:"+version,releaseId,channel:selectedChannel})
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(payload.error||"Update deployment failed.");
      setMessage("OrbitFS Update "+version+" installed.");
      await load(true);
    }catch(error:any){setMessage(error?.message||"Update deployment failed.")}
    finally{setBusy("")}
  }

  async function rollbackUpdate(){
    if(!install||!appliedUpdateVersion)return;
    if(rollbackUnavailable){
      setMessage(settings.maintenance_mode?(settings.maintenance_message||"OrbitFS deployment maintenance is active."):settings.customer_rollbacks_enabled===false?"Customer Update rollback is disabled.":(settings.license_authority_notice||"License Manager rollback authority is unavailable."));
      return;
    }
    const reason=prompt("Why are you rolling back Update "+appliedUpdateVersion+"?","")?.trim()||"";
    if(!reason)return;
    if(!confirm("Roll back OrbitFS Update "+appliedUpdateVersion+"? Engine targets will restore their checkpoint where available. Forward-compatible database migrations remain applied."))return;
    setBusy("rollback");
    setMessage("");
    try{
      const response=await fetch("/api/orbitfs/installations/"+install.id+"/rollback-update",{
        method:"POST",
        headers:{...(await sessionHeaders()),"content-type":"application/json"},
        body:JSON.stringify({reason})
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(payload.error||"Update rollback failed.");
      setMessage("OrbitFS Update "+appliedUpdateVersion+" rolled back.");
      await load(true);
    }catch(error:any){setMessage(error?.message||"Update rollback failed.")}
    finally{setBusy("")}
  }

  if(loading)return <main className="portalOverviewV2"><section className="panel"><h2>Loading Update Release System…</h2><p className="muted">Checking License Manager publication, channel access and your installation.</p></section></main>;
  if(!data)return <main className="portalOverviewV2"><section className="panel"><h2>Update Release System unavailable</h2><p className="muted">{message||"Could not load Update release status."}</p><button onClick={()=>void load()}>Retry</button></section></main>;

  return <main className="portalOverviewV2">
    <header className="portalOverviewHero">
      <div>
        <p className="eyebrow">MY ORBITFS · UPDATE RELEASE SYSTEM</p>
        <h1>OrbitFS Updates</h1>
        <p className="muted">Browse published Update releases, read the release notes, select your approved channel and install or roll back Updates through the authoritative OrbitFS deployment flow.</p>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <button className="secondary" disabled={!!busy} onClick={()=>void load()}>{busy?"Working…":"Refresh releases"}</button>
        <Link className="buttonlink secondary" href="/portal/orbitfs">Base Deployment</Link>
        <Link className="buttonlink secondary" href="/portal/orbitfs/channels">Release Channels</Link>
        <Link className="buttonlink secondary" href="/portal/orbitfs/license">Licence</Link>
      </div>
    </header>

    {message&&<section className="panel"><p className="inlineStatus" role="status">{message}</p></section>}

    {authorityUnavailable&&<section className="panel portalWarning">
      <div className="panelTitle">
        <div>
          <p className="eyebrow">{settings.maintenance_mode?"MAINTENANCE":"DEPLOYMENT AUTHORITY"}</p>
          <h2>{settings.maintenance_mode?"Update deployment maintenance is active":"Update deployment is currently unavailable"}</h2>
          <p className="muted">{settings.maintenance_mode?(settings.maintenance_message||"OrbitFS deployment services are temporarily unavailable."):(settings.license_authority_notice||"Published Update information remains visible. Installation actions stay blocked until License Manager deployment authority is available.")}</p>
        </div>
        <span className="state waiting">BLOCKED</span>
      </div>
    </section>}

    {!authorityUnavailable&&settings.customer_updates_enabled===false&&<section className="panel portalWarning">
      <div className="panelTitle"><div><p className="eyebrow">CUSTOMER UPDATES</p><h2>Customer Update installation is paused</h2><p className="muted">Published releases remain visible, but Billing Store is currently blocking customer Update execution.</p></div><span className="state waiting">PAUSED</span></div>
    </section>}

    <section className="panel">
      <div className="panelTitle">
        <div>
          <p className="eyebrow">CURRENT INSTALLATION</p>
          <h2>{install?.vercel_project_name||"OrbitFS Panel"}</h2>
          <p className="muted">{install?.release_version?"Base v"+install.release_version:"Base not deployed"} · {appliedUpdateVersion?"Update v"+appliedUpdateVersion:"No Update installed"} · {install?.state||"waiting"}</p>
        </div>
        <span className={"state "+(install?.release_version?"ready":"waiting")}>{install?.release_version?"BASE READY":"BASE REQUIRED"}</span>
      </div>

      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginTop:12}}>
        <label htmlFor="orbitfs-update-channel"><b>Update channel</b></label>
        <select id="orbitfs-update-channel" value={selectedChannel} onChange={event=>setSelectedChannel(event.target.value)}>
          {allowedChannels.map((channel:string)=><option key={channel} value={channel}>{channel}</option>)}
        </select>
        <span className="muted">Only channels available to this licence are selectable.</span>
      </div>

      <div className="portalOverviewStats" style={{marginTop:14}}>
        <div className="portalStatCard"><div><small>PUBLISHED</small><strong>{channelUpdates.length}</strong><span>{selectedChannel||"stable"} Update releases</span></div></div>
        <div className="portalStatCard"><div><small>INSTALLED UPDATE</small><strong>{appliedUpdateVersion?"v"+appliedUpdateVersion:"None"}</strong><span>{appliedUpdateVersion?"Recorded for this installation":"No Update applied yet"}</span></div></div>
        <div className="portalStatCard"><div><small>LATEST UPDATE</small><strong>{latestUpdate?"v"+latestUpdate.version:"None"}</strong><span>{latestUpdate?latestUpdate.title||"Published Update":"Nothing published in this channel"}</span></div></div>
      </div>

      {latestUpdate&&<div className="portalUpdateStrip" style={{marginTop:14}}>
        <div>
          <b>{updateAvailable?"Update available: v"+latestUpdate.version:installedRelease(latestUpdate)?"Latest Update installed":"Latest published Update: v"+latestUpdate.version}</b>
          <span>{latestUpdate.title||"OrbitFS Update"}{Array.isArray(latestUpdate.components)&&latestUpdate.components.length?" · "+latestUpdate.components.join(", "):""}</span>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {updateAvailable&&<button disabled={!!busy||updateUnavailable||!install?.release_version||!install?.vercel_project_id} onClick={()=>void deploy(latestUpdate)}>{busy==="deploy:"+String(latestUpdate.id||latestUpdate.releaseId)?"Installing…":!install?.release_version?"Deploy Base first":"Install Update"}</button>}
          {appliedUpdateVersion&&<button className="secondary" disabled={!!busy||rollbackUnavailable} onClick={()=>void rollbackUpdate()}>{busy==="rollback"?"Rolling back…":"Rollback installed Update"}</button>}
        </div>
      </div>}
      {!latestUpdate&&<div className="orbitEmptyCompact" style={{marginTop:14}}>No published Update release is currently available in {selectedChannel||"this channel"}.</div>}
    </section>

    <section className="panel">
      <div className="panelTitle">
        <div><p className="eyebrow">PUBLISHED UPDATE RELEASES</p><h2>Release history · {selectedChannel||"stable"}</h2><p className="muted">Customer-visible release information comes from License Manager publication state and Billing presentation metadata.</p></div>
        <span className="orbitCount">{channelUpdates.length}</span>
      </div>

      <div className="portalOverviewGrid" style={{marginTop:14}}>
        {channelUpdates.map((release:any)=>{
          const installed=installedRelease(release);
          const comparison=appliedUpdateVersion?compareOrbitReleaseVersions(String(release.version||""),appliedUpdateVersion):null;
          const previous=Boolean(appliedUpdateVersion&&comparison!==null&&comparison<=0&&!installed);
          const releaseId=String(release.id||release.releaseId||"");
          return <article className="panel" key={releaseId||release.version}>
            <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start"}}>
              <div>
                <p className="eyebrow">ORBITFS UPDATE · {release.channel||"stable"}</p>
                <h2>{release.title||"OrbitFS Update "+release.version}</h2>
                <p className="muted">v{release.version} · {release.published_at?new Date(release.published_at).toLocaleString():"Published release"}</p>
              </div>
              <span className={"state "+(installed?"ready":previous?"":"current")}>{installed?"INSTALLED":previous?"PREVIOUS":"PUBLISHED"}</span>
            </div>

            {release.description&&<p style={{marginTop:12}}>{release.description}</p>}

            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
              {Array.isArray(release.components)&&release.components.map((component:string)=><span className="state" key={component}>{component}</span>)}
              {release.required===true&&<span className="state current">REQUIRED</span>}
              {release.minimum_version&&<span className="state">MIN BASE {release.minimum_version}</span>}
              {release.severity&&release.severity!=="normal"&&<span className="state waiting">{String(release.severity).toUpperCase()}</span>}
            </div>

            <p className="eyebrow" style={{marginTop:16}}>RELEASE NOTES</p>
            <div style={{whiteSpace:"pre-wrap"}}>{release.changelog||release.description||"No customer release notes supplied."}</div>

            {release.customer_notes&&<>
              <p className="eyebrow" style={{marginTop:16}}>CUSTOMER NOTES</p>
              <div style={{whiteSpace:"pre-wrap"}}>{release.customer_notes}</div>
            </>}

            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:16}}>
              {installed?<span className="state ready">Installed on this OrbitFS deployment</span>:previous?<span className="state">Older than the installed Update</span>:<button disabled={!!busy||updateUnavailable||!install?.release_version||!install?.vercel_project_id} onClick={()=>void deploy(release)}>{busy==="deploy:"+releaseId?"Installing…":!install?.release_version?"Deploy Base first":"Install this Update"}</button>}
            </div>
          </article>
        })}
        {!channelUpdates.length&&<article className="panel"><h2>No published Updates in {selectedChannel||"this channel"}</h2><p className="muted">When Billing publishes an approved Update from License Manager, it will appear here even before Base is installed. Installation remains blocked until a compatible Base deployment exists.</p></article>}
      </div>
    </section>
  </main>;
}
