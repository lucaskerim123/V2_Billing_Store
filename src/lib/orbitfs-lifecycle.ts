import {randomUUID} from "node:crypto";
import {licenseDb} from "@/lib/license-api";
import {customerInstallationDbSecret,customerSupabaseServerKey,event,supabaseApi} from "@/lib/orbitfs-deployment";
import {masterInstallationLifecycle} from "@/lib/master-api";
import {serviceRpc} from "@/lib/paymentServer";

const VERCEL_API="https://api.vercel.com";
const STORAGE_BUCKET="orbitfs-files";

export type OrbitfsLifecycleAction="undeploy"|"uninstall";
export type OrbitfsLifecycleOptions={
  removeDatabase:boolean;
  removeStorage:boolean;
  releaseLicense:boolean;
};

const now=()=>new Date().toISOString();
function objectValue(value:any){return value&&typeof value==="object"&&!Array.isArray(value)?value:{}}
function nextState(install:any){
  if(install.database_initialized_at&&install.supabase_project_ref)return "awaiting_vercel";
  if(install.supabase_project_ref)return "preparing_database";
  return "awaiting_supabase";
}
function lifecycleOptions(action:OrbitfsLifecycleAction,input:any={}):OrbitfsLifecycleOptions{
  if(action==="undeploy")return {removeDatabase:false,removeStorage:false,releaseLicense:false};
  return {
    removeDatabase:input.removeDatabase===true,
    removeStorage:input.removeStorage===true,
    releaseLicense:input.releaseLicense===true,
  };
}
async function runtimeLicenseRegistration(install:any){
  const registration=objectValue(objectValue(install?.metadata).licenseRegistration);
  if(registration?.valid===true&&String(registration.installationId||"")===String(install?.installation_id||""))return registration;
  if(!install?.supabase_project_ref||!install?.database_initialized_at)return null;
  try{
    const result=await customerDatabaseQuery(install,`select metadata from public.orbitfs_license where id='primary' limit 1;`);
    const row=managementRows(result)[0]||null;
    const metadata=objectValue(row?.metadata);
    const masterLicenseId=String(metadata.masterLicenseId||metadata.master_license_id||"").trim();
    const installationId=String(metadata.installationId||metadata.installation_id||"").trim();
    if(masterLicenseId&&installationId===String(install.installation_id||"")){
      return {valid:true,masterLicenseId,installationId,keyHint:metadata.keyHint||null,source:"customer_database"};
    }
  }catch{}
  return null;
}
function managementRows(value:any):any[]{
  if(Array.isArray(value))return value;
  for(const key of ["rows","data","result","results"]){
    const nested=value?.[key];
    if(Array.isArray(nested))return nested;
    if(nested&&typeof nested==="object"){
      const rows=managementRows(nested);
      if(rows.length)return rows;
    }
  }
  return [];
}

async function installationVercelApi(install:any,path:string,init:RequestInit={}){
  const token=String(await serviceRpc("service_orbitfs_provider_secret",{p_user_id:install.auth_user_id,p_provider:"vercel",p_key:"access_token"})||"").trim();
  if(!token)throw Object.assign(new Error("Vercel API access is not connected"),{status:409,code:"VERCEL_NOT_CONNECTED"});
  const url=new URL(path,VERCEL_API);if(install.vercel_team_id)url.searchParams.set("teamId",String(install.vercel_team_id));
  const r=await fetch(url,{...init,headers:{authorization:`Bearer ${token}`,"content-type":"application/json",...(init.headers||{})},cache:"no-store"});
  if(!r.ok)throw Object.assign(new Error(`Vercel API ${r.status}: ${await r.text()}`),{status:r.status>=500?502:r.status,code:"VERCEL_LIFECYCLE_FAILED"});
  return r.status===204?null:r.json();
}

async function customerDatabaseQuery(install:any,query:string){
  if(!install?.supabase_project_ref)throw Object.assign(new Error("Customer Supabase project is not selected"),{status:409,code:"SUPABASE_PROJECT_REQUIRED"});
  return supabaseApi(install.auth_user_id,`/projects/${install.supabase_project_ref}/database/query`,{method:"POST",body:JSON.stringify({query})});
}

