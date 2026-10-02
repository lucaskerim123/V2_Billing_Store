"use client";
import {compareOrbitReleaseVersions} from "@/lib/orbitfs-version";

import {useEffect,useMemo,useRef,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";
import {trackCustomerActivity} from "@/lib/customer-activity";
import {errorMessage} from "@/lib/error-message";

const hasBase=(b:any)=>b?.license_product_key==="orbitfs_base"||!!b?.components?.orbitfs_base||!!b?.components?.orbitfs_panel;
const label=(state:any)=>String(state||"waiting").replaceAll("_"," ");
const sectionGap={display:"grid",gap:12} as const;
const summaryStyle={cursor:"pointer"} as const;
const workingStates=new Set(["configuring","deploying","updating"]);

export default function MyOrbitFS(){
  const apiError=(payload:any,fallback:string)=>errorMessage(payload?.error??payload?.message??payload,fallback);
  const sb=useMemo(()=>createClient(),[]),pollCount=useRef(0);
  const [d,setD]=useState<any>();
  const [msg,setMsg]=useState("");
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState("");
  const [resources,setResources]=useState<any>();
  const [selectedProject,setSelectedProject]=useState("");
  const [newProject,setNewProject]=useState({organizationSlug:"",name:"",region:"ap-southeast-2"});
  const [vercelToken,setVercelToken]=useState("");
  const [vercelTeamId,setVercelTeamId]=useState("");
  const [currentStep,setCurrentStep]=useState<number>(1);
  const [siteStep,setSiteStep]=useState<number|null>(null);
  const [viewedPrimaryStage,setViewedPrimaryStage]=useState<number|null>(null);
  const [selectedReleaseId,setSelectedReleaseId]=useState("");
  const [releaseConfirmed,setReleaseConfirmed]=useState(false);
  const [preferredBaseChannel,setPreferredBaseChannel]=useState("");
  const [uninstallOptions,setUninstallOptions]=useState({removeDatabase:false,removeStorage:false,releaseLicense:false});
  const [lifecyclePlan,setLifecyclePlan]=useState<any>(null);
  const [liveCheckedAt,setLiveCheckedAt]=useState("");

  async function authHeaders():Promise<Record<string,string>>{const {data:{session}}=await sb.auth.getSession();return session?.access_token?{Authorization:`Bearer ${session.access_token}`}:{} }
  async function load(background=false,bootstrap=false){
    if(!background)setLoading(true);
    try{
      const headers=await authHeaders();
      if(!headers.Authorization){setMsg("Your session has expired. Please sign in again.");return}
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
      try{
        const r=await fetch("/api/orbitfs/status"+(bootstrap?"?view=bootstrap":""),{headers,cache:"no-store",signal:controller.signal}),j=await r.json().catch(()=>({}));
        if(r.ok){setD(j);setMsg("");if(bootstrap)void load(true,false)}else setMsg(apiError(j,"Could not load My OrbitFS."));
      }catch(e:any){setMsg(e?.name==="AbortError"?"My OrbitFS status request timed out. Please retry.":e?.message||"Could not load My OrbitFS.")}
      finally{clearTimeout(timer)}
    }finally{if(!background)setLoading(false)}
  }
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const connected=params.get("connected"),callbackError=params.get("error");
    if(callbackError)setMsg(callbackError);
    else if(connected==="supabase")setMsg("Supabase account connected. Loading your projects…");
    else if(connected==="vercel")setMsg("Vercel account connected.");
    void load(false,true).finally(()=>{
      if(connected==="supabase"&&!callbackError)setMsg("Supabase account connected. Choose an existing project or create a new one.");
      if(connected||callbackError)window.history.replaceState({},document.title,window.location.pathname);
    });
  },[]);

  const bases=(d?.bindings||[]).filter(hasBase),binding=bases.find((candidate:any)=>(d?.installations||[]).some((x:any)=>String(x.license_binding_id)===String(candidate.id)))||bases[0],install=(d?.installations||[]).find((x:any)=>String(x.license_binding_id)===String(binding?.id)),supabase=(d?.connections||[]).find((x:any)=>x.provider==="supabase"&&x.status==="connected"),vercelConnection=(d?.connections||[]).find((x:any)=>x.provider==="vercel"&&x.status==="connected"),vercelApiReady=vercelConnection?.metadata?.api_ready===true,vercelTeams=Array.isArray(vercelConnection?.metadata?.teams)?vercelConnection.metadata.teams:[],settings=d?.settings||{},history=(d?.releases||[]).filter((x:any)=>x.installation_id===install?.id),events=(d?.events||[]).filter((x:any)=>x.installation_id===install?.id);
  const baseHistory=history.filter((x:any)=>x.action!=="update"&&x.status==="ready").sort((a:any,b:any)=>new Date(b.ready_at||b.created_at||0).getTime()-new Date(a.ready_at||a.created_at||0).getTime());
  const distinctBaseHistory=baseHistory.filter((row:any,index:number,rows:any[])=>rows.findIndex((candidate:any)=>String(candidate.release_id||"")===String(row.release_id||""))===index);
  const visibleBaseHistory=distinctBaseHistory.slice(0,2),olderBaseHistory=distinctBaseHistory.slice(2),previousBaseDeployment=visibleBaseHistory.find((x:any)=>String(x.release_id||"")!==String(install?.release_id||""))||null;
  const operations=Array.isArray(d?.operations)?d.operations:[];
  const setupResetAtRaw=String(install?.metadata?.setupResetAt||"").trim();
  const setupResetAt=setupResetAtRaw?Date.parse(setupResetAtRaw):0;
  const operationBelongsToCurrentSetup=(operation:any)=>{
    if(!operation)return false;
    if(!setupResetAt||!Number.isFinite(setupResetAt))return true;
    const createdAt=Date.parse(String(operation.created_at||""));
    return Number.isFinite(createdAt)&&createdAt>=setupResetAt;
  };
  const currentSetupOperations=operations.filter(operationBelongsToCurrentSetup);
  const activeOperation=operationBelongsToCurrentSetup(d?.activeOperation)?d.activeOperation:null;
  const latestOperation=currentSetupOperations[0]||null;
    const baseInstalled=!!(install?.release_version&&install?.release_id&&install?.vercel_project_id&&(install?.vercel_deployment_id||install?.production_url));
    const operationWorking=!!activeOperation;
    const supabaseConnectionReady=!!supabase,supabaseReady=supabaseConnectionReady&&!!install?.supabase_project_ref,databaseReady=supabaseReady&&!!install?.database_initialized_at,infrastructureReady=supabaseConnectionReady&&databaseReady&&vercelApiReady,deploymentReady=!!(install?.release_version&&install?.vercel_project_id&&install?.state==="ready"),validationReady=deploymentReady&&String(install?.health_status||"")==="healthy",panelReady=baseInstalled,working=!!install&&(workingStates.has(String(install.state))||operationWorking),reviewReady=infrastructureReady;
  const pendingBaseForceReinstall=install?.metadata?.pendingBaseForceReinstall&&typeof install.metadata.pendingBaseForceReinstall==="object"?install.metadata.pendingBaseForceReinstall:null,baseReinstallDeploymentFailed=String(pendingBaseForceReinstall?.status||"")==="deployment_failed";
  const authorityLocked=!settings.enabled||settings.maintenance_mode===true||settings.license_authority_available===false;
  const providerSetupUnavailable=authorityLocked;
  const deploymentUnavailable=authorityLocked||settings.release_authority_available===false||settings.deployment_authority_available===false||settings.customer_deploy_enabled===false;
  const authorityNotice=settings.maintenance_mode
    ?(settings.maintenance_message||"License Manager maintenance mode is active.")
    :!settings.enabled
      ?"License Manager external authority is offline."
      :settings.license_authority_available===false
        ?(settings.license_authority_notice||"License Manager licensing authority is unavailable.")
        :settings.release_authority_available===false
          ?"License Manager release authority is disabled. Provider connections can still be prepared, but Base deployment is blocked."
          :settings.deployment_authority_available===false
            ?"License Manager deployment authorization is disabled. Provider connections can still be prepared, but deployment is blocked."
            :settings.customer_deploy_enabled===false
              ?"License Manager Base deployment authorization is disabled. Provider connections can still be prepared, but Base install/redeploy is blocked."
              :"";
  const availableBaseChannels=Array.isArray(d?.settings?.release_channels)&&d.settings.release_channels.length?d.settings.release_channels:["stable"];
  const selectedChannel=String(install?.release_channel||preferredBaseChannel||availableBaseChannels[0]||"stable");
  const publishedBaseReleases=(d?.publishedReleases||[]).filter((r:any)=>String(r.release_type||r.releaseType)==="base"&&String(r.channel||"stable")===selectedChannel&&String(r.status||"").toLowerCase()==="published").sort((a:any,b:any)=>String(b.published_at||b.publishedAt||"").localeCompare(String(a.published_at||a.publishedAt||""))||String(b.version).localeCompare(String(a.version),undefined,{numeric:true}));
  const selectedRelease=publishedBaseReleases.find((r:any)=>String(r.id)===selectedReleaseId)||publishedBaseReleases[0]||null;
  const selectedReleaseMatchesInstalled=!!(selectedRelease&&install?.release_id&&String(selectedRelease.id)===String(install.release_id));
  // The customer Base surface derives its target from the exact published releases
  // returned by License Manager for this channel. Do not use a second/stale "latest" signal.
  const latestBaseRelease=publishedBaseReleases[0]||null,latestBase=latestBaseRelease?.version;
  const baseUpdateCandidates=publishedBaseReleases.filter((r:any)=>{const comparison=compareOrbitReleaseVersions(r.version,install?.release_version);return comparison!==null&&comparison>0});
  const selectedBaseUpdateRelease=baseUpdateCandidates.find((r:any)=>String(r.id)===selectedReleaseId)||baseUpdateCandidates[0]||null;
  const selectedBaseUpdateAvailable=Boolean(selectedBaseUpdateRelease?.id);
  const baseUpdateAvailable=selectedBaseUpdateAvailable;
  const latestPublishedUpdate=(d?.publishedReleases||[]).filter((release:any)=>String(release.release_type||release.releaseType||"").toLowerCase()==="update"&&String(release.status||"").toLowerCase()==="published"&&String(release.channel||"stable").toLowerCase()===selectedChannel).sort((a:any,b:any)=>String(b.published_at||b.publishedAt||"").localeCompare(String(a.published_at||a.publishedAt||""))||((compareOrbitReleaseVersions(b.version,a.version))??0))[0]||null;
  const latestUpdate=String(latestPublishedUpdate?.version||"");
  const appliedUpdate=d?.normalUpdate?.applied||install?.metadata?.appliedUpdate||null;
  const appliedUpdateVersion=String(appliedUpdate?.version||"");
  const appliedUpdateId=String(appliedUpdate?.releaseId||appliedUpdate?.release_id||"");
  const appliedUpdateChannel=String(appliedUpdate?.channel||selectedChannel).toLowerCase();
  const updateVersionComparison=appliedUpdateVersion&&latestUpdate?compareOrbitReleaseVersions(latestUpdate,appliedUpdateVersion):null;
  const updateAlreadyApplied=Boolean(latestPublishedUpdate&&(
    (appliedUpdateId&&appliedUpdateId===String(latestPublishedUpdate.id))||
    (appliedUpdateVersion&&updateVersionComparison===0&&appliedUpdateChannel===selectedChannel)
  ));
  const updateDiscoveryReady=d?.updateReleaseDiscoveryByChannel?.[selectedChannel]?.available===true;
  const updateAvailable=Boolean(baseInstalled&&latestPublishedUpdate&&!updateAlreadyApplied&&
    (!appliedUpdateVersion||(updateVersionComparison!==null&&updateVersionComparison>0))&&updateDiscoveryReady);
  const components=binding?Object.entries(binding.components||{}).filter(([,v])=>v).map(([k])=>k):[];

  useEffect(()=>{if(!preferredBaseChannel&&availableBaseChannels.length)setPreferredBaseChannel(String(availableBaseChannels[0]))},[availableBaseChannels.join(","),preferredBaseChannel]);
  useEffect(()=>{if(selectedRelease?.id&&!selectedReleaseId)setSelectedReleaseId(String(selectedRelease.id))},[selectedRelease?.id,selectedReleaseId]);
  useEffect(()=>{if(vercelConnection?.team_id!==undefined&&vercelConnection?.team_id!==null&&!vercelTeamId)setVercelTeamId(String(vercelConnection.team_id))},[vercelConnection?.team_id]);
  useEffect(()=>{
    if(!install||!working){pollCount.current=0;return}
    if(pollCount.current>=300)return;
    const timer=setTimeout(()=>{pollCount.current+=1;void refreshLiveBase()},3000);
    return()=>clearTimeout(timer);
  },[install?.id,install?.state,install?.vercel_deployment_id,activeOperation?.id,activeOperation?.state,activeOperation?.heartbeat_at]);
  useEffect(()=>{
    if(!install){setCurrentStep(1);setViewedPrimaryStage(null);return}
    if(panelReady)return;
    if(!supabaseConnectionReady)return setCurrentStep(1);
    if(!databaseReady)return setCurrentStep(2);
    if(!vercelApiReady)return setCurrentStep(3);
    if(!deploymentReady)return setCurrentStep(4);
    setCurrentStep(6);
  },[install?.id,supabaseConnectionReady,supabaseReady,databaseReady,vercelApiReady,deploymentReady,panelReady,reviewReady]);

  async function start(){if(!binding)return;if(providerSetupUnavailable)return setMsg(settings.maintenance_mode?(settings.maintenance_message||"OrbitFS deployment maintenance is active."):(settings.license_authority_notice||"OrbitFS authority is unavailable."));setBusy("start");try{const r=await fetch("/api/orbitfs/installations/start",{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({bindingId:binding.id})}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(apiError(j,"Could not start OrbitFS setup."));const data=j.installation;setMsg("OrbitFS setup started.");setSiteStep(1);await trackCustomerActivity("orbitfs.installation.create",{entityType:"license",entityId:binding.id,detail:{installation_id:data?.installation_id}});await load()}catch(e:any){setMsg(e?.message||"Could not start OrbitFS setup.")}finally{setBusy("")}}
  async function connectSupabase(){if(!install)return;setBusy("supabase");const r=await fetch("/api/orbitfs/oauth/supabase/start",{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({installationId:install.id})}),j=await r.json().catch(()=>({}));setBusy("");if(!r.ok)return setMsg(apiError(j,"Could not connect Supabase."));location.href=j.url}
  async function resetSupabase(){if(!confirm("Disconnect the current Supabase connector? This removes the saved OAuth tokens. Your Supabase project and its data are not deleted."))return;setBusy("supabase-reset");const r=await fetch("/api/orbitfs/providers/supabase",{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({action:"disconnect"})}),j=await r.json().catch(()=>({}));setBusy("");setResources(undefined);if(!r.ok)return setMsg(apiError(j,"Could not reset Supabase connection."));setMsg("Supabase connector reset. Connect your Supabase account again.");await load()}
  async function saveReleaseChannel(channel:string){
    setPreferredBaseChannel(channel);setSelectedReleaseId("");setReleaseConfirmed(false);
    if(!install)return;
    setBusy("channel");
    try{
      const r=await fetch(`/api/orbitfs/installations/${install.id}/deploy`,{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({action:"set_channel",channel})}),j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(apiError(j,"Could not save release channel."));
      setD((current:any)=>current?({...current,installations:(current.installations||[]).map((x:any)=>x.id===install.id?{...x,release_channel:channel}:x)}):current);
      await load(true);
      setMsg(`Release channel set to ${channel}. Published releases refreshed.`);
    }catch(e:any){setMsg(e?.message||"Could not save release channel.")}
    finally{setBusy("")}
  }
  async function refreshReleases(){
    if(!install)return;
    setBusy("refresh-releases");
    try{
      setSelectedReleaseId("");setReleaseConfirmed(false);
      await load(true);
      setMsg(`Published releases refreshed for ${selectedChannel}.`);
    }finally{setBusy("")}
  }
  async function loadSupabase(){setBusy("resources");const r=await fetch("/api/orbitfs/providers/supabase",{headers:await authHeaders(),cache:"no-store"}),j=await r.json().catch(()=>({}));setBusy("");if(!r.ok)return setMsg(apiError(j,"Could not load your Supabase projects."));setResources(j);const first=j.organizations?.[0];if(!newProject.organizationSlug&&first)setNewProject(current=>({...current,organizationSlug:first.slug||first.id||""}))}
  async function supabaseAction(action:"select"|"create"){if(!install)return;setBusy(action);const body=action==="select"?{action,installationId:install.id,projectRef:selectedProject}:{action,installationId:install.id,...newProject},r=await fetch("/api/orbitfs/providers/supabase",{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify(body)}),j=await r.json().catch(()=>({}));setBusy("");setMsg(r.ok?`Your Supabase project was ${action==="select"?"selected":"created"}.`:apiError(j,"Supabase project action failed."));if(r.ok){setResources(undefined);setSiteStep(null);await load()}}
  async function initialize(){if(!install||!selectedRelease)return;if(!selectedReleaseMatchesInstalled&&install.release_version&&install.release_id&&!confirm("This will initialize the selected published Base release, replacing the current installation release identity. Continue?"))return;setBusy("init");const r=await fetch(`/api/orbitfs/installations/${install.id}/initialize`,{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({releaseId:String(selectedRelease.id)})}),j=await r.json().catch(()=>({}));setBusy("");setMsg(r.ok?"OrbitFS database initialized. Licence activation happens after deployment in the Base first-time installer.":apiError(j,"Database initialization failed."));if(r.ok){setSiteStep(null);await load()}}
  async function connectVercelOAuth(){if(!install)return;setBusy("vercel-oauth");try{const r=await fetch("/api/orbitfs/oauth/vercel/start",{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({installationId:install.id})}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(apiError(j,"Could not connect Vercel."));location.href=j.url}catch(e:any){setMsg(e?.message||"Could not connect Vercel.");setBusy("")}}
  async function connectVercelToken(){const token=vercelToken.trim();if(!token)return setMsg("Enter your Vercel Full Account Access token.");setBusy("vercel");const r=await fetch("/api/orbitfs/providers/vercel",{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({action:"connect",token})}),j=await r.json().catch(()=>({}));setBusy("");if(!r.ok)return setMsg(apiError(j,"Could not validate Vercel access."));setVercelToken("");setVercelTeamId(String(j.account?.teamId||""));setMsg("Vercel API access connected.");await load()}
  async function resetVercel(){if(!confirm("Reset the Vercel connector? This removes the saved Vercel token but does not delete your Vercel project. If OrbitFS is currently deployed, undeploy it first."))return;setBusy("vercel-reset");const r=await fetch("/api/orbitfs/providers/vercel",{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({action:"disconnect"})}),j=await r.json().catch(()=>({}));setBusy("");if(!r.ok)return setMsg(apiError(j,"Could not reset Vercel connection."));setVercelTeamId("");setVercelToken("");setMsg("Vercel connector reset. Connect it again when ready.");await load()}
  async function resetSetupToStage1(){
    if(!install)return;
    if(install.vercel_deployment_id||install.production_url){
      setMsg("Undeploy OrbitFS first. Reset to Stage 1 never removes a live Vercel deployment automatically.");
      setViewedPrimaryStage(4);
      setCurrentStep(6);
      return;
    }
    if(!confirm("Reset OrbitFS setup to Stage 1? This disconnects the saved Supabase and Vercel connections and clears installer selections. It does not delete your Supabase/Vercel projects, customer data, installation ID or licence binding."))return;
    setBusy("reset-setup");
    try{
      const r=await fetch(`/api/orbitfs/installations/${install.id}/reset`,{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:"{}"});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(apiError(j,"Could not reset OrbitFS setup."));
      setResources(undefined);
      setSelectedProject("");
      setNewProject({organizationSlug:"",name:"",region:"ap-southeast-2"});
      setVercelToken("");
      setVercelTeamId("");
      setSelectedReleaseId("");
      setPreferredBaseChannel("");
      setLifecyclePlan(null);
      setCurrentStep(1);
      setSiteStep(1);
      setViewedPrimaryStage(1);
      setMsg("OrbitFS setup reset to Stage 1. Supabase and Vercel connections were disconnected; customer projects, data, installation ID and licence binding were preserved.");
      await load();
    }catch(e:any){
      setMsg(e?.message||"Could not reset OrbitFS setup.");
    }finally{
      setBusy("");
    }
  }
  async function selectVercelTeam(){setBusy("vercel-team");const r=await fetch("/api/orbitfs/providers/vercel",{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({action:"select_team",teamId:vercelTeamId||null})}),j=await r.json().catch(()=>({}));setBusy("");setMsg(r.ok?"Vercel deployment account updated.":apiError(j,"Could not select that Vercel team."));if(r.ok)await load()}
  async function deploy(action:"deploy"|"base_update"|"update"|"rollback"|"redeploy",version?:string,releaseId?:string){
    if(!install)return;
    if(activeOperation){setMsg(label(activeOperation.action)+" is already "+label(activeOperation.state)+". Deployment status below will update automatically.");return}
    let reason="";
    if(action==="rollback"){version=undefined;reason=prompt("Why are you rolling this Base deployment back?","")?.trim()||"";if(!reason)return}
    const actionLabel=action==="base_update"?"Update Base":action==="redeploy"?"Redeploy published Base":action==="update"?"Install normal update":action==="rollback"?"Rollback Base":"Install Base";
    if(!confirm(actionLabel+(version?" to "+version:"")+"?"))return;
    if(action==="deploy")setSiteStep(5);
    setBusy(action);
    const r=await fetch("/api/orbitfs/installations/"+install.id+"/deploy",{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({action,version,releaseId,reason:reason||undefined,channel:String(install.release_channel||d?.settings?.release_channels?.[0]||"stable")})});
    const j=await r.json().catch(()=>({}));
    setBusy("");
    if(r.ok){setMsg(action==="base_update"?"Base update to "+(version||"the latest release")+" completed in the existing Vercel project.":action==="redeploy"?"Published Base "+(latestBase||"release")+" redeployed in the existing Vercel project.":"OrbitFS "+actionLabel.toLowerCase()+" completed.");pollCount.current=0;await load();return}
    setMsg(apiError(j,actionLabel+" failed."));
    if(j.operationId||j.code==="OPERATION_IN_PROGRESS"){pollCount.current=0;await load(true)}
  }
  async function forceReinstallBase(){
    if(!install)return;
    if(activeOperation){setMsg(label(activeOperation.action)+" is already "+label(activeOperation.state)+". Wait for the active Base operation to finish before forcing a reinstall.");return}
    const channel=String(install.release_channel||selectedChannel||"stable");
    if(!confirm("Force reinstall OrbitFS Base? This deletes ONLY the current Base Vercel project, releases/unlocks its licence activation, preserves Supabase/database/storage/installation ID and the Shared Engine Host, then PAUSES. Rotate the licence key, continue the reinstall here, then enter the new key inside the deployed Base."))return;
    setBusy("force-base-reinstall");
    try{
      const r=await fetch(`/api/orbitfs/installations/${install.id}/force-reinstall-base`,{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:"{}"});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(apiError(j,"Force Base reinstall failed."));
      const version=String(j?.targetRelease?.version||"published");
      setViewedPrimaryStage(2);
      setCurrentStep(4);
      setMsg(j.message||("Base "+version+" was removed and the licence was released. Rotate your licence key, then continue the reinstall here. Enter the new key inside the deployed Base after it is live."));
      pollCount.current=0;
      await load();
    }catch(e:any){setMsg(e?.message||"Force Base reinstall failed.")}
    finally{setBusy("")}
  }
  async function rollbackUpdate(){if(!install||!appliedUpdateVersion)return;const reason=prompt(`Why are you rolling back Update ${appliedUpdateVersion}?`,"")?.trim()||"";if(!reason)return;if(!confirm(`Roll back OrbitFS Update ${appliedUpdateVersion}? Inner Engine targets will restore their pre-update checkpoint first. Forward-compatible database migrations remain applied.`))return;setBusy("rollback-update");const r=await fetch(`/api/orbitfs/installations/${install.id}/rollback-update`,{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({reason})}),j=await r.json().catch(()=>({}));setBusy("");setMsg(r.ok?`OrbitFS Update ${appliedUpdateVersion} rolled back.`:apiError(j,"Update rollback failed."));if(r.ok){pollCount.current=0;await load()}}

  async function sync(auto=false){if(!install)return;const r=await fetch(`/api/orbitfs/installations/${install.id}/status`,{headers:await authHeaders(),cache:"no-store"}),j=await r.json().catch(()=>({}));if(!r.ok){if(!auto)setMsg(apiError(j,"Could not refresh Panel status."));return}const updated=j.installation;if(updated)setD((current:any)=>current?({...current,installations:(current.installations||[]).map((x:any)=>x.id===updated.id?updated:x)}):current);if(updated&&!workingStates.has(String(updated.state)))await load()}
  async function refreshLiveBase(){
    if(!install?.id)return;
    try{
      const r=await fetch(`/api/orbitfs/installations/${install.id}/status`,{headers:await authHeaders(),cache:"no-store"});
      const j=await r.json().catch(()=>({}));
      if(r.ok&&j.installation){
        const updated=j.installation;
        setD((current:any)=>current?({...current,installations:(current.installations||[]).map((x:any)=>x.id===updated.id?updated:x)}):current);
      }
      await load(true);
    }finally{
      setLiveCheckedAt(new Date().toISOString());
    }
  }
  async function repairPublicUrl(){if(!install)return;setBusy("public-url-repair");try{const r=await fetch(`/api/orbitfs/installations/${install.id}/status`,{method:"POST",headers:await authHeaders(),cache:"no-store"}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(apiError(j,"Could not repair public Panel access."));await load();setMsg(j.installation?.health_status==="healthy"?"Public Panel URL repaired and verified.":"Production domain refreshed, but public health is unverified. Check the Vercel project protection settings and Panel health.")}catch(e:any){setMsg(e?.message||"Public URL repair failed.")}finally{setBusy("")}}
  async function lifecyclePlanFor(action:"undeploy"|"uninstall"){if(!install)return;setBusy("lifecycle-plan");try{const options=action==="uninstall"?uninstallOptions:{removeDatabase:false,removeStorage:false,releaseLicense:false};const r=await fetch(`/api/orbitfs/installations/${install.id}/lifecycle`,{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({action:"plan",mode:action,...options})}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(apiError(j,"Could not create lifecycle plan."));setLifecyclePlan(j);return j}catch(e:any){setMsg(e?.message||"Could not create lifecycle plan.");return null}finally{setBusy("")}}
  async function executeLifecycle(action:"undeploy"|"uninstall"){if(!install)return;const planned=await lifecyclePlanFor(action);if(!planned)return;const destructive=action==="uninstall"&&[uninstallOptions.removeDatabase&&"OrbitFS database objects",uninstallOptions.removeStorage&&"OrbitFS storage bucket",uninstallOptions.releaseLicense&&"licence installation binding"].filter(Boolean);const summary=action==="undeploy"?"Undeploy OrbitFS? The Panel and Shared Engine Host will be removed. Your database, storage, licence binding and installation ID will be preserved.":`Uninstall OrbitFS? This removes the running Panel/Engine resources.${destructive&&destructive.length?` It will also permanently remove: ${destructive.join(", ")}.`:" Database, storage and licence binding will be preserved."} The Supabase project itself is never deleted.`;if(!confirm(summary))return;setBusy(action);try{const r=await fetch(`/api/orbitfs/installations/${install.id}/lifecycle`,{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({action,jobId:planned?.job?.id,...(action==="uninstall"?uninstallOptions:{})})}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(apiError(j,`${action} failed.`));setLifecyclePlan(j);await trackCustomerActivity(action==="undeploy"?"orbitfs.installation.undeploy":"orbitfs.installation.uninstall",{entityType:"license",entityId:binding?.id,detail:{installation_id:install.installation_id,job_id:j?.job?.id,options:action==="uninstall"?uninstallOptions:{}}});setMsg(action==="undeploy"?"OrbitFS undeployed. Database, storage, licence and installation ID were preserved.":"OrbitFS uninstall completed with the selected cleanup options.");await load()}catch(e:any){setMsg(e?.message||`${action} failed.`)}finally{setBusy("")}}

  if(loading)return <main className="portalOverviewV2 orbitfsBaseV3"><section className="panel"><b>{msg||"Loading My OrbitFS…"}</b>{msg&&<p className="muted">Loading the rest of your deployment state…</p>}</section></main>;
  if(!d)return <main className="portalOverviewV2 orbitfsBaseV3 orbitZipDeployer"><section className="panel"><h2>My OrbitFS could not load</h2><p className="muted">{msg||"The OrbitFS status service did not return data."}</p><button onClick={()=>void load()}>Retry</button></section></main>;

  const primaryFlow=[
    {
      n:1,title:"Supabase",ready:databaseReady,
      detail:!supabaseConnectionReady?"Connect Supabase":databaseReady?`Database ready · schema ${install?.schema_version||"ready"}`:supabaseReady?"Initialize database":"Configure database",
      substeps:[
        {id:"1a",title:"Connect Supabase",ready:supabaseConnectionReady},
        {id:"1b",title:"Configure / initialize database",ready:databaseReady}
      ]
    },
    {
      n:2,title:"Vercel & Base",ready:deploymentReady,
      detail:deploymentReady?`Base ${install?.release_version||"deployed"}`:!vercelApiReady?"Connect Vercel":reviewReady?"Configure / install Base":"Complete Base configuration",
      substeps:[
        {id:"2a",title:"Connect Vercel",ready:vercelApiReady},
        {id:"2d",title:"Configure / install Base",ready:deploymentReady}
      ]
    },
    {
      n:3,title:"Validation",ready:validationReady,
      detail:validationReady?"Deployment validated":deploymentReady?(install?.health_status==="degraded"?"Health check degraded":"Validate deployment"):"Waiting for Base install",
      substeps:[
        {id:"3a",title:"Validate runtime health",ready:String(install?.health_status||"")==="healthy"},
        {id:"3b",title:"Validate database & storage",ready:databaseReady},
        {id:"3d",title:"Validate release identity",ready:!!(install?.release_id&&install?.release_sha256&&install?.release_source_commit)},
        {id:"3e",title:"Hand off to control panel",ready:panelReady}
      ]
    }
  ];
  const progressPrimaryNumber=primaryFlow.find(stage=>!stage.ready)?.n||3;
  const activePrimaryNumber=viewedPrimaryStage||progressPrimaryNumber;
  const activePrimary=primaryFlow.find(stage=>stage.n===activePrimaryNumber)||primaryFlow[2];
  const activePrimarySubstep=activePrimary.substeps.find(step=>!step.ready)?.id||activePrimary.substeps[activePrimary.substeps.length-1]?.id;

  function navigatePrimaryStage(stage:number){
    setSiteStep(stage===1?2:stage===2?!vercelApiReady?3:5:5);
    setViewedPrimaryStage(stage);
    if(stage===1){setCurrentStep(!supabaseConnectionReady?1:2);return}
    if(stage===2){setCurrentStep(!vercelApiReady?3:4);return}
    setCurrentStep(6);
  }

  function navigateSubstep(id:string){
    setSiteStep(id==="1a"||id==="1b"?2:id==="2a"?3:5);
    const stage=Number(id.split("")[0]||1);
    setViewedPrimaryStage(stage);
    if(id==="1a"){setCurrentStep(1);return}
    if(id==="1b"){setCurrentStep(2);return}
    if(id==="2a"){setCurrentStep(3);return}
    if(stage===2){setCurrentStep(4);return}
    setCurrentStep(6);
  }


  const deploymentNeedsAttention=String(activeOperation?.state||latestOperation?.state||install?.state||"").toLowerCase()==="failed";

  // Presentation-only step changes; existing deployment APIs stay authoritative.
  const connectionsReady=supabaseConnectionReady&&vercelApiReady;
  const configDatabaseReady=databaseReady&&selectedReleaseMatchesInstalled;
  const releaseReady=Boolean(selectedRelease?.id&&(releaseConfirmed||configDatabaseReady));
  const configurationReady=configDatabaseReady&&vercelApiReady;
  const journey=[
    {id:1,title:"Connections",text:"Connect Supabase and Vercel.",done:connectionsReady},
    {id:2,title:"Database",text:"Choose the Supabase project.",done:supabaseReady},
    {id:3,title:"Channel / Release",text:"Choose the channel and published Base release.",done:releaseReady},
    {id:4,title:"Configuration",text:"Initialize the Base schema. Licence activation happens after deployment inside the Base first-time installer.",done:configurationReady},
    {id:5,title:"Live Progress",text:"Deploy and follow the actual installation progress.",done:panelReady},
    {id:6,title:"Finished",text:"Manage the installed Base in the control panel.",done:panelReady}
  ];
  const journeyCurrent=pendingBaseForceReinstall?4:journey.find(x=>!x.done)?.id||5;
  const activeSiteStep=siteStep??journeyCurrent;
  const websiteState=deploymentNeedsAttention?"orbitSiteAttention":activeOperation?"orbitSiteProgress":panelReady?"orbitSiteControl":activeSiteStep===5?"orbitSiteReview":"orbitSiteDeployer";
  function openSiteStep(n:number){
    if(n===6){if(panelReady)window.scrollTo({top:0,behavior:"smooth"});return}
    if(n>=1&&n<=5)setSiteStep(n);
  }

  return <main className={"portalOverviewV2 orbitfsBaseV3 orbitZipDeployer "+websiteState+" "+(panelReady?"orbitZipDeployed":"orbitZipInstalling")} aria-label="OrbitFS Base Deployer">
    {!panelReady&&<header className="orbitV5Hero">
      <div><p className="eyebrow">DEPLOYMENT CENTER</p>
        <h1>{deploymentNeedsAttention?"Deployment needs attention":activeOperation?"Deployment progress":activeSiteStep===5?"Review deployment":"Base System Deployer"}</h1>
        <p className="orbitV5Lead">{deploymentNeedsAttention?"A deployment step needs attention. Review the recorded error and continue from the relevant stage.":activeOperation?"Your Base operation is running. Progress and recent activity below use your actual deployment records.":activeSiteStep===5?"Confirm the selected release and customer infrastructure before deploying.":"Deploy and manage your own OrbitFS Base instance with a guided setup."}</p>
        <p className="orbitV5Note">Follow each step, review the exact published Base release, monitor progress and manage your installation in one place.</p>
      </div>
      <div className="orbitV5HeroState"><span className={"state "+(deploymentNeedsAttention?"waiting":activeOperation?"current":binding?"ready":"waiting")}>{deploymentNeedsAttention?"ATTENTION":activeOperation?"IN PROGRESS":binding?"ENTITLEMENT ATTACHED":"LICENCE REQUIRED"}</span>{install?.installation_id&&<small>Installation {String(install.installation_id).slice(0,13)}…</small>}</div>
    </header>}
    {!panelReady&&!install&&binding&&<section className="orbitV5Start">
      <span className="orbitV5StartGlyph" aria-hidden="true">↗</span>
      <div><p className="eyebrow">READY TO DEPLOY</p><h2>Start your deployment</h2><p>Begin the guided setup for your Base System instance. No infrastructure action runs until you explicitly confirm it.</p></div>
      <div className="orbitV5StartControls"><button className="orbitHeroAction" disabled={providerSetupUnavailable||busy!==""} onClick={()=>void start()}>{busy==="start"?"Starting…":"Begin Deployment →"}</button><small>Customer-owned infrastructure · Manual deployment</small></div>
    </section>}
    {panelReady&&<header className="portalOverviewHero orbitV5ControlHero"><div><p className="eyebrow">MY ORBITFS &nbsp; › &nbsp; {validationReady?"STEP 6 · FINISHED":"STEP 6 · INSTALLED · HEALTH CHECK"} &nbsp; › &nbsp; INSTANCE CONTROL PANEL</p><h1>Base System Instance</h1><p className="muted">Manage the installed Base, see recorded runtime health and use approved release controls.</p>{install.production_url&&<div className="orbitV5Destination"><small>ACCESS DESTINATION</small><a href={install.production_url} target="_blank" rel="noreferrer">{install.production_url} ↗</a></div>}</div><span className={"state "+(validationReady?"ready":working?"current":"waiting")}>{validationReady?"RUNNING · HEALTHY":working?"IN PROGRESS":"CHECK STATUS"}</span></header>}
    {deploymentUnavailable&&<section className="panel orbitAuthorityNotice" style={{marginBottom:14,borderColor:"rgba(245,158,11,.55)"}}><div className="panelTitle"><div><p className="eyebrow">{settings.maintenance_mode?"MAINTENANCE":"LICENSE MANAGER CONTROL"}</p><h2>{settings.maintenance_mode?"OrbitFS deployment maintenance is active":"Base deployment is currently restricted"}</h2><p className="muted">{authorityNotice}</p></div><span className="state waiting">{settings.maintenance_mode?"MAINTENANCE":"BLOCKED"}</span></div></section>}
    {msg&&<p className="inlineStatus orbitInstallerMessage" role="status">{msg}</p>}
    {deploymentNeedsAttention&&!activeOperation&&!panelReady&&<section className="panel orbitV5Failure">
      <div><p className="eyebrow">DEPLOYMENT NEEDS ATTENTION</p><h2>{latestOperation?.error_code?"Deployment error · "+latestOperation.error_code:"Your Base deployment needs attention"}</h2>
        <p>{latestOperation?.error_detail||"The recorded deployment or installation state shows a failed step. Review the affected configuration and retry only when prerequisites are ready."}</p>
        <small>Last recorded action: {latestOperation?label(latestOperation.action):label(install?.state)}{latestOperation?.created_at?" · "+new Date(latestOperation.created_at).toLocaleString():""}</small>
      </div>
      <div className="orbitV5FailureActions">
        <button className="secondary" type="button" onClick={()=>openSiteStep(!databaseReady?2:!vercelApiReady?3:5)}>Review required step</button>
        <button className="secondary" type="button" disabled={busy!==""} onClick={()=>void load()}>Refresh status</button>
        <Link className="buttonlink secondary" href="/portal/support">Contact support ↗</Link>
      </div>
    </section>}
    {pendingBaseForceReinstall&&<section className="panel orbitAuthorityNotice" style={{marginBottom:14,borderColor:"rgba(245,158,11,.65)"}}>
      <div className="panelTitle"><div><p className="eyebrow">BASE FORCE REINSTALL</p><h2>{baseReinstallDeploymentFailed?"Base reinstall needs another deployment attempt":"Rotate the licence key, then continue"}</h2><p className="muted">Target: published Base {pendingBaseForceReinstall.targetVersion||"current"} · {pendingBaseForceReinstall.channel||selectedChannel}. The previous Base project has been removed; Supabase, customer data, storage, installation ID and Shared Engine Host are preserved.</p></div><span className="state waiting">{baseReinstallDeploymentFailed?"RETRY REQUIRED":"ROTATION REQUIRED"}</span></div>
      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}><Link className="buttonlink" href="/portal/orbitfs/license">Rotate licence key →</Link><button className="secondary" disabled={busy!==""} onClick={()=>void deploy("deploy")}>{busy==="deploy"?"Checking rotation…":"I rotated the key · Continue reinstall"}</button><span className="muted">{baseReinstallDeploymentFailed?(pendingBaseForceReinstall.lastError||"Retry the Base deployment."):"Billing checks rotation state with License Manager. The raw key is entered only inside the deployed Base."}</span></div>
    </section>}
    {panelReady&&install&&(activeOperation||latestOperation)&&<section className="panel orbitV5OperationPanel orbitV5InstalledProgress" style={{marginBottom:14}}>
      <div className="panelTitle"><div><p className="eyebrow">DEPLOYMENT STATUS</p><h2>{activeOperation?label(activeOperation.action)+" · "+label(activeOperation.state):latestOperation?.state==="failed"?"Last deployment attempt failed":"Recent deployment activity"}</h2><p className="muted">{activeOperation?`Live Base operation. Status, events and Vercel readiness refresh automatically every 3 seconds${liveCheckedAt?" · last checked "+new Date(liveCheckedAt).toLocaleTimeString():""}.`:"Latest Base deployment operation recorded by Billing Store."}</p></div><span className={"state "+(activeOperation?"current":latestOperation?.state==="completed"?"ready":"waiting")}>{String(activeOperation?.state||latestOperation?.state||"status").replaceAll("_"," ").toUpperCase()}</span></div>
      {activeOperation&&<div className="portalOverviewStats" style={{marginTop:10}}>
        <div className="portalStatCard"><div><small>ACTION</small><strong>{label(activeOperation.action)}</strong><span>{activeOperation.detail?.version||activeOperation.requested_release_id||"Current release"}</span></div></div>
        <div className="portalStatCard"><div><small>STAGE</small><strong>{label(activeOperation.state)}</strong><span>{activeOperation.heartbeat_at?"Updated "+new Date(activeOperation.heartbeat_at).toLocaleTimeString():"Waiting for progress"}</span></div></div>
        <div className="portalStatCard"><div><small>VERCEL</small><strong>{activeOperation.vercel_deployment_id||"Waiting"}</strong><span>{activeOperation.vercel_project_id||install.vercel_project_name||"Existing project"}</span></div></div>
        <div className="portalStatCard"><div><small>STARTED</small><strong>{activeOperation.created_at?new Date(activeOperation.created_at).toLocaleTimeString():"Now"}</strong><span>{activeOperation.created_at?new Date(activeOperation.created_at).toLocaleDateString():""}</span></div></div>
      </div>}
      {!activeOperation&&latestOperation?.error_detail&&<p className="inlineStatus" style={{marginTop:10}}><b>{latestOperation.error_code||"Error"}:</b> {latestOperation.error_detail}</p>}
      <details style={{marginTop:10}}><summary style={summaryStyle}><b>Recent operations</b> · {operations.length}</summary><div style={{marginTop:8}}>{operations.slice(0,6).map((op:any)=><div className="listrow" key={op.id}><div><b>{label(op.action)} · {label(op.state)}</b><span>{op.error_detail||op.detail?.version||op.requested_release_id||"Deployment operation"}</span></div><span>{op.created_at?new Date(op.created_at).toLocaleString():""}</span></div>)}</div></details>
    </section>}

    {binding?<>
      {panelReady&&<section className="panel orbitZipControlPanel">
        <div className="orbitZipControlTop">
          <div><p className="eyebrow">ORBITFS CONTROL PANEL</p><h2>{install.vercel_project_name||"Your OrbitFS Panel"}</h2><p className="muted">Base deployment, release channel and approved updates in one place.</p></div>
          <div className="orbitZipControlTopActions"><span className={"state "+(validationReady?"ready":working?"current":"waiting")}>{validationReady?"HEALTHY":working?"IN PROGRESS":String(install.health_status||"UNVERIFIED").toUpperCase()}</span>{install.production_url&&<a className="buttonlink secondary" href={install.production_url} target="_blank" rel="noreferrer">Open Panel ↗</a>}</div>
        </div>

        <div className="orbitZipReleaseWorkspace">
          <div className="orbitZipReleaseControls">
            <label><span>Release channel</span><select value={selectedChannel} disabled={busy!==""||deploymentUnavailable||!infrastructureReady} onChange={e=>void saveReleaseChannel(e.target.value)}>{availableBaseChannels.map((channel:string)=><option key={channel} value={channel}>{channel}</option>)}</select></label>
            <label><span>Available Base release</span><select value={selectedBaseUpdateRelease?.id||""} disabled={busy!==""||!baseUpdateCandidates.length} onChange={e=>setSelectedReleaseId(e.target.value)}><option value="">{d?.releaseCatalogLoading?"Checking published releases…":baseUpdateCandidates.length?"Choose a newer release":d?.baseReleaseDiscoveryByChannel?.[selectedChannel]?.available!==true?"Release authority unavailable":"No newer Base release"}</option>{baseUpdateCandidates.map((r:any)=><option key={r.id} value={r.id}>v{r.version} · {r.title||"OrbitFS Base"}</option>)}</select></label>
            <button className="secondary orbitZipRefreshButton" disabled={busy!==""} onClick={()=>void refreshReleases()}>{busy==="refresh-releases"?"Refreshing…":"Refresh releases"}</button>
          </div>
          <div className="orbitZipReleaseMeta"><span>{baseUpdateCandidates.length?baseUpdateCandidates.length+" newer Base release"+(baseUpdateCandidates.length===1?"":"s")+" in "+selectedChannel:d?.releaseCatalogLoading?"Checking published Base releases…":d?.baseReleaseDiscoveryByChannel?.[selectedChannel]?.available!==true?"Base release lookup unavailable":"No newer Base release in "+selectedChannel}</span><span>{d?.lastCheckedAt?"Checked "+new Date(d.lastCheckedAt).toLocaleString():"Release status not checked yet"}</span></div>
        </div>

        <div className="portalOverviewStats orbitZipOverviewStats">
          <div className="portalStatCard"><span className="portalStatIcon">B</span><div><small>BASE</small><strong>{install.release_version}</strong><span>{selectedChannel} channel</span></div></div>
          <div className="portalStatCard"><span className="portalStatIcon">D</span><div><small>DATABASE</small><strong>{install.schema_version||"ready"}</strong><span>{install.supabase_project_name||install.supabase_project_ref||"Supabase connected"}</span></div></div>
          <div className="portalStatCard"><span className="portalStatIcon">V</span><div><small>VERCEL</small><strong>{install.vercel_project_name||"Connected"}</strong><span>{install.vercel_team_id||"Personal/default"}</span></div></div>
          <div className="portalStatCard"><span className="portalStatIcon">U</span><div><small>UPDATE STATUS</small><strong>{selectedBaseUpdateAvailable?"Base "+selectedBaseUpdateRelease.version:updateAvailable?"Update "+latestUpdate:appliedUpdateVersion?"Update "+appliedUpdateVersion+" installed":updateDiscoveryReady?"No Update installed":"Update status unavailable"}</strong><span>{selectedBaseUpdateAvailable?"Published in "+selectedChannel:updateAvailable?"New published Engine/add-on update":appliedUpdateVersion?"Recorded applied Update · "+appliedUpdateChannel:updateDiscoveryReady?"No newer approved Update":"Cannot verify published Updates"}</span></div></div>
        </div>

        <div className="orbitPrimaryActionBar">
          <div className="orbitPrimaryActionCopy"><small>NEXT ACTION</small><b>{selectedBaseUpdateAvailable&&settings.customer_base_updates_enabled?"Update Base "+install.release_version+" → "+selectedBaseUpdateRelease.version:updateAvailable&&settings.customer_updates_enabled?"Install Update "+latestUpdate:d?.releaseCatalogLoading?"Checking published releases…":d?.baseReleaseDiscoveryByChannel?.[selectedChannel]?.available!==true?"Release availability unverified":"OrbitFS Base is current"}</b><span>{selectedBaseUpdateAvailable&&settings.customer_base_updates_enabled?"The selected published Base release will update this existing Vercel project after its database migration chain is verified.":updateAvailable&&settings.customer_updates_enabled?"An approved Engine/add-on update is available for this channel.":appliedUpdateVersion?"Update "+appliedUpdateVersion+" is already recorded as installed. Base "+String(install.release_version||"")+" has its own version.":d?.releaseCatalogLoading?"Your installed Base is available while License Manager loads the release catalog.":d?.baseReleaseDiscoveryByChannel?.[selectedChannel]?.available!==true?"License Manager release discovery is unavailable. Existing installation status is shown, but new releases cannot be confirmed.":"Refresh releases at any time to check License Manager for newly published versions."}</span></div>
          <div className="orbitPrimaryActionControls">
            {selectedBaseUpdateAvailable&&settings.customer_base_updates_enabled?<button className="orbitHeroAction" disabled={busy!==""||deploymentUnavailable||!infrastructureReady} onClick={()=>void deploy("base_update",String(selectedBaseUpdateRelease.version),String(selectedBaseUpdateRelease.id))}>{busy==="base_update"?"Updating Base…":"Update Base to "+selectedBaseUpdateRelease.version}</button>:updateAvailable&&settings.customer_updates_enabled?<button className="orbitHeroAction" disabled={busy!==""||deploymentUnavailable||!infrastructureReady} onClick={()=>void deploy("update",String(latestPublishedUpdate?.version||""),String(latestPublishedUpdate?.id||""))}>{busy==="update"?"Installing…":"Install Update "+latestUpdate}</button>:<button className="orbitHeroAction" disabled={busy!==""} onClick={()=>void refreshReleases()}>{busy==="refresh-releases"?"Refreshing…":"Check for updates"}</button>}
            <details className="orbitActionMenu"><summary>More</summary><div>{install.production_url&&<a className="buttonlink secondary" href={install.production_url} target="_blank" rel="noreferrer">Open Panel</a>}<button className="secondary" disabled={busy!==""||deploymentUnavailable||!infrastructureReady||!settings.customer_deploy_enabled} onClick={()=>void deploy("redeploy")}>Redeploy Base {install.release_version}</button><button className="secondary" disabled={busy!==""} onClick={()=>void sync(false)}>Refresh runtime status</button><button className="secondary" disabled={busy!==""} onClick={()=>void repairPublicUrl()}>{busy==="public-url-repair"?"Repairing…":"Repair public Panel URL"}</button></div></details>
          </div>
        </div>

        <details className="orbitZipTechnicalDetails">
          <summary><div><p className="eyebrow">TECHNICAL DETAILS</p><b>Infrastructure & installation identity</b></div><span>View details</span></summary>
          <div className="orbitZipControlGrid">
            <div className="panel orbitZipControlSection">
              <div className="panelTitle"><div><p className="eyebrow">INFRASTRUCTURE</p><h2>Customer-owned services</h2></div><span className="state ready">CONNECTED</span></div>
              <div className="orbitZipControlRows">
                <div><span>Supabase project</span><b>{install.supabase_project_name||install.supabase_project_ref}</b></div>
                <div><span>Database schema</span><b>{install.schema_version||"ready"}</b></div>
                <div><span>Vercel project</span><b>{install.vercel_project_name||install.vercel_project_id||"Connected"}</b></div>
                <div><span>Vercel owner</span><b>{install.vercel_team_id||vercelConnection?.team_id||"Personal/default"}</b></div>
              </div>
            </div>
            <div className="panel orbitZipControlSection">
              <div className="panelTitle"><div><p className="eyebrow">INSTALLATION</p><h2>Authority & identity</h2></div><span className="state ready">VALIDATED</span></div>
              <div className="orbitZipControlRows">
                <div><span>Installation ID</span><b>{install.installation_id}</b></div>
                <div><span>Licence activation</span><b>Managed in Base first-time setup</b></div>
                <div><span>Release ID</span><b>{install.release_id||"Recorded"}</b></div>
                <div><span>Runtime health</span><b>{install.health_status||"healthy"}</b></div>
              </div>
            </div>
          </div>
          <div className="orbitZipReleaseIdentity"><span>Installed release identity</span><b>{install.release_id||"not recorded"}</b><small>Source {install.release_source_commit||"not recorded"} · SHA-256 {install.release_sha256||"not recorded"}</small></div>
        </details>

        <details className="panel orbitZipLifecyclePanel">
          <summary><div><p className="eyebrow">LIFECYCLE & RECOVERY</p><b>Deployment controls</b><span>Force reinstall Base, undeploy, reset or uninstall when you need recovery or removal.</span></div><span>Open controls</span></summary>
          <div className="orbitZipLifecycleBody">
            <p className="muted">Force reinstall is Base-only: it removes the current Base Vercel project and releases/unlocks its licence activation. Supabase, database, storage, installation ID and Shared Engine Host stay in place. You must rotate the licence key and enter the replacement key before the newest approved published Base is deployed again.</p>
            <div className="orbitZipLifecycleRows">
              <div><div><b>Force reinstall published Base</b><span>Delete only the current Base project, release the licence activation, then require a rotated key before the published Base is deployed again.</span></div><button className="orbitZipDangerButton" disabled={busy!==""||deploymentUnavailable||!infrastructureReady||!!pendingBaseForceReinstall} onClick={()=>void forceReinstallBase()}>{busy==="force-base-reinstall"?"Removing Base…":"Force reinstall Base"}</button></div>
              <div><div><b>Undeploy OrbitFS</b><span>Remove the Base runtime and Shared Engine Host from Vercel while preserving the customer installation.</span></div><button className="secondary" disabled={busy!==""||!install.vercel_project_id} onClick={()=>void executeLifecycle("undeploy")}>{busy==="undeploy"?"Undeploying…":"Undeploy"}</button></div>
              <details>
                <summary><div><b>Uninstall OrbitFS</b><span>Remove the runtime and optionally clean OrbitFS-owned database, storage and licence binding.</span></div><span>Configure →</span></summary>
                <div className="orbitZipUninstallOptions">
                  <label><input type="checkbox" checked={uninstallOptions.removeDatabase} onChange={e=>setUninstallOptions(v=>({...v,removeDatabase:e.target.checked}))}/><span><b>Remove OrbitFS database objects</b><small>Deletes OrbitFS-owned tables and functions. The Supabase project itself is never deleted.</small></span></label>
                  <label><input type="checkbox" checked={uninstallOptions.removeStorage} onChange={e=>setUninstallOptions(v=>({...v,removeStorage:e.target.checked}))}/><span><b>Remove OrbitFS storage</b><small>Empties and removes the OrbitFS storage bucket.</small></span></label>
                  <label><input type="checkbox" checked={uninstallOptions.releaseLicense} onChange={e=>setUninstallOptions(v=>({...v,releaseLicense:e.target.checked}))}/><span><b>Release licence binding</b><small>Terminates this installation activation through License Manager.</small></span></label>
                  <button className="orbitZipDangerButton" disabled={busy!==""} onClick={()=>void executeLifecycle("uninstall")}>{busy==="uninstall"?"Uninstalling…":"Review plan & uninstall"}</button>
                  {lifecyclePlan?.plan&&<p className="muted">Plan: {(lifecyclePlan.plan.steps||[]).map((step:any)=>step.label).join(" → ")}</p>}
                </div>
              </details>
            </div>
          </div>
        </details>
      </section>}

      {!panelReady&&<section className="orbitV5Flow">
        <div className="orbitV5SectionTitle"><div><p className="eyebrow">DEPLOYMENT FLOW</p><h2>Your installation, step by step.</h2><p>Select a step to review or adjust its settings.</p></div><span>{journey.filter(x=>x.done).length} / 6 complete</span></div>
        <nav className="orbitV5FlowCards" aria-label="Base installation stages">{journey.map(x=><button type="button" key={x.id} disabled={!install||(x.id===6&&!panelReady)} onClick={()=>openSiteStep(x.id)} className={"orbitV5FlowCard "+(x.done?"done":activeSiteStep===x.id?"active":"")} aria-current={(panelReady?x.id===6:activeSiteStep===x.id)?"step":undefined}>
          <span className="orbitV5FlowIndex">{x.done?"✓":x.id}</span><span><b>{x.title}</b><small>{x.text}</small></span>
        </button>)}</nav>

      </section>}

      {install&&!panelReady&&<div className="portalOverviewGrid orbitZipWorkspace orbitV5SingleWorkspace">
        <div className="orbitZipCanvasColumn">
<section hidden={activeSiteStep!==1} className="orbitV5Connections">          <details hidden={activeSiteStep!==1} className="panel orbitInstallerWorkspace" open><summary className="panelTitle" style={summaryStyle}><div><p className="eyebrow">SUPABASE CONNECTION</p><h2>Connect Supabase</h2><p className="muted">Connect your Supabase account, then select or create the project for this installation.</p></div><span className={`state ${supabaseConnectionReady?"ready":"waiting"}`}>{supabaseConnectionReady?"CONNECTED":"CONNECT"}</span></summary>{!supabaseConnectionReady?<button disabled={providerSetupUnavailable||!settings.supabase_oauth_enabled||busy==="supabase"} onClick={()=>void connectSupabase()}>{busy==="supabase"?"Connecting…":"Connect my Supabase"}</button>:<><div className="listrow"><div><b>{supabase.provider_account_name||"Customer Supabase account"}</b><span>OAuth connection is saved and verified by the Billing Store.</span></div><span className="state ready">CONNECTED</span></div>{install.supabase_project_ref&&<p className="muted" style={{marginTop:10}}>A project selection is already recorded: <b>{install.supabase_project_name||install.supabase_project_ref}</b>. Review or change it in Step 2 (Database).</p>}<div className="controllerActions" style={{marginTop:10}}><button className="secondary" disabled={busy!==""} onClick={()=>void resetSupabase()}>Reset / reconnect Supabase</button></div></>}</details>          <details hidden={activeSiteStep!==1} className="panel orbitInstallerWorkspace" open><summary className="panelTitle" style={summaryStyle}><div><p className="eyebrow">VERCEL CONNECTION</p><h2>Connect Vercel</h2><p className="muted">Connect the customer Vercel account. OrbitFS will automate the project and runtime variables it can manage through the Vercel API.</p></div><span className={`state ${vercelApiReady?"ready":"waiting"}`}>{vercelApiReady?"CONNECTED":"CONNECT"}</span></summary>{vercelApiReady?<><div className="listrow"><div><b>{vercelConnection.provider_account_name||"Your Vercel account"}</b><span>Full API access validated. The token is stored encrypted and is never returned to this page.</span></div><span className="state ready">READY</span></div><div className="form" style={{marginTop:10}}><label>Deployment account/team<select value={vercelTeamId} onChange={e=>setVercelTeamId(e.target.value)}><option value="">Personal/default account</option>{vercelTeams.map((t:any)=><option key={t.id} value={t.id}>{t.name||t.slug||t.id}</option>)}</select></label><button className="secondary" disabled={busy==="vercel-team"} onClick={()=>void selectVercelTeam()}>{busy==="vercel-team"?"Saving…":"Use selected account"}</button><div className="controllerActions"><button className="secondary" disabled={busy!==""} onClick={()=>void resetVercel()}>Reset / reconnect Vercel</button></div></div></>:<div className="form"><p className="muted">Vercel connection is independent of database initialization, so you can connect hosting now even if a new Base release has not been published yet.</p><button disabled={providerSetupUnavailable||!settings.vercel_oauth_enabled||busy==="vercel-oauth"} onClick={()=>void connectVercelOAuth()}>{busy==="vercel-oauth"?"Connecting…":"Connect my Vercel"}</button><div className="orbitProviderDivider"><span>or use a Full Account Access token</span></div><a className="buttonlink secondary" href="https://vercel.com/account/tokens" target="_blank" rel="noreferrer">Open Vercel Tokens</a><label>Vercel token<input type="password" autoComplete="off" value={vercelToken} onChange={e=>setVercelToken(e.target.value)} placeholder="Paste token once"/></label><button className="secondary" disabled={providerSetupUnavailable||busy==="vercel"||!vercelToken.trim()} onClick={()=>void connectVercelToken()}>{busy==="vercel"?"Validating…":"Use Vercel access token"}</button></div>}</details><div className="orbitV5StepActions"><button disabled={!connectionsReady} onClick={()=>openSiteStep(2)}>Continue to database →</button></div></section>

<section hidden={activeSiteStep!==2} className="panel orbitInstallerWorkspace orbitV5DatabaseStep"><div className="panelTitle"><div><p className="eyebrow">STEP 2 · DATABASE</p><h2>Choose your Supabase project</h2><p className="muted">Select or create your database project here. Its Base schema is initialized in Step 4 after release selection.</p></div><span className={"state "+(supabaseReady?"ready":"waiting")}>{supabaseReady?"SELECTED":"REQUIRED"}</span></div>{!supabaseConnectionReady?<button onClick={()=>openSiteStep(1)}>Connect providers in Step 1</button>:<><div className="listrow"><div><b>{supabaseReady?(install.supabase_project_name||install.supabase_project_ref):"No project selected"}</b><span>{supabaseReady?(install.supabase_region||"Supabase")+" · "+install.supabase_project_ref:"Choose your customer-owned project"}</span></div><span className={"state "+(supabaseReady?"ready":"waiting")}>{supabaseReady?"SELECTED":"REQUIRED"}</span></div>{!databaseReady&&<><button className="secondary" style={{marginTop:10}} onClick={()=>void loadSupabase()} disabled={busy==="resources"}>{busy==="resources"?"Loading…":resources?"Refresh projects":supabaseReady?"Review / change project":"Choose project"}</button>{resources&&<div className="form" style={{marginTop:12}}>{settings.allow_create_supabase_project&&<><h3>Create a dedicated OrbitFS project</h3><label>Organization<select value={newProject.organizationSlug} onChange={e=>setNewProject({...newProject,organizationSlug:e.target.value})}><option value="">Choose organization</option>{(resources.organizations||[]).map((o:any)=><option key={o.slug||o.id} value={o.slug||o.id}>{o.name}</option>)}</select></label><label>Project name<input value={newProject.name} onChange={e=>setNewProject({...newProject,name:e.target.value})} placeholder="OrbitFS"/></label><label>Region<input value={newProject.region} onChange={e=>setNewProject({...newProject,region:e.target.value})}/></label><button disabled={!newProject.organizationSlug||busy==="create"} onClick={()=>void supabaseAction("create")}>{busy==="create"?"Creating…":"Create in my Supabase"}</button></>}{settings.allow_existing_supabase_project&&<><h3>Use an existing project</h3><label>Project<select value={selectedProject} onChange={e=>setSelectedProject(e.target.value)}><option value="">Choose project</option>{(resources.projects||[]).map((p:any)=><option key={p.id||p.ref} value={p.id||p.ref}>{p.name} · {p.region||"region"}</option>)}</select></label><button disabled={!selectedProject||busy==="select"} onClick={()=>void supabaseAction("select")}>Use selected project</button></>}</div>}</>}{databaseReady&&<p className="inlineStatus">Already initialized: schema {install?.schema_version||"recorded"}.</p>}<div className="orbitV5StepActions"><button disabled={!supabaseReady} onClick={()=>openSiteStep(3)}>Continue to channel & release →</button></div></>}</section>

          <section hidden={activeSiteStep!==3} className="panel orbitInstallerWorkspace orbitV5ReleaseStep">
            <div className="panelTitle"><div><p className="eyebrow">STEP 3 · CHANNEL & RELEASE</p><h2>Select your Base release</h2><p className="muted">Choose the channel and published Base version authorized by License Manager. The database is initialized for that exact release.</p></div><span className={"state "+(releaseReady?"ready":selectedRelease?"current":"waiting")}>{releaseReady?"CONFIRMED":selectedRelease?"REVIEW SELECTION":"WAITING"}</span></div>
            <div className="form">
              <label>Release channel<select value={selectedChannel} disabled={busy!==""||deploymentUnavailable} onChange={e=>{setSelectedReleaseId("");setReleaseConfirmed(false);void saveReleaseChannel(e.target.value);}}>{availableBaseChannels.map((c:string)=><option key={c} value={c}>{c}</option>)}</select></label>
              <label>Published Base version<select value={selectedRelease?.id||""} disabled={busy!==""||!publishedBaseReleases.length} onChange={e=>{setSelectedReleaseId(e.target.value);setReleaseConfirmed(false);}}><option value="">Choose a published Base release</option>{publishedBaseReleases.map((r:any)=><option key={r.id} value={r.id}>v{r.version} · {r.title||"OrbitFS Base"}</option>)}</select></label>
              <button className="secondary" type="button" disabled={busy!==""} onClick={()=>void refreshReleases()}>{busy==="refresh-releases"?"Refreshing…":"Refresh published releases"}</button>
            </div>
            {selectedRelease?<div className="orbitV5ReleaseSelected"><div className="listrow"><div><b>Base v{selectedRelease.version}</b><span>{selectedRelease.channel||selectedChannel} · {selectedRelease.title||"OrbitFS Base"}</span></div><span className="state ready">PUBLISHED</span></div><details><summary>View release changelog</summary><p className="muted" style={{whiteSpace:"pre-wrap"}}>{selectedRelease.changelog||selectedRelease.notes||"No customer changelog supplied."}</p></details></div>:<p className="inlineStatus">No published Base release is currently available in this channel. You can prepare your connections while waiting.</p>}
            <div className="orbitV5StepActions"><button type="button" disabled={!selectedRelease} onClick={()=>{setReleaseConfirmed(true);openSiteStep(4);}}>Confirm release & continue →</button></div>
          </section>

<div hidden={activeSiteStep!==4} className="orbitV5ConfigWorkspace"><p className="orbitV5StepNote">Initialize the selected Base release here. The licence key is not entered in Billing; activation happens after deployment in the Base first-time installer.</p>          <details hidden={activeSiteStep!==4} className="panel orbitInstallerWorkspace" open><summary className="panelTitle" style={summaryStyle}><div><p className="eyebrow">STEP 4 · DATABASE INITIALIZATION</p><h2>Initialize selected Base schema</h2><p className="muted">Initialize the Base release selected in Step 3 using the project you chose in Step 2.</p></div><span className={`state ${configDatabaseReady?"ready":supabaseConnectionReady?"current":"waiting"}`}>{configDatabaseReady?`SCHEMA ${install.schema_version}`:supabaseReady?(releaseReady?"INITIALIZE":"RELEASE REQUIRED"):"CHOOSE PROJECT"}</span></summary>{!supabaseConnectionReady?<div className="form"><p className="muted">Reconnect Supabase before configuring the customer database.</p><button onClick={()=>openSiteStep(1)}>Open Supabase connection</button></div>:<>{!supabaseReady&&<p className="inlineStatus">Select a database in Step 2 first.</p>}{supabaseReady&&(configDatabaseReady?<><div className="listrow" style={{marginTop:10}}><div><b>Database initialized for OrbitFS {install.release_version}</b><span>Channel {install.release_channel||selectedChannel} · License Manager release {install.release_id} · schema {install.schema_version}</span></div><span className="state ready">READY</span></div></>:<><div className="orbitV5ReleaseLocked"><small>SELECTED BASE RELEASE</small><b>{selectedRelease?"v"+selectedRelease.version+" · "+selectedChannel:"No published Base release selected"}</b><button className="secondary" type="button" onClick={()=>openSiteStep(3)}>Change release</button></div>{selectedRelease&&!releaseReady&&<p className="inlineStatus">Confirm the chosen release in Step 3 before initializing.</p>}{selectedRelease?<><button disabled={!supabaseReady||!releaseReady||deploymentUnavailable||!settings.customer_deploy_enabled||busy==="init"} onClick={()=>void initialize()}>{busy==="init"?"Initializing…":`Initialize Base v${selectedRelease.version}`}</button></>:<p className="muted">Select an approved Base release in Step 3 to initialize this database.</p>}</>)}</>}</details>
            {pendingBaseForceReinstall&&<section className="panel orbitReviewPanel"><div className="panelTitle"><div><p className="eyebrow">RECOVERY · LICENCE ROTATION</p><h2>Continue after licence rotation</h2><p className="muted">Rotate the key in the licence page, then continue the reinstall. Billing never accepts the raw licence key.</p></div><span className="state current">RECOVERY</span></div><div className="form"><button disabled={busy!==""||authorityLocked} onClick={()=>void deploy("deploy")}>{busy==="deploy"?"Checking rotation & reinstalling…":"I rotated the key · Continue reinstall"}</button></div></section>}
            {configurationReady&&<div className="orbitV5StepActions"><button type="button" onClick={()=>openSiteStep(5)}>Continue to live deployment →</button></div>}
            {!pendingBaseForceReinstall&&!install?.vercel_deployment_id&&!install?.production_url&&<details className="orbitV5SetupRecovery"><summary>Advanced setup & recovery</summary><p className="muted">Reset the installer and disconnect its provider sessions without deleting customer projects or data. This is not an uninstall.</p><button className="secondary" type="button" disabled={busy!==""} onClick={()=>void resetSetupToStage1()}>{busy==="reset-setup"?"Resetting…":"Reset setup and start again"}</button></details>}
          </div>

          <div hidden={activeSiteStep!==5} className="orbitV5LiveWorkspace">
          <section hidden={activeSiteStep!==5} className="panel orbitV5Requirements">
            <p className="eyebrow">FINAL REVIEW</p><h2>Deployment summary</h2>
            <div className="orbitV5ReviewGrid">
              <div><small>BASE RELEASE</small><b>{selectedRelease?"v"+selectedRelease.version:install?.release_version?"v"+install.release_version:"Not available"}</b><span>{selectedChannel} channel</span></div>
              <div><small>DATABASE</small><b>{install?.supabase_project_name||install?.supabase_project_ref||"Not selected"}</b><span>{databaseReady?"Schema initialized":"Initialization required"}</span></div>
              <div><small>HOSTING</small><b>{vercelConnection?.provider_account_name||"Not connected"}</b><span>{vercelApiReady?"Vercel connected":"Connection required"}</span></div>
              <div><small>LICENCE ACTIVATION</small><b>After deployment</b><span>Enter the licence key in the Base first-time installer</span></div>
            </div>
            {(!releaseReady||!supabaseReady||!databaseReady||!selectedReleaseMatchesInstalled||!vercelApiReady||deploymentUnavailable)&&<div className="orbitV5Blockers">
              <h3>Complete before deploying</h3>
              <ul>
                {!releaseReady&&<li>Confirm a published Base release in Step 3.</li>}
                {!supabaseReady&&<li>Connect both providers in Step 1 and select your database in Step 2.</li>}
                {(!databaseReady||!selectedReleaseMatchesInstalled)&&<li>Initialize the selected Base release in Step 4.</li>}
                {!vercelApiReady&&<li>Connect Vercel in Step 1.</li>}
                {deploymentUnavailable&&<li>License Manager has restricted deployment. Review the authority notice above.</li>}
                
              </ul>
            </div>}
          </section>
          <details hidden={activeSiteStep!==5} className="panel orbitInstallerWorkspace" open={reviewReady&&!panelReady}><summary className="panelTitle" style={summaryStyle}><div><p className="eyebrow">{"STEP 5 · LIVE DEPLOYMENT PROGRESS"}</p><h2>{"Deploy and monitor Base"}</h2><p className="muted">{"Review the exact Base release and connected providers before starting deployment. OrbitFS configures the customer Vercel project and runtime variables automatically."}</p></div><span className={`state ${panelReady?"ready":working?"current":"waiting"}`}>{panelReady?"READY":working?label(install.state).toUpperCase():"DEPLOY"}</span></summary>{!install.vercel_deployment_id?<><div className="listrow"><div><b>Published Base release</b><span>{selectedRelease?`${selectedRelease.version} · ${selectedRelease.channel||selectedChannel}`:"No published Base release available"}</span></div><span className={`state ${selectedRelease?"ready":"waiting"}`}>{selectedRelease?"READY":"WAITING"}</span></div><div className="form" style={{marginTop:10}}><div className="listrow"><div><b>Base release channel</b><span>{install.release_channel||selectedChannel}</span></div><span className="state ready">LOCKED TO DB</span></div><div className="listrow"><div><b>Base version</b><span>{selectedRelease?`v${selectedRelease.version} · ${selectedRelease.title||"OrbitFS Base"}`:"No published Base release available"}</span></div><span className={`state ${selectedRelease?"ready":"waiting"}`}>{selectedRelease?"SELECTED":"WAITING"}</span></div><p className="muted">The release is chosen in Step 3 and initialized in the database during Step 4.</p></div>{selectedRelease&&<div className="panel" style={{marginTop:10}}><div className="listrow"><div><b>OrbitFS Base {selectedRelease.version}</b><span>{selectedRelease.changelog||selectedRelease.notes||"No customer changelog supplied."}</span></div><span className="state ready">PUBLISHED</span></div><div className="listrow"><div><b>Release identity</b><span>ID {selectedRelease.id} · source {selectedRelease.source_sha||selectedRelease.source_commit||selectedRelease.manifest?.sourceCommit||"recorded in release"}</span></div><span>{selectedRelease.artifact_sha256||selectedRelease.sha256?"CHECKSUM":"MASTER"}</span></div>{(selectedRelease.manifest?.minimumBaseVersion||selectedRelease.minimum_base_version||selectedRelease.minimum_version)&&<div className="listrow"><div><b>Compatibility</b><span>Minimum Base {selectedRelease.manifest?.minimumBaseVersion||selectedRelease.minimum_base_version||selectedRelease.minimum_version}</span></div><span>CHECKED</span></div>}<p className="muted">This is the exact published License Master release that will be handed to the deployer. The installation stores its release ID, version, checksum and source commit; the package itself remains in the release system.</p></div>}<button disabled={!!activeOperation||!infrastructureReady||!selectedRelease||!releaseReady||String(install.release_id||"")!==String(selectedRelease.id)||deploymentUnavailable||!settings.customer_deploy_enabled||busy==="deploy"} onClick={()=>void deploy("deploy",String(selectedRelease?.version||""),String(selectedRelease?.id||""))}>{busy==="deploy"?"Deploying…":"Deploy selected Base release"}</button></>:<div className="orbitV5DeployRunning"><p>Deployment has started. Follow the live operation and validation results below.</p><button type="button" className="secondary" disabled={busy!==""} onClick={()=>void sync(false)}>Refresh deployment status</button></div>}{working&&<p className="muted">Live status refreshes automatically every 3 seconds while this operation is active. Polling stops automatically when it finishes.</p>}</details>
    {(activeOperation||latestOperation)&&<section className="panel orbitV5OperationPanel orbitV5LiveProgress" style={{marginBottom:14}}>
      <div className="panelTitle"><div><p className="eyebrow">DEPLOYMENT STATUS</p><h2>{activeOperation?label(activeOperation.action)+" · "+label(activeOperation.state):latestOperation?.state==="failed"?"Last deployment attempt failed":"Recent deployment activity"}</h2><p className="muted">{activeOperation?`Live Base operation. Status, events and Vercel readiness refresh automatically every 3 seconds${liveCheckedAt?" · last checked "+new Date(liveCheckedAt).toLocaleTimeString():""}.`:"Latest Base deployment operation recorded by Billing Store."}</p></div><span className={"state "+(activeOperation?"current":latestOperation?.state==="completed"?"ready":"waiting")}>{String(activeOperation?.state||latestOperation?.state||"status").replaceAll("_"," ").toUpperCase()}</span></div>
      {activeOperation&&<div className="portalOverviewStats" style={{marginTop:10}}>
        <div className="portalStatCard"><div><small>ACTION</small><strong>{label(activeOperation.action)}</strong><span>{activeOperation.detail?.version||activeOperation.requested_release_id||"Current release"}</span></div></div>
        <div className="portalStatCard"><div><small>STAGE</small><strong>{label(activeOperation.state)}</strong><span>{activeOperation.heartbeat_at?"Updated "+new Date(activeOperation.heartbeat_at).toLocaleTimeString():"Waiting for progress"}</span></div></div>
        <div className="portalStatCard"><div><small>VERCEL</small><strong>{activeOperation.vercel_deployment_id||"Waiting"}</strong><span>{activeOperation.vercel_project_id||install.vercel_project_name||"Existing project"}</span></div></div>
        <div className="portalStatCard"><div><small>STARTED</small><strong>{activeOperation.created_at?new Date(activeOperation.created_at).toLocaleTimeString():"Now"}</strong><span>{activeOperation.created_at?new Date(activeOperation.created_at).toLocaleDateString():""}</span></div></div>
      </div>}
      {!activeOperation&&latestOperation?.error_detail&&<p className="inlineStatus" style={{marginTop:10}}><b>{latestOperation.error_code||"Error"}:</b> {latestOperation.error_detail}</p>}
      <details style={{marginTop:10}}><summary style={summaryStyle}><b>Recent operations</b> · {operations.length}</summary><div style={{marginTop:8}}>{operations.slice(0,6).map((op:any)=><div className="listrow" key={op.id}><div><b>{label(op.action)} · {label(op.state)}</b><span>{op.error_detail||op.detail?.version||op.requested_release_id||"Deployment operation"}</span></div><span>{op.created_at?new Date(op.created_at).toLocaleString():""}</span></div>)}</div></details>
    </section>}
          </div>

        </div>


      </div>}

      {install&&panelReady&&<div className="portalOverviewBottom"><details className="panel" open><summary className="panelTitle" style={summaryStyle}><div><p className="eyebrow">BASE RELEASES</p><h2>Current & previous</h2></div><span>{visibleBaseHistory.length}</span></summary>{visibleBaseHistory.length?visibleBaseHistory.map((r:any,index:number)=><div className="listrow" key={r.id}><div><b>{r.release_version} · {index===0?"Current":"Previous"}</b><span>{r.deployment_url||"deployment record"} · release {String(r.release_id||"").slice(0,8)}…</span></div><span className={"state "+(index===0?"ready":"waiting")}>{index===0?"CURRENT":"ROLLBACK"}</span></div>):<p className="muted">No successful Base deployments yet.</p>}{olderBaseHistory.length>0&&<details style={{marginTop:10}}><summary style={summaryStyle}>Older Base history · {olderBaseHistory.length}</summary><div style={{marginTop:8}}>{olderBaseHistory.map((r:any)=><div className="listrow" key={r.id}><div><b>{r.release_version}</b><span>{r.action} · retained for audit</span></div><span>{new Date(r.created_at).toLocaleString()}</span></div>)}</div></details>}</details><details className="panel"><summary className="panelTitle" style={summaryStyle}><div><p className="eyebrow">ACTIVITY</p><h2>Setup activity</h2></div><span>{events.length}</span></summary>{events.length?events.slice(0,20).map((e:any)=><div className="listrow" key={e.id}><div><b>{label(e.event_type)}</b><span>{e.message||e.status}</span></div><span>{new Date(e.created_at).toLocaleString()}</span></div>):<p className="muted">No setup activity yet.</p>}</details></div>}
    </>:<section className="panel"><div className="panelTitle"><div><p className="eyebrow">MY ORBITFS</p><h2>OrbitFS access pending</h2><p className="muted">Licensing and release access are provided by the Master service.</p></div></div></section>}

    {binding&&<section className="orbitV5Support" aria-label="Deployment support">
      <div><p className="eyebrow">NEED HELP?</p><b>Need a hand with your installation?</b><span>Support can help with configuration or a failed deployment.</span></div>
      <Link className="buttonlink secondary" href="/portal/support">Contact support ↗</Link>
    </section>}

  </main>;
}
