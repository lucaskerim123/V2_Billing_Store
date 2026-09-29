import {createHash} from "node:crypto";
import {licenseDb} from "@/lib/license-api";
import {masterInstallationLifecycle} from "@/lib/master-api";
import {event} from "@/lib/orbitfs-deployment";
import {runBaseLifecycleOperation} from "@/lib/orbitfs-base-operations";
import {errorMessage} from "@/lib/error-message";

export function pendingBaseForceReinstall(install:any){
  const value=install?.metadata?.pendingBaseForceReinstall;
  return value&&typeof value==="object"&&!Array.isArray(value)?value:null;
}

async function patchPending(install:any,pending:any,extraMetadata:Record<string,unknown>={}){
  const metadata={...(install?.metadata&&typeof install.metadata==="object"?install.metadata:{}),...extraMetadata,pendingBaseForceReinstall:pending};
  const {data,error}=await licenseDb().from("orbitfs_installations").update({metadata,updated_at:new Date().toISOString()}).eq("id",install.id).select().single();
  if(error)throw error;
  return data;
}

function idempotencyKey(install:any,pending:any,attempt:number){
  const fingerprint=createHash("sha256").update([
    String(install.id||""),
    String(pending.startedAt||""),
    String(pending.targetReleaseId||""),
    String(pending.rotationCompletedAt||""),
    String(attempt)
  ].join("|")).digest("hex").slice(0,32);
  return `force-base-complete-${fingerprint}`;
}

export async function completePendingBaseForceReinstall(install:any){
  const pending=pendingBaseForceReinstall(install);
  if(!pending)return null;
  if(!pending.rotationCompletedAt)throw Object.assign(new Error("Rotate your licence key before continuing the Base reinstall."),{status:409,code:"LICENSE_ROTATION_REQUIRED"});

  const registration=install?.metadata?.licenseRegistration&&typeof install.metadata.licenseRegistration==="object"?install.metadata.licenseRegistration:null;
  if(registration?.valid!==true||String(registration?.installationId||"")!==String(install.installation_id||"")){
    throw Object.assign(new Error("Enter and register the new rotated licence key before continuing the Base reinstall."),{status:409,code:"NEW_LICENSE_KEY_REQUIRED"});
  }

  const releaseId=String(pending.targetReleaseId||"").trim();
  const version=String(pending.targetVersion||"").trim();
  const channel=String(pending.channel||install.release_channel||"stable").trim().toLowerCase();
  const licenseId=String(pending.licenseId||registration.masterLicenseId||"").trim();
  if(!releaseId||!version||!licenseId)throw Object.assign(new Error("Pending Base reinstall identity is incomplete. Start the force reinstall again."),{status:409,code:"BASE_REINSTALL_STATE_INCOMPLETE"});

  const attempt=Math.max(0,Number(pending.attempts||0))+1;
  const startedAt=new Date().toISOString();
  const nextPending={...pending,status:"deploying",attempts:attempt,lastAttemptAt:startedAt,lastError:null};
  install=await patchPending(install,nextPending);

  try{
    const result=await runBaseLifecycleOperation({
      install,
      action:"deploy",
      version,
      releaseId,
      channel,
      reason:"Complete Base force reinstall after licence rotation",
      idempotencyKey:idempotencyKey(install,nextPending,attempt),
    });

    const deployed=result.installation;
    const metadata={...(deployed?.metadata&&typeof deployed.metadata==="object"?deployed.metadata:{})};
    delete metadata.pendingBaseForceReinstall;
    metadata.lastBaseForceReinstall={
      ...(metadata.lastBaseForceReinstall&&typeof metadata.lastBaseForceReinstall==="object"?metadata.lastBaseForceReinstall:{}),
      status:"completed",
      completedAt:new Date().toISOString(),
      targetReleaseId:releaseId,
      targetVersion:version,
      channel,
      previousProjectId:pending.previousProjectId||null,
      newProjectId:deployed?.vercel_project_id||null,
      newDeploymentId:deployed?.vercel_deployment_id||null,
      attempts:attempt,
    };
    const finalUpdate=await licenseDb().from("orbitfs_installations").update({metadata,updated_at:new Date().toISOString()}).eq("id",deployed.id).select().single();
    if(finalUpdate.error)throw finalUpdate.error;
    const finalInstallation=finalUpdate.data;

    await masterInstallationLifecycle({
      action:"base_reinstall",
      phase:"completed",
      licenseId,
      installationId:finalInstallation.installation_id,
      releaseLicense:true,
      projectId:finalInstallation.vercel_project_id||null,
      deploymentId:finalInstallation.vercel_deployment_id||null,
      targetReleaseId:releaseId,
      targetVersion:version,
      channel,
      result:{
        previousProjectId:pending.previousProjectId||null,
        newProjectId:finalInstallation.vercel_project_id||null,
        newDeploymentId:finalInstallation.vercel_deployment_id||null,
        licenceRotated:true,
        attempts:attempt,
      },
    });

    await event(finalInstallation,"base.force_reinstall.completed","ok",`Published Base ${version} was reinstalled after licence rotation.`,{
      targetReleaseId:releaseId,
      targetVersion:version,
      channel,
      previousProjectId:pending.previousProjectId||null,
      newProjectId:finalInstallation.vercel_project_id||null,
      newDeploymentId:finalInstallation.vercel_deployment_id||null,
      attempts:attempt,
    });

    return {...result,installation:finalInstallation,forceReinstallCompleted:true};
  }catch(error:any){
    const message=errorMessage(error,"Base force reinstall deployment failed.");
    const currentMetadata=install?.metadata&&typeof install.metadata==="object"?{...install.metadata}:{};
    const failedPending={
      ...(currentMetadata.pendingBaseForceReinstall&&typeof currentMetadata.pendingBaseForceReinstall==="object"?currentMetadata.pendingBaseForceReinstall:nextPending),
      status:"deployment_failed",
      lastError:message,
      lastAttemptAt:new Date().toISOString(),
      attempts:attempt,
    };
    await patchPending(install,failedPending).catch(()=>{});
    await masterInstallationLifecycle({
      action:"base_reinstall",
      phase:"failed",
      licenseId,
      installationId:install.installation_id,
      releaseLicense:true,
      projectId:install.vercel_project_id||null,
      deploymentId:install.vercel_deployment_id||null,
      targetReleaseId:releaseId,
      targetVersion:version,
      channel,
      error:message,
      result:{stage:"deploy_after_rotation",attempts:attempt},
    }).catch(()=>{});
    throw error;
  }
}