async function engineHostState(install:any){
  if(!install?.supabase_project_ref||!install?.database_initialized_at)return null;
  try{
    const result=await customerDatabaseQuery(install,`select value from public.orbitfs_settings where scope_type='global' and scope_id='' and key='engine_host.shared' limit 1;`);
    const row=managementRows(result)[0]||null;
    return row?.value&&typeof row.value==="object"?row.value:null;
  }catch{return null}
}

async function prepareRuntime(install:any,action:OrbitfsLifecycleAction){
  // Lifecycle orchestration belongs to Billing Store. Base/Engine are the products being
  // managed and do not need a deployer-control endpoint merely to be removed from Vercel.
  // Customer database/storage cleanup is handled explicitly below according to the plan.
  return {
    supported:true,
    prepared:true,
    owner:"billing_store",
    action,
    installationId:String(install?.installation_id||""),
    reason:"billing_store_owns_lifecycle_orchestration",
    error:null as string|null
  };
}

async function resetEngineHostState(install:any){
  if(!install?.supabase_project_ref||!install?.database_initialized_at)return;
  const stamp=now();
  await customerDatabaseQuery(install,`update public.orbitfs_settings
set value=jsonb_build_object(
  'version',1,'state','not_deployed','provider','vercel','installationId',to_jsonb('${String(install.installation_id||"").replaceAll("'","''")}'::text),
  'installationRoute','billing_store','panelUrl',null,'hostUrl',null,'projectId',null,'projectName',null,
  'deploymentId',null,'deploymentUrl',null,'distribution',null,'releaseVersion',null,'releaseId',null,
  'releaseChannel',null,'releaseSha256',null,'releaseSourceCommit',null,'releaseFileCount',null,
  'pendingDeploymentId',null,'pendingDeploymentUrl',null,'pendingReleaseVersion',null,'pendingReleaseId',null,
  'pendingReleaseChannel',null,'pendingReleaseSha256',null,'pendingReleaseSourceCommit',null,'pendingReleaseFileCount',null,
  'pendingReleaseInventory',null,'pendingReleaseComponents','[]'::jsonb,'pendingReleaseComponentVersions','{}'::jsonb,
  'updaterConnected',false,'updaterConnectedAt',null,'updaterProvider',null,'updaterProtocol',null,
  'updaterLastVerifiedAt',null,'updaterLastError',null,'linkedAt',null,'linkedByUserId',null,
  'lastSyncAt',null,'lastHealthAt',null,'lastError',null,'createdAt',coalesce(value->'createdAt',to_jsonb('${stamp.replaceAll("'","''")}'::text)),
  'updatedAt',to_jsonb('${stamp.replaceAll("'","''")}'::text)
),updated_at=now()
where scope_type='global' and scope_id='' and key='engine_host.shared';`);
}

async function rotatePreservedDatabaseIdentity(install:any,nextInstallationId:string){
  if(!install?.supabase_project_ref||!install?.database_initialized_at)return;
  const id=nextInstallationId.replaceAll("'","''");
  await customerDatabaseQuery(install,`update public.orbitfs_settings
set value=jsonb_set(coalesce(value,'{}'::jsonb),'{installationId}',to_jsonb('${id}'::text),true),updated_at=now()
where scope_type='global' and scope_id='' and key='installation.route';

update public.orbitfs_license
set license_key=null,
    status='unconfigured',
    plan=null,
    licensed_to=null,
    expires_at=null,
    metadata=jsonb_build_object('installationId','${id}','releasedAt',now()),
    updated_at=now()
where id='primary';`);
  await resetEngineHostState({...install,installation_id:nextInstallationId});
}

async function removeVercelProject(install:any,projectId:string|null|undefined,label:string){
  const id=String(projectId||"").trim();
  if(!id)return {removed:false,missing:true,label};
  try{
    await installationVercelApi(install,`/v9/projects/${encodeURIComponent(id)}`,{method:"DELETE"});
    return {removed:true,missing:false,label,projectId:id};
  }catch(error:any){
    if(Number(error?.status)===404)return {removed:false,missing:true,label,projectId:id};
    throw error;
  }
}

