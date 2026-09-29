import {httpError,loadInstallation,requireOrbitUser,requireSystem,supabaseApi,vercelApi,event} from "@/lib/orbitfs-deployment";
import {clearPanelRegistration} from "@/lib/orbitfs-lifecycle";
import {masterInstallationLifecycle,masterReleases} from "@/lib/master-api";
import {customerReleaseChannels} from "@/lib/orbitfs-release-channels";
import {licenseDb} from "@/lib/license-api";
import {compareOrbitReleaseVersions} from "@/lib/orbitfs-version";
import {expireStaleBaseOperations} from "@/lib/orbitfs-base-operations";

const ACTIVE_STATES=["requested","authorising","validated","deploying","migrating","verifying","promoting"];

function latestPublishedBase(rows:any,channel:string){
  const releases=(Array.isArray(rows?.releases)?rows.releases:Array.isArray(rows)?rows:[])
    .filter((release:any)=>
      String(release?.release_type||release?.releaseType||"").toLowerCase()==="base"&&
      String(release?.channel||"stable").toLowerCase()===channel&&
      String(release?.status||"").toLowerCase()==="published"&&
      String(release?.review_status||release?.reviewStatus||"").toLowerCase()==="approved"&&
      !release?.archived_at
    )
    .sort((a:any,b:any)=>{
      const published=String(b?.published_at||b?.publishedAt||"").localeCompare(String(a?.published_at||a?.publishedAt||""));
      if(published)return published;
      return compareOrbitReleaseVersions(String(b?.version||""),String(a?.version||""))??0;
    });
  return releases[0]||null;
}

function sqlSafe(value:string){return value.replaceAll("'","''")}

