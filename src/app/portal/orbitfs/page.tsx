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
  const [viewedPrimaryStage,setViewedPrimaryStage]=useState<number|null>(null);
  const [selectedReleaseId,setSelectedReleaseId]=useState("");
  const [preferredBaseChannel,setPreferredBaseChannel]=useState("");
  const [licenseKey,setLicenseKey]=useState("");
  const [uninstallOptions,setUninstallOptions]=useState({removeDatabase:false,removeStorage:false,releaseLicense:false});
  const [lifecyclePlan,setLifecyclePlan]=useState<any>(null);

  async function authHeaders():Promise<Record<string,string>>{const {data:{session}}=await sb.auth.getSession();return session?.access_token?{Authorization:`Bearer ${session.access_token}`}:{} }
  async function load(background=false){
    if(!background)setLoading(true);
    try{
      const headers=await authHeaders();
      if(!headers.Authorization){setMsg("Your session has expired. Please sign in again.");return}
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
      try{
        const r=await fetch("/api/orbitfs/status",{headers,cache:"no-store",signal:controller.signal}),j=await r.json().catch(()=>({}));
        if(r.ok){setD(j);setMsg("")}else setMsg(apiError(j,"Could not load My OrbitFS."));
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
    void load().finally(()=>{
      if(connected==="supabase"&&!callbackError)setMsg("Supabase account connected. Choose an existing project or create a new one.");
      if(connected||callbackError)window.history.replaceState({},document.title,window.location.pathname);
    });
  },[]);

  const bases=(d?.bindings||[]).filter(hasBase),binding=bases.find((candidate:any)=>(d?.installations||[]).some((x:any)=>String(x.license_binding_id)===String(candidate.id)))||bases[0],install=(d?.installations||[]).find((x:any)=>String(x.license_binding_id)===String(binding?.id)),supabase=(d?.connections||[]).find((x:any)=>x.provider==="supabase"&&x.status==="connected"),vercelConnection=(d?.connections||[]).find((x:any)=>x.provider==="vercel"&&x.status==="connected"),vercelApiReady=vercelConnection?.metadata?.api_ready===true,vercelTeams=Array.isArray(vercelConnection?.metadata?.teams)?vercelConnection.metadata.teams:[],settings=d?.settings||{},history=(d?.releases||[]).filter((x:any)=>x.installation_id===install?.id),events=(d?.events||[]).filter((x:any)=>x.installation_id===install?.id);
  const baseHistory=history.filter((x:any)=>x.action!=="update"&&x.status==="ready").sort((a:any,b:any)=>new Date(b.ready_at||b.created_at||0).getTime()-new Date(a.ready_at||a.created_at||0).getTime());
  const visibleBaseHistory=baseHistory.slice(0,2),olderBaseHistory=baseHistory.slice(2),previousBaseDeployment=visibleBaseHistory.find((x:any)=>String(x.release_id||"")!==String(install?.release_id||""))||null;
  const operations=Array.isArray(d?.operations)?d.operations:[],activeOperation=d?.activeOperation||null,latestOperation=operations[0]||null;
    const baseInstalled=!!(install?.release_version&&install?.release_id&&install?.vercel_project_id&&(install?.vercel_deployment_id||install?.production_url));
    const operationWorking=!!activeOperation;
    const supabaseConnectionReady=!!supabase,supabaseReady=supabaseConnectionReady&&!!install?.supabase_project_ref,databaseReady=supabaseReady&&!!install?.database_initialized_at,infrastructureReady=supabaseConnectionReady&&databaseReady&&vercelApiReady,deploymentReady=!!(install?.release_version&&install?.vercel_project_id&&install?.state==="ready"),licenseRegistration=install?.metadata?.licenseRegistration||null,licenseRegistered=licenseRegistration?.valid===true&&String(licenseRegistration?.installationId||"")===String(install?.installation_id||""),validationReady=deploymentReady&&licenseRegistered&&String(install?.health_status||"")==="healthy",panelReady=baseInstalled,working=!!install&&(workingStates.has(String(install.state))||operationWorking),reviewReady=infrastructureReady&&licenseRegistered;
  const pendingBaseForceReinstall=install?.metadata?.pendingBaseForceReinstall&&typeof install.metadata.pendingBaseForceReinstall==="object"?install.metadata.pendingBaseForceReinstall:null,baseReinstallNeedsRotation=Boolean(pendingBaseForceReinstall&&!pendingBaseForceReinstall.rotationCompletedAt),baseReinstallWaitingNewKey=Boolean(pendingBaseForceReinstall?.rotationCompletedAt&&!licenseRegistered),baseReinstallDeploymentFailed=String(pendingBaseForceReinstall?.status||"")==="deployment_failed";
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
  const latestBaseRelease=d?.latestBase||null,latestBase=latestBaseRelease?.version,baseUpdateAvailable=Boolean(d?.baseUpdateAvailable&&latestBaseRelease?.id),latestUpdate=d?.latestUpdate?.version,appliedUpdate=install?.metadata?.appliedUpdate||null,appliedUpdateVersion=String(appliedUpdate?.version||""),updateAvailable=!!(install?.release_version&&latestUpdate&&appliedUpdateVersion!==String(latestUpdate)),components=binding?Object.entries(binding.components||{}).filter(([,v])=>v).map(([k])=>k):[];
  const baseUpdateCandidates=publishedBaseReleases.filter((r:any)=>{const comparison=compareOrbitReleaseVersions(r.version,install?.release_version);return comparison!==null&&comparison>0});
  const selectedBaseUpdateRelease=baseUpdateCandidates.find((r:any)=>String(r.id)===selectedReleaseId)||baseUpdateCandidates[0]||null;
  const selectedBaseUpdateAvailable=Boolean(selectedBaseUpdateRelease?.id);

  useEffect(()=>{if(!preferredBaseChannel&&availableBaseChannels.length)setPreferredBaseChannel(String(availableBaseChannels[0]))},[availableBaseChannels.join(","),preferredBaseChannel]);
  useEffect(()=>{if(selectedRelease?.id&&!selectedReleaseId)setSelectedReleaseId(String(selectedRelease.id))},[selectedRelease?.id,selectedReleaseId]);
  useEffect(()=>{if(vercelConnection?.team_id!==undefined&&vercelConnection?.team_id!==null&&!vercelTeamId)setVercelTeamId(String(vercelConnection.team_id))},[vercelConnection?.team_id]);
  useEffect(()=>{
    if(!install||!working){pollCount.current=0;return}
    if(pollCount.current>=180)return;
    const timer=setTimeout(()=>{pollCount.current+=1;void load(true)},5000);
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

  async function start(){if(!binding)return;if(providerSetupUnavailable)return setMsg(settings.maintenance_mode?(settings.maintenance_message||"OrbitFS deployment maintenance is active."):(settings.license_authority_notice||"OrbitFS authority is unavailable."));setBusy("start");try{const r=await fetch("/api/orbitfs/installations/start",{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({bindingId:binding.id})}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(apiError(j,"Could not start OrbitFS setup."));const data=j.installation;setMsg("OrbitFS setup started.");await trackCustomerActivity("orbitfs.installation.create",{entityType:"license",entityId:binding.id,detail:{installation_id:data?.installation_id}});await load()}catch(e:any){setMsg(e?.message||"Could not start OrbitFS setup.")}finally{setBusy("")}}
  async function connectSupabase(){if(!install)return;setBusy("supabase");const r=await fetch("/api/orbitfs/oauth/supabase/start",{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({installationId:install.id})}),j=await r.json().catch(()=>({}));setBusy("");if(!r.ok)return setMsg(apiError(j,"Could not connect Supabase."));location.href=j.url}
  async function resetSupabase(){if(!confirm("Disconnect the current Supabase connector? This removes the saved OAuth tokens. Your Supabase project and its data are not deleted."))return;setBusy("supabase-reset");const r=await fetch("/api/orbitfs/providers/supabase",{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({action:"disconnect"})}),j=await r.json().catch(()=>({}));setBusy("");setResources(undefined);if(!r.ok)return setMsg(apiError(j,"Could not reset Supabase connection."));setMsg("Supabase connector reset. Connect your Supabase account again.");await load()}
  async function saveReleaseChannel(channel:string){
    setPreferredBaseChannel(channel);setSelectedReleaseId("");
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
      setSelectedReleaseId("");
      await load(true);
      setMsg(`Published releases refreshed for ${selectedChannel}.`);
    }finally{setBusy("")}
  }
  async function loadSupabase(){setBusy("resources");const r=await fetch("/api/orbitfs/providers/supabase",{headers:await authHeaders(),cache:"no-store"}),j=await r.json().catch(()=>({}));setBusy("");if(!r.ok)return setMsg(apiError(j,"Could not load your Supabase projects."));setResources(j);const first=j.organizations?.[0];if(!newProject.organizationSlug&&first)setNewProject(current=>({...current,organizationSlug:first.slug||first.id||""}))}
  async function supabaseAction(action:"select"|"create"){if(!install)return;setBusy(action);const body=action==="select"?{action,installationId:install.id,projectRef:selectedProject}:{action,installationId:install.id,...newProject},r=await fetch("/api/orbitfs/providers/supabase",{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify(body)}),j=await r.json().catch(()=>({}));setBusy("");setMsg(r.ok?`Your Supabase project was ${action==="select"?"selected":"created"}.`:apiError(j,"Supabase project action failed."));if(r.ok){setResources(undefined);await load()}}
  async function initialize(){if(!install||!selectedRelease)return;if(!selectedReleaseMatchesInstalled&&install.release_version&&install.release_id&&!confirm("This will initialize the selected published Base release, replacing the current installation release identity. Continue?"))return;setBusy("init");const r=await fetch(`/api/orbitfs/installations/${install.id}/initialize`,{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({releaseId:String(selectedRelease.id)})}),j=await r.json().catch(()=>({}));setBusy("");setMsg(r.ok?"OrbitFS database initialized in your Supabase project.":apiError(j,"Database initialization failed."));if(r.ok)await load()}
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
      setLicenseKey("");
      setLifecyclePlan(null);
      setCurrentStep(1);
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
  async function registerLicense(){if(!install)return;const key=licenseKey.trim().toUpperCase();if(!/^LIC-[A-Z0-9]{10}-[A-Z0-9]{10}-[A-Z0-9]{10}$/.test(key))return setMsg("Enter a valid OrbitFS licence key in the format LIC-XXXXXXXXXX-XXXXXXXXXX-XXXXXXXXXX.");setBusy("license");try{const r=await fetch(`/api/orbitfs/installations/${install.id}/deploy`,{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({action:"register_license",licenseKey:key})}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(apiError(j,"Licence registration failed."));setLicenseKey("");setMsg(j.forceReinstallCompleted?`New licence key registered. Published Base ${j.installation?.release_version||pendingBaseForceReinstall?.targetVersion||""} was reinstalled and deployed.`:"Licence registered to this OrbitFS installation.");pollCount.current=0;await load()}catch(e:any){setMsg(e?.message||"Licence registration failed.");await load(true)}finally{setBusy("")}}
  async function deploy(action:"deploy"|"base_update"|"update"|"rollback"|"redeploy",version?:string,releaseId?:string){
    if(!install)return;
    if(activeOperation){setMsg(label(activeOperation.action)+" is already "+label(activeOperation.state)+". Deployment status below will update automatically.");return}
    let reason="";
    if(action==="rollback"){version=undefined;reason=prompt("Why are you rolling this Base deployment back?","")?.trim()||"";if(!reason)return}
    const actionLabel=action==="base_update"?"Update Base":action==="redeploy"?"Redeploy published Base":action==="update"?"Install normal update":action==="rollback"?"Rollback Base":"Install Base";
    if(!confirm(actionLabel+(version?" to "+version:"")+"?"))return;
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
    if(!confirm("Force reinstall OrbitFS Base? This deletes ONLY the current Base Vercel project, releases/unlocks its licence activation, preserves Supabase/database/storage/installation ID and the Shared Engine Host, then PAUSES. You must rotate the licence key and enter the new key before the published Base can be deployed again."))return;
    setBusy("force-base-reinstall");
    try{
      const r=await fetch(`/api/orbitfs/installations/${install.id}/force-reinstall-base`,{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:"{}"});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(apiError(j,"Force Base reinstall failed."));
      const version=String(j?.targetRelease?.version||"published");
      setViewedPrimaryStage(2);
      setCurrentStep(4);
      setMsg(j.message||("Base "+version+" was removed and the licence was released. Rotate your licence key, then enter the new key here to continue the reinstall."));
      pollCount.current=0;
      await load();
    }catch(e:any){setMsg(e?.message||"Force Base reinstall failed.")}
    finally{setBusy("")}
  }
  async function rollbackUpdate(){if(!install||!appliedUpdateVersion)return;const reason=prompt(`Why are you rolling back Update ${appliedUpdateVersion}?`,"")?.trim()||"";if(!reason)return;if(!confirm(`Roll back OrbitFS Update ${appliedUpdateVersion}? Inner Engine targets will restore their pre-update checkpoint first. Forward-compatible database migrations remain applied.`))return;setBusy("rollback-update");const r=await fetch(`/api/orbitfs/installations/${install.id}/rollback-update`,{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({reason})}),j=await r.json().catch(()=>({}));setBusy("");setMsg(r.ok?`OrbitFS Update ${appliedUpdateVersion} rolled back.`:apiError(j,"Update rollback failed."));if(r.ok){pollCount.current=0;await load()}}

  async function sync(auto=false){if(!install)return;const r=await fetch(`/api/orbitfs/installations/${install.id}/status`,{headers:await authHeaders(),cache:"no-store"}),j=await r.json().catch(()=>({}));if(!r.ok){if(!auto)setMsg(apiError(j,"Could not refresh Panel status."));return}const updated=j.installation;if(updated)setD((current:any)=>current?({...current,installations:(current.installations||[]).map((x:any)=>x.id===updated.id?updated:x)}):current);if(updated&&!workingStates.has(String(updated.state)))await load()}
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
      detail:deploymentReady?`Base ${install?.release_version||"deployed"}`:!vercelApiReady?"Connect Vercel":!licenseRegistered?"Register Base licence":reviewReady?"Configure / install Base":"Complete Base configuration",
      substeps:[
        {id:"2a",title:"Connect Vercel",ready:vercelApiReady},
        {id:"2b",title:"Manual environment variables (none required)",ready:vercelApiReady},
        {id:"2c",title:"Register Base licence",ready:licenseRegistered},
        {id:"2d",title:"Configure / install Base",ready:deploymentReady}
      ]
    },
    {
      n:3,title:"Validation",ready:validationReady,
      detail:validationReady?"Deployment validated":deploymentReady?(install?.health_status==="degraded"?"Health check degraded":"Validate deployment"):"Waiting for Base install",
      substeps:[
        {id:"3a",title:"Validate runtime health",ready:String(install?.health_status||"")==="healthy"},
        {id:"3b",title:"Validate database & storage",ready:databaseReady},
        {id:"3c",title:"Validate licence registration",ready:licenseRegistered},
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
    setViewedPrimaryStage(stage);
    if(stage===1){setCurrentStep(!supabaseConnectionReady?1:2);return}
    if(stage===2){setCurrentStep(!vercelApiReady?3:4);return}
    setCurrentStep(6);
  }

  function navigateSubstep(id:string){
    const stage=Number(id.split("")[0]||1);
    setViewedPrimaryStage(stage);
    if(id==="1a"){setCurrentStep(1);return}
    if(id==="1b"){setCurrentStep(2);return}
    if(id==="2a"){setCurrentStep(3);return}
    if(stage===2){setCurrentStep(4);return}
    setCurrentStep(6);
  }


  const deploymentNeedsAttention=String(activeOperation?.state||latestOperation?.state||install?.state||"").toLowerCase()==="failed";
  const websiteState=panelReady?"orbitSiteControl":deploymentNeedsAttention?"orbitSiteAttention":activeOperation?"orbitSiteProgress":currentStep===4?"orbitSiteReview":"orbitSiteDeployer";

  return <main className={"portalOverviewV2 orbitfsBaseV3 orbitZipDeployer "+websiteState+" "+(panelReady?"orbitZipDeployed":"orbitZipInstalling")}>
    {panelReady&&<header className="portalOverviewHero"><div><p className="eyebrow">INSTANCE CONTROL PANEL</p><h1>Base System Instance</h1><p className="muted">Runtime status, published Base controls, infrastructure health and recent deployment activity.</p></div></header>}
    {deploymentUnavailable&&<section className="panel orbitAuthorityNotice" style={{marginBottom:14,borderColor:"rgba(245,158,11,.55)"}}><div className="panelTitle"><div><p className="eyebrow">{settings.maintenance_mode?"MAINTENANCE":"LICENSE MANAGER CONTROL"}</p><h2>{settings.maintenance_mode?"OrbitFS deployment maintenance is active":"Base deployment is currently restricted"}</h2><p className="muted">{authorityNotice}</p></div><span className="state waiting">{settings.maintenance_mode?"MAINTENANCE":"BLOCKED"}</span></div></section>}
    {msg&&<p className="inlineStatus orbitInstallerMessage" role="status">{msg}</p>}
    {pendingBaseForceReinstall&&<section className="panel orbitAuthorityNotice" style={{marginBottom:14,borderColor:"rgba(245,158,11,.65)"}}>
      <div className="panelTitle"><div><p className="eyebrow">BASE FORCE REINSTALL</p><h2>{baseReinstallNeedsRotation?"Rotate your licence key":baseReinstallWaitingNewKey?"Enter the new licence key":baseReinstallDeploymentFailed?"Base reinstall needs another deployment attempt":"Base reinstall in progress"}</h2><p className="muted">Target: published Base {pendingBaseForceReinstall.targetVersion||"current"} · {pendingBaseForceReinstall.channel||selectedChannel}. {String(pendingBaseForceReinstall.status||"")==="start_failed"?("Recovery started but Base removal hit an error: "+(pendingBaseForceReinstall.lastError||"retry the recovery after rotating the licence.")):"The previous Base project has been removed; Supabase, customer data, storage, installation ID and Shared Engine Host are preserved."}</p></div><span className="state waiting">{baseReinstallNeedsRotation?"ROTATION REQUIRED":baseReinstallWaitingNewKey?"NEW KEY REQUIRED":baseReinstallDeploymentFailed?"RETRY REQUIRED":"PENDING"}</span></div>
      {baseReinstallNeedsRotation?<div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}><Link className="buttonlink" href="/portal/orbitfs/license">Rotate licence key →</Link><button className="secondary" onClick={()=>{setViewedPrimaryStage(2);setCurrentStep(4)}}>Already rotated? Enter new key</button><span className="muted">The old activation has already been released. License Manager will reject the old key until a rotation has actually occurred.</span></div>:baseReinstallWaitingNewKey?<div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}><button onClick={()=>{setViewedPrimaryStage(2);setCurrentStep(4)}}>Enter new key below</button><span className="muted">Registering the rotated key will automatically deploy the pending published Base release.</span></div>:baseReinstallDeploymentFailed&&licenseRegistered?<div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}><button disabled={busy!==""} onClick={()=>void deploy("deploy")}>{busy==="deploy"?"Retrying…":"Retry Base reinstall"}</button><span className="muted">{pendingBaseForceReinstall.lastError||"The new key is registered; retry the Base deployment."}</span></div>:null}
    </section>}

    {install&&(activeOperation||latestOperation)&&<section className="panel" style={{marginBottom:14}}>
      <div className="panelTitle"><div><p className="eyebrow">DEPLOYMENT STATUS</p><h2>{activeOperation?label(activeOperation.action)+" · "+label(activeOperation.state):latestOperation?.state==="failed"?"Last deployment attempt failed":"Recent deployment activity"}</h2><p className="muted">{activeOperation?"Live Base operation. This page refreshes every 5 seconds until it finishes.":"Latest Base deployment operation recorded by Billing Store."}</p></div><span className={"state "+(activeOperation?"current":latestOperation?.state==="completed"?"ready":"waiting")}>{String(activeOperation?.state||latestOperation?.state||"status").replaceAll("_"," ").toUpperCase()}</span></div>
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
          <div className="orbitZipControlTopActions"><span className="state ready">ONLINE</span>{install.production_url&&<a className="buttonlink secondary" href={install.production_url} target="_blank" rel="noreferrer">Open Panel</a>}</div>
        </div>

        <div className="orbitZipReleaseWorkspace">
          <div className="orbitZipReleaseControls">
            <label><span>Release channel</span><select value={selectedChannel} disabled={busy!==""||deploymentUnavailable||!infrastructureReady||!licenseRegistered} onChange={e=>void saveReleaseChannel(e.target.value)}>{availableBaseChannels.map((channel:string)=><option key={channel} value={channel}>{channel}</option>)}</select></label>
            <label><span>Available Base release</span><select value={selectedBaseUpdateRelease?.id||""} disabled={busy!==""||!baseUpdateCandidates.length} onChange={e=>setSelectedReleaseId(e.target.value)}><option value="">{baseUpdateCandidates.length?"Choose a newer release":"No newer Base release"}</option>{baseUpdateCandidates.map((r:any)=><option key={r.id} value={r.id}>v{r.version} · {r.title||"OrbitFS Base"}</option>)}</select></label>
            <button className="secondary orbitZipRefreshButton" disabled={busy!==""} onClick={()=>void refreshReleases()}>{busy==="refresh-releases"?"Refreshing…":"Refresh releases"}</button>
          </div>
          <div className="orbitZipReleaseMeta"><span>{baseUpdateCandidates.length?baseUpdateCandidates.length+" newer Base release"+(baseUpdateCandidates.length===1?"":"s")+" in "+selectedChannel:"No newer Base release in "+selectedChannel}</span><span>{d?.lastCheckedAt?"Checked "+new Date(d.lastCheckedAt).toLocaleString():"Release status not checked yet"}</span></div>
        </div>

        <div className="portalOverviewStats orbitZipOverviewStats">
          <div className="portalStatCard"><span className="portalStatIcon">B</span><div><small>BASE</small><strong>{install.release_version}</strong><span>{selectedChannel} channel</span></div></div>
          <div className="portalStatCard"><span className="portalStatIcon">D</span><div><small>DATABASE</small><strong>{install.schema_version||"ready"}</strong><span>{install.supabase_project_name||install.supabase_project_ref||"Supabase connected"}</span></div></div>
          <div className="portalStatCard"><span className="portalStatIcon">V</span><div><small>VERCEL</small><strong>{install.vercel_project_name||"Connected"}</strong><span>{install.vercel_team_id||"Personal/default"}</span></div></div>
          <div className="portalStatCard"><span className="portalStatIcon">U</span><div><small>NEXT UPDATE</small><strong>{selectedBaseUpdateAvailable?"Base "+selectedBaseUpdateRelease.version:updateAvailable?"Update "+latestUpdate:"Current"}</strong><span>{selectedBaseUpdateAvailable?"Published in "+selectedChannel:updateAvailable?"Approved Engine/add-on update":"No approved update waiting"}</span></div></div>
        </div>

        <div className="orbitPrimaryActionBar">
          <div className="orbitPrimaryActionCopy"><small>NEXT ACTION</small><b>{selectedBaseUpdateAvailable&&settings.customer_base_updates_enabled?"Update Base "+install.release_version+" → "+selectedBaseUpdateRelease.version:updateAvailable&&settings.customer_updates_enabled?"Install Update "+latestUpdate:"OrbitFS Base is current"}</b><span>{selectedBaseUpdateAvailable&&settings.customer_base_updates_enabled?"The selected published Base release will update this existing Vercel project after its database migration chain is verified.":updateAvailable&&settings.customer_updates_enabled?"An approved Engine/add-on update is available for this channel.":"Refresh releases at any time to check License Manager for newly published versions."}</span></div>
          <div className="orbitPrimaryActionControls">
            {selectedBaseUpdateAvailable&&settings.customer_base_updates_enabled?<button className="orbitHeroAction" disabled={busy!==""||deploymentUnavailable||!infrastructureReady||!licenseRegistered} onClick={()=>void deploy("base_update",String(selectedBaseUpdateRelease.version),String(selectedBaseUpdateRelease.id))}>{busy==="base_update"?"Updating Base…":"Update Base to "+selectedBaseUpdateRelease.version}</button>:updateAvailable&&settings.customer_updates_enabled?<button className="orbitHeroAction" disabled={busy!==""||deploymentUnavailable||!infrastructureReady||!licenseRegistered} onClick={()=>void deploy("update",String(d?.latestUpdate?.version||""),String(d?.latestUpdate?.id||d?.latestUpdate?.releaseId||""))}>{busy==="update"?"Installing…":"Install Update "+latestUpdate}</button>:<button className="orbitHeroAction" disabled={busy!==""} onClick={()=>void refreshReleases()}>{busy==="refresh-releases"?"Refreshing…":"Check for updates"}</button>}
            <details className="orbitActionMenu"><summary>More</summary><div>{install.production_url&&<a className="buttonlink secondary" href={install.production_url} target="_blank" rel="noreferrer">Open Panel</a>}<button className="secondary" disabled={busy!==""||deploymentUnavailable||!infrastructureReady||!licenseRegistered||!settings.customer_deploy_enabled} onClick={()=>void deploy("redeploy")}>Redeploy Base {install.release_version}</button><button className="secondary" disabled={busy!==""} onClick={()=>void sync(false)}>Refresh runtime status</button></div></details>
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
                <div><span>Licence</span><b>{licenseRegistration?.keyHint||"Registered"}</b></div>
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
              <div><div><b>Force reinstall published Base</b><span>Delete only the current Base project, release the licence activation, then require a rotated key before the published Base is deployed again.</span></div><button className="orbitZipDangerButton" disabled={busy!==""||deploymentUnavailable||!infrastructureReady||!licenseRegistered||!!pendingBaseForceReinstall} onClick={()=>void forceReinstallBase()}>{busy==="force-base-reinstall"?"Removing Base…":"Force reinstall Base"}</button></div>
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

      <section className="panel orbitInstallerHeader orbitZipSidebar" style={{display:panelReady?"none":undefined}}>
        <div className="orbitInstallerHeading">
          <div><p className="eyebrow">ORBITFS INSTALLER</p><h2>{binding.label||"OrbitFS Base"}</h2><p className="muted">Set up the customer-owned database and hosting, review the runtime configuration, then deploy.</p></div>
          <div className="orbitInstallerMeta"><span className="state ready">ENTITLEMENT ATTACHED</span><small>The Base licence is registered once during installation and then belongs to this installation ID.</small></div>
        </div>
        <nav className="orbitInstallerSteps orbitPrimaryStages" aria-label="OrbitFS setup stages">
          {primaryFlow.map(stage=><button type="button" key={stage.n} onClick={()=>navigatePrimaryStage(stage.n)} className={"orbitInstallerStep orbitPrimaryStage "+(stage.ready?"done ":"")+(activePrimaryNumber===stage.n?"active ":"")} aria-current={activePrimaryNumber===stage.n?"step":undefined} aria-label={`Open stage ${stage.n}: ${stage.title}`}><span>{stage.ready?"✓":stage.n}</span><div><b>{stage.title}</b><small>{stage.detail}</small></div></button>)}
        </nav>
        <div className="orbitInstallerSubsteps" aria-label={`Stage ${activePrimaryNumber} substeps`}>
          <div className="orbitInstallerSubstepHead"><small>STAGE {activePrimaryNumber}</small><b>{activePrimary.title}</b><span>Only this stage's substeps are shown.</span></div>
          <div className="orbitInstallerSubstepList">
            {activePrimary.substeps.map(step=><button type="button" key={step.id} onClick={()=>navigateSubstep(step.id)} className={"orbitInstallerSubstep "+(step.ready?"done ":"")+(activePrimarySubstep===step.id?"active ":"")} aria-label={`Open ${step.id}: ${step.title}`}><span>{step.ready?"✓":step.id}</span><div><b>{step.title}</b><small>{step.ready?"Complete":activePrimarySubstep===step.id?"Current":"Waiting"}</small></div></button>)}
          </div>
        </div>
      </section>

      {!install?<div className="portalOverviewGrid orbitZipWorkspace orbitZipWorkspaceStart" style={{display:panelReady?"none":undefined}}>
        <div className="orbitZipCanvasColumn">
          <section className="panel orbitZipStartCard">
            <div className="panelTitle"><div><p className="eyebrow">READY TO BEGIN</p><h2>Create your OrbitFS Base installation</h2><p className="muted">This creates the installation identity used by Billing Store and License Manager. Nothing is deployed until the infrastructure stages are complete.</p></div><span className="state waiting">NOT STARTED</span></div>
            <div className="orbitZipStartGrid">
              <div><span>01</span><div><b>Connect customer infrastructure</b><small>Supabase and Vercel remain customer-owned.</small></div></div>
              <div><span>02</span><div><b>Register the Base installation</b><small>License Manager remains the authority for licence and deployment access.</small></div></div>
              <div><span>03</span><div><b>Deploy and validate Base</b><small>The installer disappears only after the runtime validates successfully.</small></div></div>
            </div>
            <div className="orbitInstallerFooter"><span className="muted">Installer state is saved as each stage completes.</span><button className="orbitHeroAction" disabled={providerSetupUnavailable||busy==="start"} onClick={()=>void start()}>{busy==="start"?"Starting…":"Start OrbitFS setup"}</button></div>
          </section>
        </div>
        <aside className="orbitZipSummary">
          <section className="panel portalQuickActions"><div><p className="eyebrow">DEPLOYMENT SUMMARY</p><h2>Waiting to start</h2></div><div className="listrow"><div><b>Supabase</b><span>Customer database</span></div><span>Waiting</span></div><div className="listrow"><div><b>Vercel</b><span>Customer hosting</span></div><span>Waiting</span></div><div className="listrow"><div><b>Licence</b><span>License Manager registration</span></div><span>Waiting</span></div></section>
          <section className="panel"><div className="panelTitle"><div><p className="eyebrow">INSTALL TARGET</p><h2>OrbitFS Base</h2></div></div><div className="listrow"><div><b>Release channel</b><span>{selectedChannel}</span></div><span>SELECTED</span></div><div className="listrow"><div><b>Authority</b><span>License Manager</span></div><span>EXTERNAL</span></div></section>
        </aside>
      </div>:<div className="portalOverviewGrid orbitZipWorkspace" style={{display:panelReady?"none":undefined}}>
        <div className="orbitZipCanvasColumn">
          <details hidden={currentStep!==1} className="panel orbitInstallerWorkspace" open><summary className="panelTitle" style={summaryStyle}><div><p className="eyebrow">STEP 1A · SUPABASE CONNECTION</p><h2>Connect Supabase</h2><p className="muted">Connect the customer Supabase account. Project selection and database initialization live on the next page.</p></div><span className={`state ${supabaseConnectionReady?"ready":"waiting"}`}>{supabaseConnectionReady?"CONNECTED":"CONNECT"}</span></summary>{!supabaseConnectionReady?<button disabled={providerSetupUnavailable||!settings.supabase_oauth_enabled||busy==="supabase"} onClick={()=>void connectSupabase()}>{busy==="supabase"?"Connecting…":"Connect my Supabase"}</button>:<><div className="listrow"><div><b>{supabase.provider_account_name||"Customer Supabase account"}</b><span>OAuth connection is saved and verified by the Billing Store.</span></div><span className="state ready">CONNECTED</span></div>{install.supabase_project_ref&&<p className="muted" style={{marginTop:10}}>A project selection is already recorded: <b>{install.supabase_project_name||install.supabase_project_ref}</b>. You can review or change it on Configure / Initialize Database.</p>}<div className="controllerActions" style={{marginTop:10}}><button onClick={()=>{setViewedPrimaryStage(1);setCurrentStep(2)}}>Configure / initialize database</button><button className="secondary" disabled={busy!==""} onClick={()=>void resetSupabase()}>Reset / reconnect Supabase</button></div></>}</details>

          <details hidden={currentStep!==2} className="panel orbitInstallerWorkspace" open><summary className="panelTitle" style={summaryStyle}><div><p className="eyebrow">STEP 1B · SUPABASE CONFIGURATION</p><h2>Configure / initialize database</h2><p className="muted">Choose the customer project, select the published Base release, then initialize and verify the OrbitFS database.</p></div><span className={`state ${databaseReady?"ready":supabaseConnectionReady?"current":"waiting"}`}>{databaseReady?`SCHEMA ${install.schema_version}`:supabaseReady?"INITIALIZE":"CHOOSE PROJECT"}</span></summary>{!supabaseConnectionReady?<div className="form"><p className="muted">Reconnect Supabase before configuring the customer database.</p><button onClick={()=>{setViewedPrimaryStage(1);setCurrentStep(1)}}>Open Supabase connection</button></div>:<>{!databaseReady&&<><div className="listrow"><div><b>{supabaseReady?(install.supabase_project_name||install.supabase_project_ref):"No project selected"}</b><span>{supabaseReady?`${install.supabase_region||"Supabase"} · ${install.supabase_project_ref}`:"Choose an existing project or create a dedicated OrbitFS project."}</span></div><span className={`state ${supabaseReady?"ready":"waiting"}`}>{supabaseReady?"SELECTED":"REQUIRED"}</span></div><button className="secondary" style={{marginTop:10}} onClick={()=>void loadSupabase()} disabled={busy==="resources"}>{busy==="resources"?"Loading…":resources?"Refresh projects":supabaseReady?"Review / change project":"Choose project"}</button>{resources&&<div className="form" style={{marginTop:12}}>{settings.allow_create_supabase_project&&<><h3>Create a dedicated OrbitFS project</h3><label>Organization<select value={newProject.organizationSlug} onChange={e=>setNewProject({...newProject,organizationSlug:e.target.value})}><option value="">Choose organization</option>{(resources.organizations||[]).map((o:any)=><option key={o.slug||o.id} value={o.slug||o.id}>{o.name}</option>)}</select></label><label>Project name<input value={newProject.name} onChange={e=>setNewProject({...newProject,name:e.target.value})} placeholder="OrbitFS"/></label><label>Region<input value={newProject.region} onChange={e=>setNewProject({...newProject,region:e.target.value})}/></label><button disabled={!newProject.organizationSlug||busy==="create"} onClick={()=>void supabaseAction("create")}>{busy==="create"?"Creating…":"Create in my Supabase"}</button></>}{settings.allow_existing_supabase_project&&<><h3>Use an existing project</h3><label>Project<select value={selectedProject} onChange={e=>setSelectedProject(e.target.value)}><option value="">Choose project</option>{(resources.projects||[]).map((p:any)=><option key={p.id||p.ref} value={p.id||p.ref}>{p.name} · {p.region||"region"}</option>)}</select></label><button disabled={!selectedProject||busy==="select"} onClick={()=>void supabaseAction("select")}>Use selected project</button></>}</div>}</>}{supabaseReady&&(databaseReady?<><div className="listrow" style={{marginTop:10}}><div><b>Database initialized for OrbitFS {install.release_version}</b><span>Channel {install.release_channel||selectedChannel} · License Manager release {install.release_id} · schema {install.schema_version}</span></div><span className="state ready">READY</span></div>{selectedRelease&&<details className="panel" style={{marginTop:8}}><summary className="panelTitle" style={summaryStyle}><div><p className="eyebrow">CHANGELOG</p><h3 style={{margin:0}}>Base v{selectedRelease.version}</h3></div><span className="state ready">{selectedRelease.channel||selectedChannel}</span></summary><div style={{maxHeight:160,overflowY:"auto",paddingRight:6}}><p className="muted" style={{whiteSpace:"pre-wrap",margin:0,fontSize:13,lineHeight:1.45}}>{selectedRelease.changelog||selectedRelease.notes||"No customer changelog supplied."}</p></div></details>}<div className="controllerActions" style={{marginTop:10}}><button onClick={()=>{setViewedPrimaryStage(2);setCurrentStep(vercelApiReady?4:3)}}>{vercelApiReady?"Continue to Base configuration":"Continue to Vercel"}</button></div></>:<><div className="form" style={{marginTop:10}}><label>Base release channel<select value={selectedChannel} disabled={busy==="channel"||deploymentUnavailable} onChange={e=>{setSelectedReleaseId("");void saveReleaseChannel(e.target.value)}}>{(d?.settings?.release_channels||["stable"]).map((channel:string)=><option key={channel} value={channel}>{channel}</option>)}</select></label><p className="muted">Only published Base releases allowed by the licence channel are shown.</p><label>Base version<select value={selectedRelease?.id||""} onChange={e=>setSelectedReleaseId(e.target.value)}><option value="">Choose a published Base release</option>{publishedBaseReleases.map((r:any)=><option key={r.id} value={r.id}>{r.version} · {r.title||"OrbitFS Base"} · {r.published_at?new Date(r.published_at).toLocaleString():"published"}</option>)}</select></label></div>{selectedRelease?<><div className="panel" style={{marginTop:8,padding:12}}><div className="listrow"><div><b>Base v{selectedRelease.version}</b><span>{selectedRelease.title||"OrbitFS Base"} · {selectedRelease.channel||selectedChannel}</span></div><span className="state ready">PUBLISHED</span></div><details style={{marginTop:6}}><summary style={summaryStyle}>View changelog</summary><div style={{maxHeight:150,overflowY:"auto",marginTop:6,paddingRight:6}}><p className="muted" style={{whiteSpace:"pre-wrap",margin:0,fontSize:13,lineHeight:1.4}}>{selectedRelease.changelog||selectedRelease.notes||"No customer changelog supplied."}</p></div></details></div><button disabled={!supabaseReady||deploymentUnavailable||!settings.customer_deploy_enabled||busy==="init"} onClick={()=>void initialize()}>{busy==="init"?"Initializing…":`Initialize Base v${selectedRelease.version}`}</button></>:<div className="form"><p className="muted">No published Base release is available in the {selectedChannel} channel. Supabase stays connected; you can configure Vercel now and return here when a fresh Base release is published.</p><button className="secondary" onClick={()=>{setViewedPrimaryStage(2);setCurrentStep(vercelApiReady?4:3)}}>{vercelApiReady?"Open Vercel / Base configuration":"Continue to Vercel"}</button></div>}</>)}</>}</details>

          <details hidden={currentStep!==3} className="panel orbitInstallerWorkspace" open><summary className="panelTitle" style={summaryStyle}><div><p className="eyebrow">STEP 2A · VERCEL CONNECTION</p><h2>Connect Vercel</h2><p className="muted">Connect the customer Vercel account. OrbitFS will automate the project and runtime variables it can manage through the Vercel API.</p></div><span className={`state ${vercelApiReady?"ready":"waiting"}`}>{vercelApiReady?"CONNECTED":"CONNECT"}</span></summary>{vercelApiReady?<><div className="listrow"><div><b>{vercelConnection.provider_account_name||"Your Vercel account"}</b><span>Full API access validated. The token is stored encrypted and is never returned to this page.</span></div><span className="state ready">READY</span></div><div className="form" style={{marginTop:10}}><label>Deployment account/team<select value={vercelTeamId} onChange={e=>setVercelTeamId(e.target.value)}><option value="">Personal/default account</option>{vercelTeams.map((t:any)=><option key={t.id} value={t.id}>{t.name||t.slug||t.id}</option>)}</select></label><button className="secondary" disabled={busy==="vercel-team"} onClick={()=>void selectVercelTeam()}>{busy==="vercel-team"?"Saving…":"Use selected account"}</button><div className="listrow"><div><b>Manual environment variables</b><span>None are currently required. OrbitFS writes the required Supabase, release, installation and runtime variables automatically during Base installation.</span></div><span className="state ready">AUTOMATED</span></div><div className="controllerActions"><button onClick={()=>{setViewedPrimaryStage(2);setCurrentStep(4)}}>Configure / install Base</button><button className="secondary" disabled={busy!==""} onClick={()=>void resetVercel()}>Reset / reconnect Vercel</button></div></div></>:<div className="form"><p className="muted">Vercel connection is independent of database initialization, so you can connect hosting now even if a new Base release has not been published yet.</p><button disabled={providerSetupUnavailable||!settings.vercel_oauth_enabled||busy==="vercel-oauth"} onClick={()=>void connectVercelOAuth()}>{busy==="vercel-oauth"?"Connecting…":"Connect my Vercel"}</button><div className="orbitProviderDivider"><span>or use a Full Account Access token</span></div><a className="buttonlink secondary" href="https://vercel.com/account/tokens" target="_blank" rel="noreferrer">Open Vercel Tokens</a><label>Vercel token<input type="password" autoComplete="off" value={vercelToken} onChange={e=>setVercelToken(e.target.value)} placeholder="Paste token once"/></label><button className="secondary" disabled={providerSetupUnavailable||busy==="vercel"||!vercelToken.trim()} onClick={()=>void connectVercelToken()}>{busy==="vercel"?"Validating…":"Use Vercel access token"}</button></div>}</details>

          <section hidden={currentStep!==4} className="panel orbitReviewPanel">
            <div className="panelTitle"><div><p className="eyebrow">STEP 2B · VERCEL & BASE CONFIGURATION</p><h2>Configure / install Base</h2><p className="muted">Manual Vercel variables are only shown when they cannot be automated. The current Base deployer can create the project and write all required runtime variables automatically.</p></div><span className={`state ${licenseRegistered?"ready":"current"}`}>{licenseRegistered?"CONFIGURE":"LICENCE REQUIRED"}</span></div>
            <div className="listrow" style={{marginBottom:12}}><div><b>Manual Vercel environment variables</b><span>None required for the current deployer. Required runtime values are written automatically through the connected Vercel API.</span></div><span className="state ready">AUTOMATED</span></div>
            {licenseRegistered?<div className="orbitReviewCard"><small>BASE LICENCE</small><b>{licenseRegistration?.keyHint||"Registered"}</b><span>Installation {install.installation_id} · License Master {licenseRegistration?.masterLicenseId||"registered"}</span></div>:<div className="form"><label>OrbitFS Base licence key<input type="password" value={licenseKey} onChange={e=>setLicenseKey(e.target.value.toUpperCase())} autoComplete="off" spellCheck={false} placeholder="LIC-XXXXXXXXXX-XXXXXXXXXX-XXXXXXXXXX" maxLength={36}/></label><p className="muted">{pendingBaseForceReinstall?"Enter the NEW key returned after rotation. The old key is intentionally blocked for this recovery. After registration, Billing Store will automatically reinstall the pending published Base release.":"The key is sent directly for License Master registration and written into your own OrbitFS database. Billing Store does not retain the raw key."}</p><button disabled={busy!==""||authorityLocked||!licenseKey.trim()} onClick={()=>void registerLicense()}>{busy==="license"?(pendingBaseForceReinstall?"Registering & reinstalling…":"Registering…"):(pendingBaseForceReinstall?"Register new key & reinstall Base":"Register licence to this installation")}</button></div>}
          </section>
          <details hidden={currentStep!==6&&currentStep!==4} className="panel orbitInstallerWorkspace" open={reviewReady&&!panelReady}><summary className="panelTitle" style={summaryStyle}><div><p className="eyebrow">{activePrimaryNumber===3?"STEP 3 · VALIDATION":"STEP 2C · BASE INSTALL"}</p><h2>{activePrimaryNumber===3?"Validate OrbitFS":"Install Base"}</h2><p className="muted">{activePrimaryNumber===3?"Confirm runtime health, licence registration and release identity before handoff.":"Create/configure the customer Vercel project, apply automated runtime variables, and deploy the approved Base release."}</p></div><span className={`state ${panelReady?"ready":working?"current":"waiting"}`}>{panelReady?"READY":working?label(install.state).toUpperCase():"DEPLOY"}</span></summary>{!install.vercel_deployment_id?<><div className="listrow"><div><b>Published Base release</b><span>{selectedRelease?`${selectedRelease.version} · ${selectedRelease.channel||selectedChannel}`:"No published Base release available"}</span></div><span className={`state ${selectedRelease?"ready":"waiting"}`}>{selectedRelease?"READY":"WAITING"}</span></div><div className="form" style={{marginTop:10}}><div className="listrow"><div><b>Base release channel</b><span>{install.release_channel||selectedChannel}</span></div><span className="state ready">LOCKED TO DB</span></div><div className="listrow"><div><b>Base version</b><span>{selectedRelease?`v${selectedRelease.version} · ${selectedRelease.title||"OrbitFS Base"}`:"No published Base release available"}</span></div><span className={`state ${selectedRelease?"ready":"waiting"}`}>{selectedRelease?"SELECTED":"WAITING"}</span></div><p className="muted">The channel/version was chosen before database initialization so the schema and deployed Base package stay matched.</p></div>{selectedRelease&&<div className="panel" style={{marginTop:10}}><div className="listrow"><div><b>OrbitFS Base {selectedRelease.version}</b><span>{selectedRelease.changelog||selectedRelease.notes||"No customer changelog supplied."}</span></div><span className="state ready">PUBLISHED</span></div><div className="listrow"><div><b>Release identity</b><span>ID {selectedRelease.id} · source {selectedRelease.source_sha||selectedRelease.source_commit||selectedRelease.manifest?.sourceCommit||"recorded in release"}</span></div><span>{selectedRelease.artifact_sha256||selectedRelease.sha256?"CHECKSUM":"MASTER"}</span></div>{(selectedRelease.manifest?.minimumBaseVersion||selectedRelease.minimum_base_version||selectedRelease.minimum_version)&&<div className="listrow"><div><b>Compatibility</b><span>Minimum Base {selectedRelease.manifest?.minimumBaseVersion||selectedRelease.minimum_base_version||selectedRelease.minimum_version}</span></div><span>CHECKED</span></div>}<p className="muted">This is the exact published License Master release that will be handed to the deployer. The installation stores its release ID, version, checksum and source commit; the package itself remains in the release system.</p></div>}<button disabled={!infrastructureReady||!licenseRegistered||!selectedRelease||String(install.release_id||"")!==String(selectedRelease.id)||deploymentUnavailable||!settings.customer_deploy_enabled||busy==="deploy"} onClick={()=>void deploy("deploy",String(selectedRelease?.version||""),String(selectedRelease?.id||""))}>{busy==="deploy"?"Deploying…":"Deploy selected Base release"}</button></>:<><div className="listrow"><div><b>Panel {install.release_version}</b><span>{install.vercel_project_name||"Vercel project"}{install.production_url?` · ${install.production_url}`:""}</span></div><span className={`state ${panelReady?"ready":"waiting"}`}>{panelReady?"HEALTHY":"CHECKING"}</span></div><div className="orbitPrimaryActionBar compact"><div className="orbitPrimaryActionCopy"><small>{baseUpdateAvailable?"BASE UPDATE AVAILABLE":updateAvailable?"UPDATE AVAILABLE":"DEPLOYMENT READY"}</small><b>{baseUpdateAvailable?`Base ${install.release_version} → ${latestBase}`:updateAvailable?`OrbitFS Update ${latestUpdate}`:`Base ${install.release_version}`}</b><span>{baseUpdateAvailable?"Update the Base in this same Vercel project. Forward database migrations are applied first and the old deployment remains the recovery target.":updateAvailable?"Install the approved Engine/add-on update. Base stays on its current release.":"The deployed Base is healthy. Redeploy and rollback are maintenance actions under Advanced."}</span></div><div className="orbitPrimaryActionControls">{baseUpdateAvailable&&settings.customer_base_updates_enabled?<button className="orbitHeroAction" disabled={busy!==""||deploymentUnavailable||!infrastructureReady||!licenseRegistered||!latestBaseRelease?.id} onClick={()=>void deploy("base_update",String(latestBase||""),String(latestBaseRelease?.id||""))}>{busy==="base_update"?"Updating Base…":`Update Base to ${latestBase}`}</button>:updateAvailable&&settings.customer_updates_enabled?<button className="orbitHeroAction" disabled={busy!==""||deploymentUnavailable||!infrastructureReady||!licenseRegistered} onClick={()=>void deploy("update")}>{busy?"Working…":`Install Update ${latestUpdate}`}</button>:install.production_url?<a className="buttonlink orbitHeroAction" href={install.production_url} target="_blank" rel="noreferrer">Open Panel</a>:<button className="orbitHeroAction" disabled={busy!==""} onClick={()=>void sync(false)}>Refresh</button>}<details className="orbitActionMenu"><summary>Advanced</summary><div>{appliedUpdateVersion&&settings.customer_rollbacks_enabled&&<button className="secondary" disabled={busy!==""||deploymentUnavailable||!infrastructureReady||!licenseRegistered} onClick={()=>void rollbackUpdate()}>{busy==="rollback-update"?"Rolling back…":`Rollback update ${appliedUpdateVersion}`}</button>}<button className="secondary" disabled={busy!==""||deploymentUnavailable||!infrastructureReady||!licenseRegistered||!settings.customer_deploy_enabled} onClick={()=>void deploy(install.vercel_deployment_id?"redeploy":"deploy")}>{install.vercel_deployment_id?`Redeploy published Base ${latestBase||""}`:"Deploy Base"}</button>{settings.customer_rollbacks_enabled&&Boolean(previousBaseDeployment)&&<button className="secondary" disabled={busy!==""||deploymentUnavailable||!infrastructureReady||!licenseRegistered} onClick={()=>void deploy("rollback")}>Rollback Base code</button>}<button className="secondary" disabled={busy!==""} onClick={()=>void sync(false)}>Refresh status</button></div></details></div></div>{d.latestUpdate?.customerNotes&&updateAvailable&&<p className="inlineStatus"><b>Update notes:</b> {d.latestUpdate.customerNotes}</p>}</>}{working&&<p className="muted">Deployment status is checked at most once every 20 seconds while this operation is active. Polling stops automatically when it finishes.</p>}</details>

        </div>

        <aside className="orbitZipSummary"><section className="panel portalQuickActions"><div><p className="eyebrow">YOUR INFRASTRUCTURE</p><h2>Customer owned</h2></div><div className="listrow"><div><b>Supabase</b><span>{install.supabase_project_name||"Not selected"}</span></div><span>{supabaseReady?"Ready":"Waiting"}</span></div><div className="listrow"><div><b>Vercel</b><span>{install.vercel_project_name||vercelConnection?.provider_account_name||"Not connected"}</span></div><span>{vercelApiReady?"Ready":"Waiting"}</span></div><div className="orbitProviderQuickLinks"><button className="secondary" type="button" onClick={()=>{setViewedPrimaryStage(1);setCurrentStep(supabaseConnectionReady?2:1)}}>{supabaseConnectionReady?"Open Supabase":"Connect Supabase"}</button><button className="secondary" type="button" onClick={()=>{setViewedPrimaryStage(2);setCurrentStep(vercelApiReady?4:3)}}>{vercelApiReady?"Open Vercel / Base":"Connect Vercel"}</button></div>{install.production_url&&<a href={install.production_url} target="_blank" rel="noreferrer"><b>Open OrbitFS</b><span>Launch your deployed Panel</span></a>}</section><section className="panel"><div className="panelTitle"><div><p className="eyebrow">MANAGE</p><h2>Installation lifecycle</h2></div></div><p className="muted"><b>Undeploy</b> removes the running Vercel resources but preserves this installation ID, database, storage and licence binding for a clean redeploy.</p><div className="controllerActions">{install.vercel_project_id&&<button className="secondary" disabled={busy!==""} onClick={()=>void executeLifecycle("undeploy")}>{busy==="undeploy"?"Undeploying…":"Undeploy OrbitFS"}</button>}<button className="secondary" disabled={busy!==""||!!install.vercel_deployment_id||!!install.production_url} onClick={()=>void resetSetupToStage1()}>{busy==="reset-setup"?"Resetting…":"Reset setup to Stage 1"}</button></div>{(install.vercel_deployment_id||install.production_url)&&<p className="muted" style={{marginTop:8}}>Undeploy OrbitFS before resetting provider connections and installer state.</p>}<details style={{marginTop:12}}><summary style={summaryStyle}><b>Uninstall OrbitFS</b></summary><div className="form" style={{marginTop:12}}><p className="muted">The running Panel and Shared Engine Host are removed. Choose any additional cleanup explicitly; the customer Supabase project itself is never deleted.</p><label><span><input type="checkbox" checked={uninstallOptions.removeDatabase} onChange={e=>setUninstallOptions(v=>({...v,removeDatabase:e.target.checked}))}/> Remove OrbitFS database objects</span><small>Deletes OrbitFS-owned tables/functions from the selected customer database.</small></label><label><span><input type="checkbox" checked={uninstallOptions.removeStorage} onChange={e=>setUninstallOptions(v=>({...v,removeStorage:e.target.checked}))}/> Remove OrbitFS storage</span><small>Empties and deletes the <code>orbitfs-files</code> bucket.</small></label><label><span><input type="checkbox" checked={uninstallOptions.releaseLicense} onChange={e=>setUninstallOptions(v=>({...v,releaseLicense:e.target.checked}))}/> Release licence installation binding</span><small>Terminates this runtime activation so the licence may be registered to another installation.</small></label><button className="secondary" disabled={busy!==""} onClick={()=>void executeLifecycle("uninstall")}>{busy==="uninstall"?"Uninstalling…":"Review plan & uninstall"}</button>{lifecyclePlan?.plan&&<div className="inlineStatus"><b>Lifecycle plan:</b> {(lifecyclePlan.plan.steps||[]).map((step:any)=>step.label).join(" → ")}</div>}</div></details></section></aside>
      </div>}

      {install&&panelReady&&<div className="portalOverviewBottom"><details className="panel" open><summary className="panelTitle" style={summaryStyle}><div><p className="eyebrow">BASE RELEASES</p><h2>Current & previous</h2></div><span>{visibleBaseHistory.length}</span></summary>{visibleBaseHistory.length?visibleBaseHistory.map((r:any,index:number)=><div className="listrow" key={r.id}><div><b>{r.release_version} · {index===0?"Current":"Previous"}</b><span>{r.deployment_url||"deployment record"} · release {String(r.release_id||"").slice(0,8)}…</span></div><span className={"state "+(index===0?"ready":"waiting")}>{index===0?"CURRENT":"ROLLBACK"}</span></div>):<p className="muted">No successful Base deployments yet.</p>}{olderBaseHistory.length>0&&<details style={{marginTop:10}}><summary style={summaryStyle}>Older Base history · {olderBaseHistory.length}</summary><div style={{marginTop:8}}>{olderBaseHistory.map((r:any)=><div className="listrow" key={r.id}><div><b>{r.release_version}</b><span>{r.action} · retained for audit</span></div><span>{new Date(r.created_at).toLocaleString()}</span></div>)}</div></details>}</details><details className="panel"><summary className="panelTitle" style={summaryStyle}><div><p className="eyebrow">ACTIVITY</p><h2>Setup activity</h2></div><span>{events.length}</span></summary>{events.length?events.slice(0,20).map((e:any)=><div className="listrow" key={e.id}><div><b>{label(e.event_type)}</b><span>{e.message||e.status}</span></div><span>{new Date(e.created_at).toLocaleString()}</span></div>):<p className="muted">No setup activity yet.</p>}</details></div>}
    </>:<section className="panel"><div className="panelTitle"><div><p className="eyebrow">MY ORBITFS</p><h2>OrbitFS access pending</h2><p className="muted">Licensing and release access are provided by the Master service.</p></div></div></section>}

  </main>;
}