async function removeOrbitfsStorage(install:any){
  if(!install?.supabase_project_ref)return {removed:false,missing:true};
  const secret=await customerSupabaseServerKey(install);
  const base=`https://${install.supabase_project_ref}.supabase.co/storage/v1`;
  const headers={authorization:`Bearer ${secret}`,apikey:secret,"content-type":"application/json"};
  const empty=await fetch(`${base}/bucket/${encodeURIComponent(STORAGE_BUCKET)}/empty`,{method:"POST",headers,signal:AbortSignal.timeout(30000)});
  const emptyError=empty.ok?"":await empty.text();
  if(empty.status===404||/NoSuchBucket|Bucket not found/i.test(emptyError))return {removed:false,missing:true};
  if(!empty.ok)throw Object.assign(new Error(`Supabase Storage empty failed (${empty.status}): ${emptyError}`),{status:502,code:"STORAGE_EMPTY_FAILED"});
  let last="";
  for(let attempt=0;attempt<8;attempt++){
    const del=await fetch(`${base}/bucket/${encodeURIComponent(STORAGE_BUCKET)}`,{method:"DELETE",headers,signal:AbortSignal.timeout(30000)});
    const deleteError=del.ok?"":await del.text();
    if(del.ok||del.status===404||/NoSuchBucket|Bucket not found/i.test(deleteError))return {removed:del.ok,missing:!del.ok};
    last=deleteError;
    if(!/not empty|contains|objects/i.test(last))throw Object.assign(new Error(`Supabase Storage delete failed (${del.status}): ${last}`),{status:502,code:"STORAGE_DELETE_FAILED"});
    await new Promise(resolve=>setTimeout(resolve,750));
  }
  throw Object.assign(new Error("Supabase Storage cleanup is still processing. Retry uninstall to finish deleting the OrbitFS storage bucket."),{status:409,code:"STORAGE_CLEANUP_PENDING",detail:last});
}

async function removeOrbitfsDatabase(install:any){
  const sql=`do $$
declare r record;
begin
  for r in
    select n.nspname,c.relname,c.relkind
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and (c.relname like 'orbitfs\\_%' escape '\\' or c.relname like 'mcp\\_%' escape '\\' or c.relname like 'studio\\_%' escape '\\' or c.relname like 'apex\\_%' escape '\\')
      and c.relkind in ('r','p','v','m')
  loop
    execute case r.relkind
      when 'v' then format('drop view if exists public.%I cascade',r.relname)
      when 'm' then format('drop materialized view if exists public.%I cascade',r.relname)
      else format('drop table if exists public.%I cascade',r.relname)
    end;
  end loop;

  for r in
    select p.oid::regprocedure::text as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and (p.proname like 'orbitfs\\_%' escape '\\' or p.proname like 'mcp\\_%' escape '\\' or p.proname like 'studio\\_%' escape '\\' or p.proname like 'apex\\_%' escape '\\')
  loop
    execute 'drop function if exists '||r.signature||' cascade';
  end loop;

  if to_regclass('private.orbitfs_runtime_secret') is not null then
    drop table private.orbitfs_runtime_secret cascade;
  end if;
end $$;
notify pgrst,'reload schema';`;
  await customerDatabaseQuery(install,sql);
  return {removed:true};
}

async function updateJob(id:string,patch:any){
  const {data,error}=await licenseDb().from("orbitfs_lifecycle_jobs").update({...patch,updated_at:now()}).eq("id",id).select().single();
  if(error)throw error;
  return data;
}

async function addJobStep(job:any,step:any){
  const steps=Array.isArray(job?.steps)?[...job.steps]:[];
  steps.push({at:now(),...step});
  return updateJob(job.id,{steps,current_step:step.step||job.current_step});
}