async function clearRuntimeLicence(install:any){
  if(!install?.supabase_project_ref||!install?.database_initialized_at)return;
  const installationId=sqlSafe(String(install.installation_id||""));
  await supabaseApi(String(install.auth_user_id),`/projects/${install.supabase_project_ref}/database/query`,{
    method:"POST",
    body:JSON.stringify({query:`update public.orbitfs_license
set license_key=null,
    status='unconfigured',
    plan=null,
    licensed_to=null,
    expires_at=null,
    metadata=jsonb_build_object(
      'installationId','${installationId}',
      'releasedAt',now(),
      'rotationRequired',true,
      'reason','base_force_reinstall'
    ),
    updated_at=now()
where id='primary';`})
  });
}

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {user}=await requireOrbitUser(req);
    const {id}=await params;
    let install=await loadInstallation(id,user.id);
    const channel=String(install.release_channel||"stable").trim().toLowerCase();

    if(!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(channel))throw Object.assign(new Error("Invalid release channel"),{status:400,code:"INVALID_RELEASE_CHANNEL"});
    await requireSystem("deploy");

    const allowedChannels=await customerReleaseChannels(String(user.id),install.license_binding_id||null);
    if(!allowedChannels.includes(channel))throw Object.assign(new Error(`Release channel "${channel}" is not available for this installation's licence`),{status:403,code:"RELEASE_CHANNEL_ACCESS_DENIED"});

    const registration=install?.metadata?.licenseRegistration&&typeof install.metadata.licenseRegistration==="object"?install.metadata.licenseRegistration:null;
    if(registration?.valid!==true||String(registration?.installationId||"")!==String(install.installation_id||"")){
      throw Object.assign(new Error("Register an OrbitFS runtime licence key for this installation before forcing a Base reinstall"),{status:409,code:"LICENSE_REGISTRATION_REQUIRED"});
    }

    const bindingResult=await licenseDb().from("license_bindings").select("license_id,desired_state,remote_state,license_key_last4").eq("id",String(install.license_binding_id||"")).eq("auth_user_id",String(user.id)).is("archived_at",null).maybeSingle();
    if(bindingResult.error)throw bindingResult.error;
    if(!bindingResult.data?.license_id)throw Object.assign(new Error("This installation is not linked to an authoritative Billing licence"),{status:409,code:"LICENSE_BINDING_REQUIRED"});
    const authorityLicenseId=String(bindingResult.data.license_id);
    if(["revoked","expired"].includes(String(bindingResult.data.desired_state||bindingResult.data.remote_state||"").toLowerCase())){
      throw Object.assign(new Error("The installation's Billing licence is not active"),{status:403,code:"LICENSE_BINDING_INACTIVE"});
    }

    const rows=await masterReleases("orbitfs_base",channel,"base","deployer",true);
    const release=latestPublishedBase(rows,channel);
    if(!release?.id)throw Object.assign(new Error(`No approved published Base release is available in ${channel}`),{status:404,code:"PUBLISHED_BASE_NOT_FOUND"});

    await expireStaleBaseOperations(String(install.id));
    const active=await licenseDb().from("orbitfs_deployment_operations").select("id,action,state,heartbeat_at").eq("installation_id",install.id).in("state",ACTIVE_STATES).order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(active.error)throw active.error;
    if(active.data)throw Object.assign(new Error(`A Base lifecycle operation is already ${String(active.data.state).replaceAll("_"," ")}. Wait for it to finish before forcing a reinstall.`),{status:409,code:"OPERATION_IN_PROGRESS",operationId:active.data.id,retryable:true});

    const previousProjectId=String(install.vercel_project_id||"").trim()||null;
    const previousKeyHint=String(registration?.keyHint||"").trim()||null;

    const authorityStart=await masterInstallationLifecycle({
      action:"base_reinstall",
      phase:"authorize",
      licenseId:authorityLicenseId,
      installationId:install.installation_id,
      releaseLicense:true,
      projectId:previousProjectId,
      deploymentId:install.vercel_deployment_id||null,
      reason:"Customer requested Base-only force reinstall",
      targetReleaseId:String(release.id),
      targetVersion:String(release.version),
      channel,
    });
    const authorityState=authorityStart?.baseReinstall&&typeof authorityStart.baseReinstall==="object"?authorityStart.baseReinstall:null;
    if(!authorityState?.targetReleaseId||!authorityState?.targetVersion)throw Object.assign(new Error("License Manager did not record the Base reinstall target."),{status:502,code:"BASE_REINSTALL_AUTHORITY_STATE_MISSING"});

    try{
      const metadata=install?.metadata&&typeof install.metadata==="object"?{...install.metadata}:{};
      delete metadata.licenseRegistration;

      const applied=metadata?.appliedUpdate&&typeof metadata.appliedUpdate==="object"?metadata.appliedUpdate:null;
      if(applied&&Array.isArray(applied.components)&&applied.components.map((value:any)=>String(value).toLowerCase()).includes("base")){
        const remaining=applied.components.map((value:any)=>String(value).toLowerCase()).filter((value:string)=>value&&value!=="base");
        const componentVersions=applied.componentVersions&&typeof applied.componentVersions==="object"?{...applied.componentVersions}:{};
        delete componentVersions.base;
        metadata.appliedUpdate=remaining.length?{...applied,components:remaining,componentVersions,baseReinstalledAt:new Date().toISOString()}:null;
      }

      const startedAt=new Date().toISOString();
      metadata.pendingBaseForceReinstall={
        status:"releasing_base",
        startedAt,
        targetReleaseId:String(authorityState.targetReleaseId),
        targetVersion:String(authorityState.targetVersion),
        channel:String(authorityState.channel||channel),
        previousProjectId,
        previousKeyHint,
        previousKeyLast4:String(bindingResult.data.license_key_last4||"").trim()||null,
        licenseId:authorityLicenseId,
        rotationCompletedAt:null,
        lastError:null,
      };
      metadata.lastBaseForceReinstall={
        at:startedAt,
        status:"releasing_base",
        previousProjectId,
        targetReleaseId:String(authorityState.targetReleaseId),
        targetVersion:String(authorityState.targetVersion),
        channel:String(authorityState.channel||channel),
      };

      const initialPatch:any={
        metadata,
        applied_update_version:metadata.appliedUpdate?.version||null,
        applied_update_id:metadata.appliedUpdate?.releaseId||null,
        applied_update_sha256:metadata.appliedUpdate?.sha256||null,
        applied_update_source_commit:metadata.appliedUpdate?.sourceCommit||null,
        applied_update_at:metadata.appliedUpdate?.appliedAt||null,
        updated_at:startedAt,
      };
      const initialUpdate=await licenseDb().from("orbitfs_installations").update(initialPatch).eq("id",install.id).select().single();
      if(initialUpdate.error)throw initialUpdate.error;
      install=initialUpdate.data;

      await clearRuntimeLicence(install);

      if(previousProjectId){
        try{
          await vercelApi(String(install.auth_user_id),`/v9/projects/${encodeURIComponent(previousProjectId)}`,{method:"DELETE"});
        }catch(error:any){
          if(Number(error?.status)!==404)throw error;
        }
      }

      install=await clearPanelRegistration(install,`Force Base reinstall removed the current Base Vercel project. Licence activation was released. Rotate the licence key before Base ${release.version} is reinstalled.`);

      const waitingMetadata=install?.metadata&&typeof install.metadata==="object"?{...install.metadata}:metadata;
      waitingMetadata.pendingBaseForceReinstall={
        ...(waitingMetadata.pendingBaseForceReinstall&&typeof waitingMetadata.pendingBaseForceReinstall==="object"?waitingMetadata.pendingBaseForceReinstall:metadata.pendingBaseForceReinstall),
        status:"waiting_license_rotation",
        baseRemovedAt:new Date().toISOString(),
        lastError:null,
      };
      waitingMetadata.lastBaseForceReinstall={
        ...(waitingMetadata.lastBaseForceReinstall&&typeof waitingMetadata.lastBaseForceReinstall==="object"?waitingMetadata.lastBaseForceReinstall:metadata.lastBaseForceReinstall),
        status:"waiting_license_rotation",
      };
      const waitingUpdate=await licenseDb().from("orbitfs_installations").update({metadata:waitingMetadata,updated_at:new Date().toISOString()}).eq("id",install.id).select().single();
      if(waitingUpdate.error)throw waitingUpdate.error;
      install=waitingUpdate.data;

      await masterInstallationLifecycle({
        action:"base_reinstall",
        phase:"waiting_license",
        licenseId:authorityLicenseId,
        installationId:install.installation_id,
        releaseLicense:true,
        projectId:null,
        deploymentId:null,
        targetReleaseId:String(release.id),
        targetVersion:String(release.version),
        channel,
        result:{previousProjectId,activationReleased:true,runtimeLicenceCleared:true},
      });

      await event(install,"base.force_reinstall.waiting_license","warning",`Base project removed and licence activation released. Rotate the licence key, then register the new key to continue with published Base ${release.version}.`,{
        previousProjectId,
        targetReleaseId:String(release.id),
        targetVersion:String(release.version),
        channel,
        licenseId:authorityLicenseId,
      });

      return Response.json({
        ok:true,
        forceReinstall:true,
        requiresLicenseRotation:true,
        previousProjectId,
        targetRelease:{id:String(release.id),version:String(release.version),channel},
        installation:install,
        message:`Base was removed and the licence was released. Rotate your licence key, then enter the new key in Base Deployment. OrbitFS will automatically reinstall published Base ${release.version} after the new key is registered.`,
      },{headers:{"cache-control":"no-store"}});
    }catch(error:any){
      const message=error?.message||"Base force reinstall failed";
      const failedMetadata=install?.metadata&&typeof install.metadata==="object"?{...install.metadata}:{};
      if(failedMetadata.pendingBaseForceReinstall&&typeof failedMetadata.pendingBaseForceReinstall==="object"){
        failedMetadata.pendingBaseForceReinstall={...failedMetadata.pendingBaseForceReinstall,status:"start_failed",lastError:message,lastAttemptAt:new Date().toISOString()};
        failedMetadata.lastBaseForceReinstall={...(failedMetadata.lastBaseForceReinstall&&typeof failedMetadata.lastBaseForceReinstall==="object"?failedMetadata.lastBaseForceReinstall:{}),status:"start_failed",lastError:message};
        try{await licenseDb().from("orbitfs_installations").update({metadata:failedMetadata,last_error:message,updated_at:new Date().toISOString()}).eq("id",install.id)}catch{}
      }
      await masterInstallationLifecycle({
        action:"base_reinstall",
        phase:"failed",
        licenseId:authorityLicenseId,
        installationId:install.installation_id,
        releaseLicense:true,
        projectId:install.vercel_project_id||previousProjectId,
        deploymentId:install.vercel_deployment_id||null,
        targetReleaseId:String(release.id),
        targetVersion:String(release.version),
        channel,
        error:message,
      }).catch(()=>{});
      throw error;
    }
  }catch(error){return httpError(error)}
}
