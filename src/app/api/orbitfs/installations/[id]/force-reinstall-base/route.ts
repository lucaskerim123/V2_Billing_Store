import {randomUUID} from "node:crypto";
import {httpError,loadInstallation,requireOrbitUser,requireSystem,vercelApi} from "@/lib/orbitfs-deployment";
import {clearPanelRegistration} from "@/lib/orbitfs-lifecycle";
import {masterReleases} from "@/lib/master-api";
import {customerReleaseChannels} from "@/lib/orbitfs-release-channels";
import {licenseDb} from "@/lib/license-api";
import {compareOrbitReleaseVersions} from "@/lib/orbitfs-version";
import {expireStaleBaseOperations,runBaseLifecycleOperation} from "@/lib/orbitfs-base-operations";

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

    const bindingResult=await licenseDb().from("license_bindings").select("license_id,desired_state,remote_state").eq("id",String(install.license_binding_id||"")).eq("auth_user_id",String(user.id)).is("archived_at",null).maybeSingle();
    if(bindingResult.error)throw bindingResult.error;
    if(!bindingResult.data?.license_id)throw Object.assign(new Error("This installation is not linked to an authoritative Billing licence"),{status:409,code:"LICENSE_BINDING_REQUIRED"});
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
    if(previousProjectId){
      try{
        await vercelApi(String(install.auth_user_id),`/v9/projects/${encodeURIComponent(previousProjectId)}`,{method:"DELETE"});
      }catch(error:any){
        if(Number(error?.status)!==404)throw error;
      }
    }

    install=await clearPanelRegistration(install,`Force Base reinstall removed the current Base Vercel project. Reinstalling approved published Base ${release.version} from ${channel}.`);

    const metadata=install?.metadata&&typeof install.metadata==="object"?install.metadata:{};
    const applied=metadata?.appliedUpdate&&typeof metadata.appliedUpdate==="object"?metadata.appliedUpdate:null;
    if(applied&&Array.isArray(applied.components)&&applied.components.map((value:any)=>String(value).toLowerCase()).includes("base")){
      const remaining=applied.components.map((value:any)=>String(value).toLowerCase()).filter((value:string)=>value&&value!=="base");
      const componentVersions=applied.componentVersions&&typeof applied.componentVersions==="object"?{...applied.componentVersions}:{};
      delete componentVersions.base;
      const nextApplied=remaining.length?{...applied,components:remaining,componentVersions,baseReinstalledAt:new Date().toISOString()}:null;
      const nextMetadata={...metadata,appliedUpdate:nextApplied,lastBaseForceReinstall:{at:new Date().toISOString(),previousProjectId,targetReleaseId:String(release.id),targetVersion:String(release.version),channel}};
      const patch:any={metadata:nextMetadata,updated_at:new Date().toISOString()};
      if(!nextApplied)Object.assign(patch,{applied_update_version:null,applied_update_id:null,applied_update_sha256:null,applied_update_source_commit:null,applied_update_at:null});
      const updated=await licenseDb().from("orbitfs_installations").update(patch).eq("id",install.id).select().single();
      if(updated.error)throw updated.error;
      install=updated.data;
    }else{
      const nextMetadata={...metadata,lastBaseForceReinstall:{at:new Date().toISOString(),previousProjectId,targetReleaseId:String(release.id),targetVersion:String(release.version),channel}};
      const updated=await licenseDb().from("orbitfs_installations").update({metadata:nextMetadata,updated_at:new Date().toISOString()}).eq("id",install.id).select().single();
      if(updated.error)throw updated.error;
      install=updated.data;
    }

    const result=await runBaseLifecycleOperation({
      install,
      action:"deploy",
      version:String(release.version),
      releaseId:String(release.id),
      channel,
      reason:"Customer requested force reinstall of published Base",
      idempotencyKey:`force-base-${randomUUID()}`,
    });

    return Response.json({
      ok:true,
      forceReinstall:true,
      previousProjectId,
      targetRelease:{id:String(release.id),version:String(release.version),channel},
      ...result,
    },{headers:{"cache-control":"no-store"}});
  }catch(error){return httpError(error)}
}