export async function planOrbitfsLifecycle(install:any,action:OrbitfsLifecycleAction,input:any={}){
  const options=lifecycleOptions(action,input);
  const engine=await engineHostState(install);
  const registration=await runtimeLicenseRegistration(install);
  const plan={
    version:1,
    action,
    installationId:String(install.installation_id||""),
    options,
    resources:{
      panel:{projectId:install.vercel_project_id||null,projectName:install.vercel_project_name||null,willDelete:Boolean(install.vercel_project_id)},
      engineHost:{projectId:engine?.projectId||null,projectName:engine?.projectName||null,hostUrl:engine?.hostUrl||null,willDelete:Boolean(engine?.projectId)},
      database:{projectRef:install.supabase_project_ref||null,initialized:Boolean(install.database_initialized_at),willDelete:action==="uninstall"&&options.removeDatabase},
      storage:{bucket:STORAGE_BUCKET,willDelete:action==="uninstall"&&options.removeStorage},
      license:{masterLicenseId:registration?.masterLicenseId||null,keyHint:registration?.keyHint||null,registered:Boolean(registration),willRelease:action==="uninstall"&&options.releaseLicense},
    },
    preserves:{
      supabaseProject:true,
      database:action==="undeploy"||!options.removeDatabase,
      storage:action==="undeploy"||!options.removeStorage,
      licenseBinding:action==="undeploy"||!options.releaseLicense,
      installationId:action==="undeploy",
    },
    steps:[
      ...(registration?[{id:"authority",label:"Authorize lifecycle with License Manager"}]:[]),
      {id:"runtime",label:"Prepare Base runtime for shutdown"},
      ...(engine?.projectId?[{id:"engine",label:"Remove Shared Engine Host Vercel project"}]:[]),
      ...(install.vercel_project_id?[{id:"panel",label:"Remove OrbitFS Panel Vercel project"}]:[]),
      ...(action==="uninstall"&&options.removeStorage?[{id:"storage",label:"Empty and remove OrbitFS Storage bucket"}]:[]),
      ...(action==="uninstall"&&options.removeDatabase?[{id:"database",label:"Remove OrbitFS-owned database objects"}]:[]),
      ...(action==="uninstall"&&options.releaseLicense&&registration?[{id:"license",label:"Release License Manager installation binding"}]:[]),
      {id:"finalize",label:action==="undeploy"?"Keep installation ready for redeploy":"Mark installation uninstalled and retain audit history"},
    ],
  };
  const {data,error}=await licenseDb().from("orbitfs_lifecycle_jobs").insert({
    installation_id:install.id,auth_user_id:install.auth_user_id,action,status:"planned",options,plan,steps:[],
  }).select().single();
  if(error)throw error;
  await event(install,`lifecycle.${action}.planned`,"info",`${action==="undeploy"?"Undeploy":"Uninstall"} plan created`,{jobId:data.id,options,plan:plan.resources});
  return {job:data,plan};
}

export async function clearPanelRegistration(install:any,reason="Panel project is not deployed"){
  const patch={state:nextState(install),vercel_project_id:null,vercel_project_name:null,vercel_deployment_id:null,deployment_url:null,production_url:null,release_version:null,release_id:null,release_sha256:null,release_source_commit:null,previous_release_version:null,latest_available_release:null,health_status:"unknown",last_health_at:null,last_error:null};
  const {data,error}=await licenseDb().from("orbitfs_installations").update(patch).eq("id",install.id).select().single();
  if(error)throw error;
  await event(data,"panel.registration_cleared","warning",reason,{previousProjectId:install.vercel_project_id||null,teamId:install.vercel_team_id||null});
  return data;
}

export async function reconcileOrbitfsInstallation(install:any){
  if(!install?.vercel_project_id)return install;
  try{await installationVercelApi(install,`/v9/projects/${encodeURIComponent(install.vercel_project_id)}`);return install}
  catch(e:any){if(Number(e?.status)!==404)throw e;return clearPanelRegistration(install,"The customer Vercel project no longer exists. OrbitFS kept the Supabase database and cleared the stale Panel registration.")}
}

