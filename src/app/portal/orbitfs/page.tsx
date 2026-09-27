"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import {createClient} from "@/lib/supabase";
import {trackCustomerActivity} from "@/lib/customer-activity";

const hasBase=(b:any)=>b?.license_product_key==="orbitfs_base"||!!b?.components?.orbitfs_base||!!b?.components?.orbitfs_panel;
const label=(state:any)=>String(state||"waiting").replaceAll("_"," ");
const sectionGap={display:"grid",gap:12} as const;
const summaryStyle={cursor:"pointer"} as const;
const workingStates=new Set(["configuring","deploying","updating"]);

export default function MyOrbitFS(){
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
  async function load(){
    setLoading(true);
    try{
      const headers=await authHeaders();
      if(!headers.Authorization){setMsg("Your session has expired. Please sign in again.");return}
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
      try{
        const r=await fetch("/api/orbitfs/status",{headers,cache:"no-store",signal:controller.signal}),j=await r.json().catch(()=>({}));
        if(r.ok){setD(j);setMsg("")}else setMsg(j.error||"Could not load My OrbitFS.");
      }catch(e:any){setMsg(e?.name==="AbortError"?"My OrbitFS status request timed out. Please retry.":e?.message||"Could not load My OrbitFS.")}
      finally{clearTimeout(timer)}
    }finally{setLoading(false)}
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

  const bases=(d?.bindings||[]).filter(hasBase),binding=bases[0],install=(d?.installations||[]).find((x:any)=>x.license_binding_id===binding?.id),supabase=(d?.connections||[]).find((x:any)=>x.provider==="supabase"&&x.status==="connected"),vercelConnection=(d?.connections||[]).find((x:any)=>x.provider==="vercel"&&x.status==="connected"),vercelApiReady=vercelConnection?.metadata?.api_ready===true,vercelTeams=Array.isArray(vercelConnection?.metadata?.teams)?vercelConnection.metadata.teams:[],settings=d?.settings||{},history=(d?.releases||[]).filter((x:any)=>x.installation_id===install?.id),events=(d?.events||[]).filter((x:any)=>x.installation_id===install?.id);
  const supabaseReady=!!install?.supabase_project_ref,databaseReady=!!install?.database_initialized_at,deploymentReady=!!(install?.release_version&&install?.vercel_project_id&&install?.state==="ready"),licenseRegistration=install?.metadata?.licenseRegistration||null,licenseRegistered=licenseRegistration?.valid===true&&String(licenseRegistration?.installationId||"")===String(install?.installation_id||""),validationReady=deploymentReady&&licenseRegistered&&String(install?.health_status||"")==="healthy",panelReady=validationReady,working=!!install&&workingStates.has(String(install.state)),reviewReady=databaseReady&&vercelApiReady&&licenseRegistered;
  const deploymentUnavailable=!settings.enabled||settings.maintenance_mode===true||settings.license_authority_available===false||settings.release_authority_available===false||settings.deployment_authority_available===false;
  const availableBaseChannels=Array.isArray(d?.settings?.release_channels)&&d.settings.release_channels.length?d.settings.release_channels:["stable"];
  const selectedChannel=String(install?.release_channel||preferredBaseChannel||availableBaseChannels[0]||"stable");
  const publishedBaseReleases=(d?.publishedReleases||[]).filter((r:any)=>String(r.release_type||r.releaseType)==="base"&&String(r.channel||"stable")===selectedChannel&&String(r.status||"").toLowerCase()==="published").sort((a:any,b:any)=>String(b.published_at||b.publishedAt||"").localeCompare(String(a.published_at||a.publishedAt||""))||String(b.version).localeCompare(String(a.version),undefined,{numeric:true}));
  const selectedRelease=publishedBaseReleases.find((r:any)=>String(r.id)===selectedReleaseId)||publishedBaseReleases[0]||null;
  const selectedReleaseMatchesInstalled=!!(selectedRelease&&install?.release_id&&String(selectedRelease.id)===String(install.release_id));
  const latestBase=d?.latestBase?.version,latestUpdate=d?.latestUpdate?.version,appliedUpdate=install?.metadata?.appliedUpdate||null,appliedUpdateVersion=String(appliedUpdate?.version||""),updateAvailable=!!(install?.release_version&&latestUpdate&&appliedUpdateVersion!==String(latestUpdate)),components=binding?Object.entries(binding.components||{}).filter(([,v])=>v).map(([k])=>k):[];

  useEffect(()=>{if(!preferredBaseChannel&&availableBaseChannels.length)setPreferredBaseChannel(String(availableBaseChannels[0]))},[availableBaseChannels.join(","),preferredBaseChannel]);
  useEffect(()=>{if(selectedRelease?.id&&!selectedReleaseId)setSelectedReleaseId(String(selectedRelease.id))},[selectedRelease?.id,selectedReleaseId]);
  useEffect(()=>{if(vercelConnection?.team_id!==undefined&&vercelConnection?.team_id!==null&&!vercelTeamId)setVercelTeamId(String(vercelConnection.team_id))},[vercelConnection?.team_id]);
  useEffect(()=>{
    if(!install||!working){pollCount.current=0;return}
    if(pollCount.current>=18)return;
    const timer=setTimeout(()=>{pollCount.current+=1;void sync(true)},20000);
    return()=>clearTimeout(timer);
  },[install?.id,install?.state,install?.vercel_deployment_id]);
  useEffect(()=>{
    if(!install){setCurrentStep(1);setViewedPrimaryStage(null);return}
    if(panelReady)return;
    if(!supabaseReady)return setCurrentStep(1);
    if(!databaseReady)return setCurrentStep(2);
    if(!vercelApiReady)return setCurrentStep(3);
    if(!licenseRegistered)return setCurrentStep(4);
    if(reviewReady)return setCurrentStep(6);
  },[install?.id,supabaseReady,databaseReady,vercelApiReady,panelReady,reviewReady]);

  async function start(){if(!binding)return;if(deploymentUnavailable||!settings.customer_deploy_enabled)return setMsg(settings.maintenance_mode?(settings.maintenance_message||"OrbitFS deployment maintenance is active."):(settings.license_authority_notice||"OrbitFS deployment authority is unavailable."));setBusy("start");try{const r=await fetch("/api/orbitfs/installations/start",{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({bindingId:binding.id})}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Could not start OrbitFS setup.");const data=j.installation;setMsg("OrbitFS setup started.");await trackCustomerActivity("orbitfs.installation.create",{entityType:"license",entityId:binding.id,detail:{installation_id:data?.installation_id}});await load()}catch(e:any){setMsg(e?.message||"Could not start OrbitFS setup.")}finally{setBusy("")}}
  async function connectSupabase(){if(!install)return;setBusy("supabase");const r=await fetch("/api/orbitfs/oauth/supabase/start",{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({installationId:install.id})}),j=await r.json().catch(()=>({}));setBusy("");if(!r.ok)return setMsg(j.error||"Could not connect Supabase.");location.href=j.url}
  async function resetSupabase(){if(!confirm("Disconnect the current Supabase connector? This removes the saved OAuth tokens. Your Supabase project and its data are not deleted."))return;setBusy("supabase-reset");const r=await fetch("/api/orbitfs/providers/supabase",{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({action:"disconnect"})}),j=await r.json().catch(()=>({}));setBusy("");setResources(undefined);if(!r.ok)return setMsg(j.error||"Could not reset Supabase connection.");setMsg("Supabase connector reset. Connect your Supabase account again.");await load()}
  async function saveReleaseChannel(channel:string){setPreferredBaseChannel(channel);setSelectedReleaseId("");if(!install)return;setBusy("channel");const r=await fetch(`/api/orbitfs/installations/${install.id}/deploy`,{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({action:"set_channel",channel})}),j=await r.json().catch(()=>({}));setBusy("");if(!r.ok)return setMsg(j.error||"Could not save release channel.");setD((current:any)=>current?({...current,installations:(current.installations||[]).map((x:any)=>x.id===install.id?{...x,release_channel:channel}:x)}):current);setMsg(`Release channel set to ${channel}.`)}
  async function loadSupabase(){setBusy("resources");const r=await fetch("/api/orbitfs/providers/supabase",{headers:await authHeaders(),cache:"no-store"}),j=await r.json().catch(()=>({}));setBusy("");if(!r.ok)return setMsg(j.error||"Could not load your Supabase projects.");setResources(j);const first=j.organizations?.[0];if(!newProject.organizationSlug&&first)setNewProject(current=>({...current,organizationSlug:first.slug||first.id||""}))}
  async function supabaseAction(action:"select"|"create"){if(!install)return;setBusy(action);const body=action==="select"?{action,installationId:install.id,projectRef:selectedProject}:{action,installationId:install.id,...newProject},r=await fetch("/api/orbitfs/providers/supabase",{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify(body)}),j=await r.json().catch(()=>({}));setBusy("");setMsg(r.ok?`Your Supabase project was ${action==="select"?"selected":"created"}.`:j.error||"Supabase project action failed.");if(r.ok){setResources(undefined);await load()}}
  async function initialize(){if(!install||!selectedRelease)return;if(!selectedReleaseMatchesInstalled&&install.release_version&&install.release_id&&!confirm("This will initialize the selected published Base release, replacing the current installation release identity. Continue?"))return;setBusy("init");const r=await fetch(`/api/orbitfs/installations/${install.id}/initialize`,{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({releaseId:String(selectedRelease.id)})}),j=await r.json().catch(()=>({}));setBusy("");setMsg(r.ok?"OrbitFS database initialized in your Supabase project.":j.error||"Database initialization failed.");if(r.ok)await load()}
  async function connectVercelToken(){const token=vercelToken.trim();if(!token)return setMsg("Enter your Vercel Full Account Access token.");setBusy("vercel");const r=await fetch("/api/orbitfs/providers/vercel",{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({action:"connect",token})}),j=await r.json().catch(()=>({}));setBusy("");if(!r.ok)return setMsg(j.error||"Could not validate Vercel access.");setVercelToken("");setVercelTeamId(String(j.account?.teamId||""));setMsg("Vercel API access connected.");await load()}
  async function resetVercel(){if(!confirm("Reset the Vercel connector? This removes the saved Vercel token but does not delete your Vercel project. If OrbitFS is currently deployed, undeploy it first."))return;setBusy("vercel-reset");const r=await fetch("/api/orbitfs/providers/vercel",{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({action:"disconnect"})}),j=await r.json().catch(()=>({}));setBusy("");if(!r.ok)return setMsg(j.error||"Could not reset Vercel connection.");setVercelTeamId("");setVercelToken("");setMsg("Vercel connector reset. Connect it again when ready.");await load()}
  async function selectVercelTeam(){setBusy("vercel-team");const r=await fetch("/api/orbitfs/providers/vercel",{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({action:"select_team",teamId:vercelTeamId||null})}),j=await r.json().catch(()=>({}));setBusy("");setMsg(r.ok?"Vercel deployment account updated.":j.error||"Could not select that Vercel team.");if(r.ok)await load()}
  async function registerLicense(){if(!install)return;const key=licenseKey.trim().toUpperCase();if(!/^LIC-[A-Z0-9]{10}-[A-Z0-9]{10}-[A-Z0-9]{10}$/.test(key))return setMsg("Enter a valid OrbitFS licence key in the format LIC-XXXXXXXXXX-XXXXXXXXXX-XXXXXXXXXX.");setBusy("license");try{const r=await fetch(`/api/orbitfs/installations/${install.id}/deploy`,{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({action:"register_license",licenseKey:key})}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Licence registration failed.");setLicenseKey("");setMsg("Licence registered to this OrbitFS installation.");await load()}catch(e:any){setMsg(e?.message||"Licence registration failed.")}finally{setBusy("")}}
  async function deploy(action:"deploy"|"update"|"rollback"|"redeploy",version?:string,releaseId?:string){if(!install)return;let reason="";if(action==="rollback"){version=undefined;reason=prompt("Why are you rolling this Base deployment back?","")?.trim()||"";if(!reason)return}if(!confirm(`${action} OrbitFS${version?` to ${version}`:""}?`))return;setBusy(action);const r=await fetch(`/api/orbitfs/installations/${install.id}/deploy`,{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({action,version,releaseId,reason:reason||undefined,channel:String(install.release_channel||d?.settings?.release_channels?.[0]||"stable")})}),j=await r.json().catch(()=>({}));setBusy("");setMsg(r.ok?`OrbitFS ${action} started in your Vercel project.`:j.error||`${action} failed.`);if(r.ok){pollCount.current=0;await load()}}
  async function rollbackUpdate(){if(!install||!appliedUpdateVersion)return;const reason=prompt(`Why are you rolling back Update ${appliedUpdateVersion}?`,"")?.trim()||"";if(!reason)return;if(!confirm(`Roll back OrbitFS Update ${appliedUpdateVersion}? Inner Engine targets will restore their pre-update checkpoint first. Forward-compatible database migrations remain applied.`))return;setBusy("rollback-update");const r=await fetch(`/api/orbitfs/installations/${install.id}/rollback-update`,{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({reason})}),j=await r.json().catch(()=>({}));setBusy("");setMsg(r.ok?`OrbitFS Update ${appliedUpdateVersion} rolled back.`:j.error||"Update rollback failed.");if(r.ok){pollCount.current=0;await load()}}

  async function sync(auto=false){if(!install)return;const r=await fetch(`/api/orbitfs/installations/${install.id}/status`,{headers:await authHeaders(),cache:"no-store"}),j=await r.json().catch(()=>({}));if(!r.ok){if(!auto)setMsg(j.error||"Could not refresh Panel status.");return}const updated=j.installation;if(updated)setD((current:any)=>current?({...current,installations:(current.installations||[]).map((x:any)=>x.id===updated.id?updated:x)}):current);if(updated&&!workingStates.has(String(updated.state)))await load()}
  async function lifecyclePlanFor(action:"undeploy"|"uninstall"){if(!install)return;setBusy("lifecycle-plan");try{const options=action==="uninstall"?uninstallOptions:{removeDatabase:false,removeStorage:false,releaseLicense:false};const r=await fetch(`/api/orbitfs/installations/${install.id}/lifecycle`,{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({action:"plan",mode:action,...options})}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Could not create lifecycle plan.");setLifecyclePlan(j);return j}catch(e:any){setMsg(e?.message||"Could not create lifecycle plan.");return null}finally{setBusy("")}}
  async function executeLifecycle(action:"undeploy"|"uninstall"){if(!install)return;const planned=await lifecyclePlanFor(action);if(!planned)return;const destructive=action==="uninstall"&&[uninstallOptions.removeDatabase&&"OrbitFS database objects",uninstallOptions.removeStorage&&"OrbitFS storage bucket",uninstallOptions.releaseLicense&&"licence installation binding"].filter(Boolean);const summary=action==="undeploy"?"Undeploy OrbitFS? The Panel and Shared Engine Host will be removed. Your database, storage, licence binding and installation ID will be preserved.":`Uninstall OrbitFS? This removes the running Panel/Engine resources.${destructive&&destructive.length?` It will also permanently remove: ${destructive.join(", ")}.`:" Database, storage and licence binding will be preserved."} The Supabase project itself is never deleted.`;if(!confirm(summary))return;setBusy(action);try{const r=await fetch(`/api/orbitfs/installations/${install.id}/lifecycle`,{method:"POST",headers:{...(await authHeaders()),"content-type":"application/json"},body:JSON.stringify({action,jobId:planned?.job?.id,...(action==="uninstall"?uninstallOptions:{})})}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`${action} failed.`);setLifecyclePlan(j);await trackCustomerActivity(action==="undeploy"?"orbitfs.installation.undeploy":"orbitfs.installation.uninstall",{entityType:"license",entityId:binding?.id,detail:{installation_id:install.installation_id,job_id:j?.job?.id,options:action==="uninstall"?uninstallOptions:{}}});setMsg(action==="undeploy"?"OrbitFS undeployed. Database, storage, licence and installation ID were preserved.":"OrbitFS uninstall completed with the selected cleanup options.");await load()}catch(e:any){setMsg(e?.message||`${action} failed.`)}finally{setBusy("")}}

  if(loading)return <main className="portalOverviewV2 orbitfsBaseV3"><section className="panel"><b>{msg||"Loading My OrbitFS…"}</b>{msg&&<p className="muted">Loading the rest of your deployment state…</p>}</section></main>;
  if(!d)return <main className="portalOverviewV2 orbitfsBaseV3 orbitZipDeployer"><section className="panel"><h2>My OrbitFS could not load</h2><p className="muted">{msg||"The OrbitFS status service did not return data."}</p><button onClick={()=>void load()}>Retry</button></section></main>;

  const primaryFlow=[
    {
      n:1,title:"Supabase",ready:databaseReady,
      detail:databaseReady?`Schema ${install?.schema_version||"ready"}`:supabaseReady?"Configure database":supabase?"Choose project":"Connect Supabase",
      substeps:[
        {id:"1a",title:"Connect Supabase",ready:!!supabase},
        {id:"1b",title:"Configure Supabase",ready:supabaseReady},
        {id:"1c",title:"Apply Base schema",ready:databaseReady},
        {id:"1d",title:"Validate database & storage",ready:databaseReady}
      ]
    },
    {
      n:2,title:"Vercel",ready:vercelApiReady,
      detail:vercelApiReady?(vercelConnection?.provider_account_name||"Connected"):"Connect hosting",
      substeps:[
        {id:"2a",title:"Connect Vercel",ready:!!vercelConnection},
        {id:"2b",title:"Select account or team",ready:vercelApiReady},
        {id:"2c",title:"Validate deployment permissions",ready:vercelApiReady},
        {id:"2d",title:"Prepare Base project",ready:vercelApiReady}
      ]
    },
    {
      n:3,title:"Registration & licence",ready:reviewReady,
      detail:reviewReady?"Configuration ready":licenseRegistered?"Review configuration":"Register Base licence",
      substeps:[
        {id:"3a",title:"Create installation identity",ready:!!install?.installation_id},
        {id:"3b",title:"Register installation",ready:licenseRegistered},
        {id:"3c",title:"Validate Base entitlement",ready:licenseRegistered},
        {id:"3d",title:"Build runtime configuration",ready:reviewReady},
        {id:"3e",title:"Pre-install validation",ready:reviewReady}
      ]
    },
    {
      n:4,title:"Install",ready:deploymentReady,
      detail:deploymentReady?`Base ${install?.release_version||"deployed"}`:working?label(install?.state):"Ready to deploy",
      substeps:[
        {id:"4a",title:"Create Vercel project",ready:!!install?.vercel_project_id},
        {id:"4b",title:"Apply runtime environment",ready:!!install?.vercel_project_id},
        {id:"4c",title:"Deploy approved Base release",ready:deploymentReady},
        {id:"4d",title:"Wait for runtime readiness",ready:deploymentReady},
        {id:"4e",title:"Complete deployment",ready:deploymentReady}
      ]
    },
    {
      n:5,title:"Validation",ready:validationReady,
      detail:validationReady?"Deployment validated":deploymentReady?(install?.health_status==="degraded"?"Health check degraded":"Validate deployment"):"Waiting for install",
      substeps:[
        {id:"5a",title:"Validate runtime health",ready:String(install?.health_status||"")==="healthy"},
        {id:"5b",title:"Validate database & storage",ready:databaseReady},
        {id:"5c",title:"Validate licence registration",ready:licenseRegistered},
        {id:"5d",title:"Validate release identity",ready:!!(install?.release_id&&install?.release_sha256&&install?.release_source_commit)},
        {id:"5e",title:"Confirm deployment",ready:validationReady},
        {id:"5f",title:"Hand off to control panel",ready:panelReady}
      ]
    }
  ];
  const progressPrimaryNumber=primaryFlow.find(stage=>!stage.ready)?.n||5;
  const activePrimaryNumber=viewedPrimaryStage||progressPrimaryNumber;
  const activePrimary=primaryFlow.find(stage=>stage.n===activePrimaryNumber)||primaryFlow[4];
  const activePrimarySubstep=activePrimary.substeps.find(step=>!step.ready)?.id||activePrimary.substeps[activePrimary.substeps.length-1]?.id;

  function navigatePrimaryStage(stage:number){
    setViewedPrimaryStage(stage);
    if(stage===1){setCurrentStep(!supabaseReady?1:2);return}
    if(stage===2){setCurrentStep(3);return}
    if(stage===3){setCurrentStep(4);return}
    setCurrentStep(6);
  }

  function navigateSubstep(id:string){
    const stage=Number(id.split("")[0]||1);
    setViewedPrimaryStage(stage);
    if(id==="1a"||id==="1b"){setCurrentStep(1);return}
    if(id==="1c"||id==="1d"){setCurrentStep(2);return}
    if(stage===2){setCurrentStep(3);return}
    if(stage===3){setCurrentStep(4);return}
    setCurrentStep(6);
  }


  return <main className={"portalOverviewV2 orbitfsBaseV3 orbitZipDeployer "+(panelReady?"orbitZipDeployed":"orbitZipInstalling")}>
    {panelReady&&<header className="portalOverviewHero"><div><p className="eyebrow">MY ORBITFS</p><h1>OrbitFS Base</h1><p className="muted">Deployment control, infrastructure status and approved update management.</p></div></header>}
    {deploymentUnavailable&&<section className="panel" style={{marginBottom:14,borderColor:"rgba(245,158,11,.55)"}}><div className="panelTitle"><div><p className="eyebrow">{settings.maintenance_mode?"MAINTENANCE":"DEPLOYMENT ACCESS DISABLED"}</p><h2>{settings.maintenance_mode?"OrbitFS deployment maintenance is active":"Customer deployment is currently unavailable"}</h2><p className="muted">{settings.maintenance_mode?(settings.maintenance_message||"OrbitFS deployment services are temporarily unavailable while maintenance is in progress."):"An administrator has disabled the customer deployment system. Your existing installation and data are not removed."}</p></div><span className="state waiting">{settings.maintenance_mode?"MAINTENANCE":"OFFLINE"}</span></div></section>}



    {binding?<>
      {panelReady&&<section className="panel orbitZipControlPanel" style={{marginBottom:14}}><div className="panelTitle"><div><p className="eyebrow">ORBITFS CONTROL PANEL</p><h2>{install.vercel_project_name||"Your OrbitFS Panel"}</h2><p className="muted">Your installation is live. Manage the deployed Panel, release channel and updates from here.</p></div><span className="state ready">ONLINE</span></div><div className="portalOverviewStats" style={{marginTop:12}}><div className="portalStatCard"><span className="portalStatIcon">V</span><div><small>INSTALLED</small><strong>{install.release_version}</strong><span>{install.release_channel||"stable"} · License Master release {install.release_id||"recorded"}</span></div></div><div className="portalStatCard"><span className="portalStatIcon">S</span><div><small>SUPABASE</small><strong>{install.supabase_project_name||"Connected"}</strong><span>{install.supabase_project_ref} · schema {install.schema_version||"unknown"}</span></div></div><div className="portalStatCard"><span className="portalStatIcon">V</span><div><small>VERCEL</small><strong>{install.vercel_project_name||"Connected"}</strong><span>{install.vercel_team_id||"Personal account"} · deployment {install.vercel_deployment_id||"recorded"}</span></div></div><div className="portalStatCard"><span className="portalStatIcon">U</span><div><small>UPDATE</small><strong>{updateAvailable?"Update available":"Up to date"}</strong><span>{updateAvailable?`Approved ${latestUpdate} in ${install.release_channel||"stable"}`:appliedUpdateVersion?`Update ${appliedUpdateVersion} applied`:"No update applied yet"}</span></div></div></div><div className="panel" style={{marginTop:12}}><div className="listrow"><div><b>Installed release identity</b><span>License Master ID {install.release_id||"not recorded"} · source {install.release_source_commit||"not recorded"} · checksum {install.release_sha256||"not recorded"}</span></div><span className="state ready">RECORDED</span></div></div><div className="orbitPrimaryActionBar" style={{marginTop:14}}><div className="orbitPrimaryActionCopy"><small>NEXT ACTION</small><b>{updateAvailable&&settings.customer_updates_enabled?`Update to ${latestUpdate}`:"Your OrbitFS Panel is ready"}</b><span>{updateAvailable&&settings.customer_updates_enabled?"An approved update is available for your active channel.":"Open the live Panel, or use Manage for channel and maintenance controls."}</span></div><div className="orbitPrimaryActionControls">{updateAvailable&&settings.customer_updates_enabled?<button className="orbitHeroAction" disabled={busy!==""||deploymentUnavailable||!licenseRegistered} onClick={()=>void deploy("update",String(d?.latestUpdate?.version||""),String(d?.latestUpdate?.id||d?.latestUpdate?.releaseId||""))}>{busy?"Working…":`Install ${latestUpdate}`}</button>:install.production_url?<a className="buttonlink orbitHeroAction" href={install.production_url} target="_blank" rel="noreferrer">Open OrbitFS Panel</a>:<button className="orbitHeroAction" disabled={busy!==""} onClick={()=>void sync(false)}>Refresh status</button>}<details className="orbitActionMenu"><summary>Manage</summary><div><label><span>Release channel</span><select value={selectedChannel} disabled={busy!==""||deploymentUnavailable||!licenseRegistered} onChange={e=>void saveReleaseChannel(e.target.value)}>{(d?.settings?.release_channels||["stable"]).map((channel:string)=><option key={channel} value={channel}>{channel}</option>)}</select></label>{install.production_url&&<a className="buttonlink secondary" href={install.production_url} target="_blank" rel="noreferrer">Open Panel</a>}<button className="secondary" disabled={busy!==""||deploymentUnavailable||!licenseRegistered||!settings.customer_deploy_enabled} onClick={()=>void deploy("redeploy")}>Redeploy current version</button><button className="secondary" disabled={busy!==""} onClick={()=>void sync(false)}>Refresh status</button></div></details></div></div>
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
<div className="panel orbitZipLifecyclePanel">
  <div className="panelTitle"><div><p className="eyebrow">LIFECYCLE & RECOVERY</p><h2>Deployment controls</h2><p className="muted">Undeploy removes the running Vercel resources but preserves this installation ID, customer database, storage and licence binding for a clean redeploy.</p></div></div>
  <div className="orbitZipLifecycleRows">
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
            <div className="orbitInstallerFooter"><span className="muted">Installer state is saved as each stage completes.</span><button className="orbitHeroAction" disabled={deploymentUnavailable||!settings.customer_deploy_enabled||busy==="start"} onClick={()=>void start()}>{busy==="start"?"Starting…":"Start OrbitFS setup"}</button></div>
          </section>
        </div>
        <aside className="orbitZipSummary">
          <section className="panel portalQuickActions"><div><p className="eyebrow">DEPLOYMENT SUMMARY</p><h2>Waiting to start</h2></div><div className="listrow"><div><b>Supabase</b><span>Customer database</span></div><span>Waiting</span></div><div className="listrow"><div><b>Vercel</b><span>Customer hosting</span></div><span>Waiting</span></div><div className="listrow"><div><b>Licence</b><span>License Manager registration</span></div><span>Waiting</span></div></section>
          <section className="panel"><div className="panelTitle"><div><p className="eyebrow">INSTALL TARGET</p><h2>OrbitFS Base</h2></div></div><div className="listrow"><div><b>Release channel</b><span>{selectedChannel}</span></div><span>SELECTED</span></div><div className="listrow"><div><b>Authority</b><span>License Manager</span></div><span>EXTERNAL</span></div></section>
        </aside>
      </div>:<div className="portalOverviewGrid orbitZipWorkspace" style={{display:panelReady?"none":undefined}}>
        <div className="orbitZipCanvasColumn">
          <details hidden={currentStep!==1} className="panel orbitInstallerWorkspace" open={!supabaseReady}><summary className="panelTitle" style={summaryStyle}><div><p className="eyebrow">STEP 1 · SUPABASE</p><h2>Your Supabase</h2><p className="muted">Choose or create the project that owns your OrbitFS database.</p></div><span className={`state ${supabaseReady?"ready":supabase?"current":"waiting"}`}>{supabaseReady?"READY":supabase?"CONNECTED":"CONNECT"}</span></summary>{!supabase?<button disabled={deploymentUnavailable||!settings.customer_deploy_enabled||!settings.supabase_oauth_enabled||busy==="supabase"} onClick={()=>void connectSupabase()}>{busy==="supabase"?"Connecting…":"Connect my Supabase"}</button>:supabaseReady?<><div className="listrow"><div><b>{install.supabase_project_name||install.supabase_project_ref}</b><span>{install.supabase_region||"Supabase"} · {install.supabase_project_ref}</span></div><span className="state ready">YOUR PROJECT</span></div><div className="controllerActions" style={{marginTop:10}}><button className="secondary" disabled={busy!==""} onClick={()=>void resetSupabase()}>Reset / reconnect Supabase</button></div></>:<><p className="muted">OrbitFS can only manage resources your Supabase account grants to the OrbitFS OAuth App.</p><button className="secondary" onClick={()=>void loadSupabase()} disabled={busy==="resources"}>{busy==="resources"?"Loading…":resources?"Refresh projects":"Choose project"}</button>{resources&&<div className="form" style={{marginTop:12}}>{settings.allow_create_supabase_project&&<><h3>Create a dedicated OrbitFS project</h3><label>Organization<select value={newProject.organizationSlug} onChange={e=>setNewProject({...newProject,organizationSlug:e.target.value})}><option value="">Choose organization</option>{(resources.organizations||[]).map((o:any)=><option key={o.slug||o.id} value={o.slug||o.id}>{o.name}</option>)}</select></label><label>Project name<input value={newProject.name} onChange={e=>setNewProject({...newProject,name:e.target.value})} placeholder="OrbitFS"/></label><label>Region<input value={newProject.region} onChange={e=>setNewProject({...newProject,region:e.target.value})}/></label><button disabled={!newProject.organizationSlug||busy==="create"} onClick={()=>void supabaseAction("create")}>{busy==="create"?"Creating…":"Create in my Supabase"}</button></>}{settings.allow_existing_supabase_project&&<><h3>Use an existing project</h3><label>Project<select value={selectedProject} onChange={e=>setSelectedProject(e.target.value)}><option value="">Choose project</option>{(resources.projects||[]).map((p:any)=><option key={p.id||p.ref} value={p.id||p.ref}>{p.name} · {p.region||"region"}</option>)}</select></label><button disabled={!selectedProject||busy==="select"} onClick={()=>void supabaseAction("select")}>Use selected project</button></>}</div>}</>}</details>

          <details hidden={currentStep!==2} className="panel orbitInstallerWorkspace" open={supabaseReady&&!databaseReady}><summary className="panelTitle" style={summaryStyle}><div><p className="eyebrow">STEP 1 · SUPABASE CONFIGURATION</p><h2>Base release & database</h2><p className="muted">Choose the Base release channel and exact published Base version before initializing its database schema.</p></div><span className={`state ${databaseReady?"ready":supabaseReady?"current":"waiting"}`}>{databaseReady?`SCHEMA ${install.schema_version}`:"SELECT RELEASE"}</span></summary>{databaseReady?<><div className="listrow"><div><b>Database initialized for OrbitFS {install.release_version}</b><span>Channel {install.release_channel||selectedChannel} · License Master release {install.release_id} · schema {install.schema_version}</span></div><span className="state ready">READY</span></div>{selectedRelease&&<details className="panel" style={{marginTop:8}}><summary className="panelTitle" style={summaryStyle}><div><p className="eyebrow">CHANGELOG</p><h3 style={{margin:0}}>Base v{selectedRelease.version}</h3></div><span className="state ready">{selectedRelease.channel||selectedChannel}</span></summary><div style={{maxHeight:160,overflowY:"auto",paddingRight:6}}><p className="muted" style={{whiteSpace:"pre-wrap",margin:0,fontSize:13,lineHeight:1.45}}>{selectedRelease.changelog||selectedRelease.notes||"No customer changelog supplied."}</p></div></details>}</>:<><div className="form" style={{marginTop:10}}><label>Base release channel<select value={selectedChannel} disabled={busy==="channel"} onChange={e=>{setSelectedReleaseId("");void saveReleaseChannel(e.target.value)}}>{(d?.settings?.release_channels||["stable"]).map((channel:string)=><option key={channel} value={channel}>{channel}</option>)}</select></label><p className="muted">This controls where the Base deployer gets its published Base versions from. Only channels assigned to your licence are shown.</p><label>Base version<select value={selectedRelease?.id||""} onChange={e=>setSelectedReleaseId(e.target.value)}><option value="">Choose a published Base release</option>{publishedBaseReleases.map((r:any)=><option key={r.id} value={r.id}>{r.version} · {r.title||"OrbitFS Base"} · {r.published_at?new Date(r.published_at).toLocaleString():"published"}</option>)}</select></label></div>{selectedRelease?<><div className="panel" style={{marginTop:8,padding:12}}><div className="listrow"><div><b>Base v{selectedRelease.version}</b><span>{selectedRelease.title||"OrbitFS Base"} · {selectedRelease.channel||selectedChannel}</span></div><span className="state ready">PUBLISHED</span></div><details style={{marginTop:6}}><summary style={summaryStyle}>View changelog</summary><div style={{maxHeight:150,overflowY:"auto",marginTop:6,paddingRight:6}}><p className="muted" style={{whiteSpace:"pre-wrap",margin:0,fontSize:13,lineHeight:1.4}}>{selectedRelease.changelog||selectedRelease.notes||"No customer changelog supplied."}</p></div></details></div><button disabled={!supabaseReady||deploymentUnavailable||!settings.customer_deploy_enabled||busy==="init"} onClick={()=>void initialize()}>{busy==="init"?"Initializing…":`Initialize Base v${selectedRelease.version}`}</button></>:<p className="muted">No published Base release is available in the {selectedChannel} channel.</p>}</>}</details>

          <details hidden={currentStep!==3} className="panel orbitInstallerWorkspace" open={databaseReady&&!vercelApiReady}><summary className="panelTitle" style={summaryStyle}><div><p className="eyebrow">STEP 2 · VERCEL</p><h2>Your Vercel</h2><p className="muted">Give OrbitFS API access so it can create and maintain your Panel project.</p></div><span className={`state ${vercelApiReady?"ready":databaseReady?"current":"waiting"}`}>{vercelApiReady?"API READY":"CONNECT"}</span></summary>{vercelApiReady?<><div className="listrow"><div><b>{vercelConnection.provider_account_name||"Your Vercel account"}</b><span>Full API access validated. The token is stored encrypted and is never returned to this page.</span></div><span className="state ready">READY</span></div><div className="form" style={{marginTop:10}}><label>Deployment account/team<select value={vercelTeamId} onChange={e=>setVercelTeamId(e.target.value)}><option value="">Personal/default account</option>{vercelTeams.map((t:any)=><option key={t.id} value={t.id}>{t.name||t.slug||t.id}</option>)}</select></label><button className="secondary" disabled={busy==="vercel-team"} onClick={()=>void selectVercelTeam()}>{busy==="vercel-team"?"Saving…":"Use selected account"}</button><button className="secondary" disabled={busy!==""} onClick={()=>void resetVercel()}>Reset Vercel connector</button></div></>:<div className="form"><p className="muted">Create a <b>Full Account Access</b> token in Vercel Account Settings → Tokens and paste it once. This is used only to manage your OrbitFS Panel project.</p><a className="buttonlink secondary" href="https://vercel.com/account/tokens" target="_blank" rel="noreferrer">Open Vercel Tokens</a><label>Vercel token<input type="password" autoComplete="off" value={vercelToken} onChange={e=>setVercelToken(e.target.value)} placeholder="Paste token once"/></label><button disabled={!databaseReady||deploymentUnavailable||!settings.customer_deploy_enabled||!settings.vercel_oauth_enabled||busy==="vercel"||!vercelToken.trim()} onClick={()=>void connectVercelToken()}>{busy==="vercel"?"Validating…":"Save Vercel API access"}</button></div>}</details>

          <section hidden={currentStep!==4} className="panel orbitReviewPanel">
            <div className="panelTitle"><div><p className="eyebrow">STEP 3 · REGISTRATION & LICENCE</p><h2>Register Base licence</h2><p className="muted">This binds your Base licence to this exact OrbitFS installation ID before runtime and updater services start using it.</p></div><span className={`state ${licenseRegistered?"ready":"current"}`}>{licenseRegistered?"REGISTERED":"REQUIRED"}</span></div>
            {licenseRegistered?<div className="orbitReviewCard"><small>BASE LICENCE</small><b>{licenseRegistration?.keyHint||"Registered"}</b><span>Installation {install.installation_id} · License Master {licenseRegistration?.masterLicenseId||"registered"}</span></div>:<div className="form"><label>OrbitFS Base licence key<input type="password" value={licenseKey} onChange={e=>setLicenseKey(e.target.value.toUpperCase())} autoComplete="off" spellCheck={false} placeholder="LIC-XXXXXXXXXX-XXXXXXXXXX-XXXXXXXXXX" maxLength={36}/></label><p className="muted">The key is sent directly for License Master registration and written into your own OrbitFS database. Billing Store does not retain the raw key.</p><button disabled={busy!==""||!licenseKey.trim()} onClick={()=>void registerLicense()}>{busy==="license"?"Registering…":"Register licence to this installation"}</button></div>}
          </section>
          <details hidden={currentStep!==6} className="panel orbitInstallerWorkspace" open={reviewReady&&!panelReady}><summary className="panelTitle" style={summaryStyle}><div><p className="eyebrow">{activePrimaryNumber===5?"STEP 5 · VALIDATION":"STEP 4 · INSTALL"}</p><h2>{activePrimaryNumber===5?"Validate OrbitFS":"Deploy OrbitFS"}</h2><p className="muted">{activePrimaryNumber===5?"Confirm runtime health, licence registration and release identity before handoff.":"Deploy the private Base release into your Vercel account, then validate the installation."}</p></div><span className={`state ${panelReady?"ready":working?"current":"waiting"}`}>{panelReady?"READY":working?label(install.state).toUpperCase():"DEPLOY"}</span></summary>{!install.vercel_deployment_id?<><div className="listrow"><div><b>Published Base release</b><span>{selectedRelease?`${selectedRelease.version} · ${selectedRelease.channel||selectedChannel}`:"No published Base release available"}</span></div><span className={`state ${selectedRelease?"ready":"waiting"}`}>{selectedRelease?"READY":"WAITING"}</span></div><div className="form" style={{marginTop:10}}><div className="listrow"><div><b>Base release channel</b><span>{install.release_channel||selectedChannel}</span></div><span className="state ready">LOCKED TO DB</span></div><div className="listrow"><div><b>Base version</b><span>{selectedRelease?`v${selectedRelease.version} · ${selectedRelease.title||"OrbitFS Base"}`:"No published Base release available"}</span></div><span className={`state ${selectedRelease?"ready":"waiting"}`}>{selectedRelease?"SELECTED":"WAITING"}</span></div><p className="muted">The channel/version was chosen before database initialization so the schema and deployed Base package stay matched.</p></div>{selectedRelease&&<div className="panel" style={{marginTop:10}}><div className="listrow"><div><b>OrbitFS Base {selectedRelease.version}</b><span>{selectedRelease.changelog||selectedRelease.notes||"No customer changelog supplied."}</span></div><span className="state ready">PUBLISHED</span></div><div className="listrow"><div><b>Release identity</b><span>ID {selectedRelease.id} · source {selectedRelease.source_sha||selectedRelease.source_commit||selectedRelease.manifest?.sourceCommit||"recorded in release"}</span></div><span>{selectedRelease.artifact_sha256||selectedRelease.sha256?"CHECKSUM":"MASTER"}</span></div>{(selectedRelease.manifest?.minimumBaseVersion||selectedRelease.minimum_base_version||selectedRelease.minimum_version)&&<div className="listrow"><div><b>Compatibility</b><span>Minimum Base {selectedRelease.manifest?.minimumBaseVersion||selectedRelease.minimum_base_version||selectedRelease.minimum_version}</span></div><span>CHECKED</span></div>}<p className="muted">This is the exact published License Master release that will be handed to the deployer. The installation stores its release ID, version, checksum and source commit; the package itself remains in the release system.</p></div>}<button disabled={!databaseReady||!vercelApiReady||!selectedRelease||String(install.release_id||"")!==String(selectedRelease.id)||deploymentUnavailable||!settings.customer_deploy_enabled||busy==="deploy"} onClick={()=>void deploy("deploy",String(selectedRelease?.version||""),String(selectedRelease?.id||""))}>{busy==="deploy"?"Deploying…":"Deploy selected Base release"}</button></>:<><div className="listrow"><div><b>Panel {install.release_version}</b><span>{install.vercel_project_name||"Vercel project"}{install.production_url?` · ${install.production_url}`:""}</span></div><span className={`state ${panelReady?"ready":"waiting"}`}>{panelReady?"HEALTHY":"CHECKING"}</span></div><div className="orbitPrimaryActionBar compact"><div className="orbitPrimaryActionCopy"><small>{updateAvailable?"UPDATE AVAILABLE":"DEPLOYMENT READY"}</small><b>{updateAvailable?`OrbitFS ${latestUpdate}`:`Panel ${install.release_version}`}</b><span>{updateAvailable?"Install the approved update. Recovery controls stay available under Advanced.":"The deployed Panel is healthy. Use Advanced only for maintenance or recovery."}</span></div><div className="orbitPrimaryActionControls">{updateAvailable&&settings.customer_updates_enabled?<button className="orbitHeroAction" disabled={busy!==""||deploymentUnavailable||!licenseRegistered} onClick={()=>void deploy("update")}>{busy?"Working…":`Install ${latestUpdate}`}</button>:install.production_url?<a className="buttonlink orbitHeroAction" href={install.production_url} target="_blank" rel="noreferrer">Open Panel</a>:<button className="orbitHeroAction" disabled={busy!==""} onClick={()=>void sync(false)}>Refresh</button>}<details className="orbitActionMenu"><summary>Advanced</summary><div>{appliedUpdateVersion&&settings.customer_rollbacks_enabled&&<button className="secondary" disabled={busy!==""||deploymentUnavailable||!licenseRegistered} onClick={()=>void rollbackUpdate()}>{busy==="rollback-update"?"Rolling back…":`Rollback update ${appliedUpdateVersion}`}</button>}<button className="secondary" disabled={busy!==""||deploymentUnavailable||!licenseRegistered||!settings.customer_deploy_enabled} onClick={()=>void deploy(install.vercel_deployment_id?"redeploy":"deploy")}>{install.vercel_deployment_id?`Redeploy ${install.release_version}`:"Deploy Base"}</button>{settings.customer_rollbacks_enabled&&history.some((x:any)=>x.action!=="update"&&x.release_version!==install.release_version)&&<button className="secondary" disabled={busy!==""||deploymentUnavailable||!licenseRegistered} onClick={()=>void deploy("rollback")}>Rollback Base code</button>}<button className="secondary" disabled={busy!==""} onClick={()=>void sync(false)}>Refresh status</button></div></details></div></div>{d.latestUpdate?.customerNotes&&updateAvailable&&<p className="inlineStatus"><b>Update notes:</b> {d.latestUpdate.customerNotes}</p>}</>}{working&&<p className="muted">Deployment status is checked at most once every 20 seconds while this operation is active. Polling stops automatically when it finishes.</p>}</details>

        </div>

        <aside className="orbitZipSummary"><section className="panel portalQuickActions"><div><p className="eyebrow">YOUR INFRASTRUCTURE</p><h2>Customer owned</h2></div><div className="listrow"><div><b>Supabase</b><span>{install.supabase_project_name||"Not selected"}</span></div><span>{supabaseReady?"Ready":"Waiting"}</span></div><div className="listrow"><div><b>Vercel</b><span>{install.vercel_project_name||vercelConnection?.provider_account_name||"Not connected"}</span></div><span>{vercelApiReady?"Ready":"Waiting"}</span></div>{install.production_url&&<a href={install.production_url} target="_blank" rel="noreferrer"><b>Open OrbitFS</b><span>Launch your deployed Panel</span></a>}</section><section className="panel"><div className="panelTitle"><div><p className="eyebrow">MANAGE</p><h2>Installation lifecycle</h2></div></div><p className="muted"><b>Undeploy</b> removes the running Vercel resources but preserves this installation ID, database, storage and licence binding for a clean redeploy.</p><div className="controllerActions">{install.vercel_project_id&&<button className="secondary" disabled={busy!==""} onClick={()=>void executeLifecycle("undeploy")}>{busy==="undeploy"?"Undeploying…":"Undeploy OrbitFS"}</button>}</div><details style={{marginTop:12}}><summary style={summaryStyle}><b>Uninstall OrbitFS</b></summary><div className="form" style={{marginTop:12}}><p className="muted">The running Panel and Shared Engine Host are removed. Choose any additional cleanup explicitly; the customer Supabase project itself is never deleted.</p><label><span><input type="checkbox" checked={uninstallOptions.removeDatabase} onChange={e=>setUninstallOptions(v=>({...v,removeDatabase:e.target.checked}))}/> Remove OrbitFS database objects</span><small>Deletes OrbitFS-owned tables/functions from the selected customer database.</small></label><label><span><input type="checkbox" checked={uninstallOptions.removeStorage} onChange={e=>setUninstallOptions(v=>({...v,removeStorage:e.target.checked}))}/> Remove OrbitFS storage</span><small>Empties and deletes the <code>orbitfs-files</code> bucket.</small></label><label><span><input type="checkbox" checked={uninstallOptions.releaseLicense} onChange={e=>setUninstallOptions(v=>({...v,releaseLicense:e.target.checked}))}/> Release licence installation binding</span><small>Terminates this runtime activation so the licence may be registered to another installation.</small></label><button className="secondary" disabled={busy!==""} onClick={()=>void executeLifecycle("uninstall")}>{busy==="uninstall"?"Uninstalling…":"Review plan & uninstall"}</button>{lifecyclePlan?.plan&&<div className="inlineStatus"><b>Lifecycle plan:</b> {(lifecyclePlan.plan.steps||[]).map((step:any)=>step.label).join(" → ")}</div>}</div></details></section></aside>
      </div>}

      {install&&panelReady&&<div className="portalOverviewBottom"><details className="panel"><summary className="panelTitle" style={summaryStyle}><div><p className="eyebrow">RELEASES</p><h2>Release history</h2></div><span>{history.length}</span></summary>{history.length?history.map((r:any)=><div className="listrow" key={r.id}><div><b>{r.release_version} · {r.action}</b><span>{r.status} · {r.deployment_url||"deployment record"}</span></div><span>{new Date(r.created_at).toLocaleString()}</span></div>):<p className="muted">No Panel deployments yet.</p>}</details><details className="panel"><summary className="panelTitle" style={summaryStyle}><div><p className="eyebrow">ACTIVITY</p><h2>Setup activity</h2></div><span>{events.length}</span></summary>{events.length?events.slice(0,20).map((e:any)=><div className="listrow" key={e.id}><div><b>{label(e.event_type)}</b><span>{e.message||e.status}</span></div><span>{new Date(e.created_at).toLocaleString()}</span></div>):<p className="muted">No setup activity yet.</p>}</details></div>}
    </>:<section className="panel"><div className="panelTitle"><div><p className="eyebrow">MY ORBITFS</p><h2>OrbitFS access pending</h2><p className="muted">Licensing and release access are provided by the Master service.</p></div></div></section>}

    {msg&&<p className="inlineStatus">{msg}</p>}
  </main>;
}