export async function executeOrbitfsLifecycle(install:any,action:OrbitfsLifecycleAction,input:any={}){
  const options=lifecycleOptions(action,input);
  let job:any=null;
  if(input.jobId){
    const result=await licenseDb().from("orbitfs_lifecycle_jobs").select("*").eq("id",String(input.jobId)).eq("installation_id",install.id).maybeSingle();
    if(result.error)throw result.error;
    job=result.data;
  }
  if(!job){
    const planned=await planOrbitfsLifecycle(install,action,options);
    job=planned.job;
  }
  if(job.action!==action)throw Object.assign(new Error("Lifecycle job action does not match this request"),{status:409,code:"LIFECYCLE_JOB_MISMATCH"});

  const registration=await runtimeLicenseRegistration(install);
  const licenseId=String(registration?.masterLicenseId||"").trim();
  const engine=await engineHostState(install);
  let current=install;
  const result:any={action,options,jobId:job.id,removed:{},warnings:[]};

  job=await updateJob(job.id,{status:"running",started_at:job.started_at||now(),current_step:"authority",error_code:null,error_message:null});
  await licenseDb().from("orbitfs_installations").update({state:action==="undeploy"?"undeploying":"uninstalling",last_error:null,updated_at:now()}).eq("id",install.id);

  try{
    if(licenseId){
      await masterInstallationLifecycle({action,phase:"authorize",licenseId,installationId:install.installation_id,releaseLicense:options.releaseLicense,projectId:install.vercel_project_id||null,deploymentId:install.vercel_deployment_id||null});
      job=await addJobStep(job,{step:"authority",status:"ok",message:"License Manager authorized lifecycle action"});
    }else{
      job=await addJobStep(job,{step:"authority",status:"skipped",message:"No runtime licence is registered to this installation"});
    }

    job=await updateJob(job.id,{current_step:"runtime"});
    const runtime=await prepareRuntime(install,action);
    result.runtime=runtime;
    job=await addJobStep(job,{step:"runtime",status:runtime?.prepared===true?"ok":"warning",message:runtime?.prepared===true?"Base runtime prepared for removal":String(runtime?.reason||runtime?.error||"Runtime preparation unavailable")});

    if(engine?.projectId&&String(engine.projectId)!==String(install.vercel_project_id||"")){
      job=await updateJob(job.id,{current_step:"engine"});
      result.removed.engineHost=await removeVercelProject(install,engine.projectId,"Shared Engine Host");
      job=await addJobStep(job,{step:"engine",status:"ok",message:result.removed.engineHost.removed?"Shared Engine Host removed":"Shared Engine Host already absent"});
    }
    if(!options.removeDatabase&&install.database_initialized_at){
      await resetEngineHostState(install).catch((error:any)=>result.warnings.push(`Could not reset Engine Host database state: ${String(error?.message||error)}`));
    }

    if(install.vercel_project_id){
      job=await updateJob(job.id,{current_step:"panel"});
      result.removed.panel=await removeVercelProject(install,install.vercel_project_id,"OrbitFS Panel");
      job=await addJobStep(job,{step:"panel",status:"ok",message:result.removed.panel.removed?"OrbitFS Panel removed":"OrbitFS Panel already absent"});
    }

    if(action==="undeploy"){
      current=await clearPanelRegistration({...install,state:"undeploying"},"OrbitFS undeployed. Customer Supabase data, runtime licence and installation ID were preserved.");
      if(licenseId)await masterInstallationLifecycle({action,phase:"completed",licenseId,installationId:install.installation_id,releaseLicense:false,result});
      job=await addJobStep(job,{step:"finalize",status:"ok",message:"Installation preserved and ready for redeploy"});
      job=await updateJob(job.id,{status:"completed",completed_at:now(),current_step:"complete",result});
      await event(current,"lifecycle.undeploy.completed","ok","OrbitFS undeployed. Database, storage, licence binding and installation ID were preserved.",{jobId:job.id,result});
      return {installation:current,job,result};
    }

    if(options.removeStorage){
      job=await updateJob(job.id,{current_step:"storage"});
      result.removed.storage=await removeOrbitfsStorage(install);
      job=await addJobStep(job,{step:"storage",status:"ok",message:result.removed.storage.missing?"OrbitFS Storage bucket already absent":"OrbitFS Storage bucket removed"});
    }

    if(options.removeDatabase){
      job=await updateJob(job.id,{current_step:"database"});
      result.removed.database=await removeOrbitfsDatabase(install);
      job=await addJobStep(job,{step:"database",status:"ok",message:"OrbitFS-owned database objects removed"});
    }

    if(licenseId){
      job=await updateJob(job.id,{current_step:"license"});
      await masterInstallationLifecycle({action,phase:"completed",licenseId,installationId:install.installation_id,releaseLicense:options.releaseLicense,result});
      job=await addJobStep(job,{step:"license",status:options.releaseLicense?"ok":"skipped",message:options.releaseLicense?"License Manager installation binding released":"Licence binding preserved"});
    }

    const metadata=objectValue(install.metadata);
    const lifecycle=objectValue(metadata.lifecycle);
    const nextMetadata={...metadata,lifecycle:{...lifecycle,lastUninstall:{at:now(),installationId:install.installation_id,options,result}}};
    if(options.releaseLicense||options.removeDatabase)delete nextMetadata.licenseRegistration;
    const nextInstallationId=options.releaseLicense?`ofs_${randomUUID().replaceAll("-","")}`:String(install.installation_id||"");
    if(options.releaseLicense){
      result.nextInstallationId=nextInstallationId;
      if(!options.removeDatabase)await rotatePreservedDatabaseIdentity(install,nextInstallationId);
    }
    const patch:any={
      state:"uninstalled",installation_id:nextInstallationId,vercel_project_id:null,vercel_project_name:null,vercel_deployment_id:null,deployment_url:null,production_url:null,
      health_status:"unknown",last_health_at:null,last_error:null,metadata:nextMetadata,updated_at:now(),
    };
    if(options.removeDatabase){
      Object.assign(patch,{database_initialized_at:null,schema_version:null,release_version:null,release_id:null,release_sha256:null,release_source_commit:null,previous_release_version:null,latest_available_release:null,applied_update_version:null,applied_update_id:null,applied_update_sha256:null,applied_update_source_commit:null});
    }
    const updated=await licenseDb().from("orbitfs_installations").update(patch).eq("id",install.id).select().single();
    if(updated.error)throw updated.error;
    current=updated.data;
    job=await addJobStep(job,{step:"finalize",status:"ok",message:"Installation marked uninstalled; lifecycle history retained"});
    job=await updateJob(job.id,{status:"completed",completed_at:now(),current_step:"complete",result});
    await event(current,"lifecycle.uninstall.completed","ok","OrbitFS uninstalled according to the selected cleanup options.",{jobId:job.id,options,result});
    return {installation:current,job,result};
  }catch(error:any){
    const code=String(error?.code||"LIFECYCLE_FAILED");
    const message=String(error?.message||"OrbitFS lifecycle operation failed");
    if(licenseId)await masterInstallationLifecycle({action,phase:"failed",licenseId,installationId:install.installation_id,releaseLicense:options.releaseLicense,error:message,result}).catch(()=>{});
    const steps=Array.isArray(job?.steps)?job.steps:[];
    await updateJob(job.id,{status:steps.length?"partial":"failed",completed_at:now(),error_code:code,error_message:message,result}).catch(()=>{});
    try{await licenseDb().from("orbitfs_installations").update({state:"failed",last_error:message,updated_at:now()}).eq("id",install.id)}catch{}
    await event(install,`lifecycle.${action}.failed`,"error",message,{jobId:job.id,code,options,result}).catch(()=>{});
    throw error;
  }
}

// Backward-compatible wrappers used by older callers.
export async function undeployOrbitfsPanel(install:any){
  return (await executeOrbitfsLifecycle(install,"undeploy",{})).installation;
}
export async function deregisterOrbitfsInstallation(install:any,removePanel=true){
  const outcome=await executeOrbitfsLifecycle(install,"uninstall",{removeDatabase:false,removeStorage:false,releaseLicense:true,removePanel});
  return {ok:true,id:outcome.installation.id,installationId:outcome.installation.installation_id,supabaseProjectRef:outcome.installation.supabase_project_ref||null,job:outcome.job};
}
