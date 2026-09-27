import {createHash} from "node:crypto";
import {licenseDb} from "@/lib/license-api";
import {runCustomerDeployer} from "@/lib/orbitfs-customer-deployer";
import type {DeployAction} from "@/lib/orbitfs-deployment";

export type BaseLifecycleAction=Extract<DeployAction,"deploy"|"base_update"|"redeploy"|"rollback">;

const ACTIVE_STATES=["requested","authorising","validated","deploying","migrating","verifying","promoting"] as const;
const STALE_AFTER_MS=30*60*1000;

function operationError(code:string,message:string,status:number,retryable=false,operationId?:string|null){
  return Object.assign(new Error(message),{code,status,retryable,operationId:operationId||null});
}
function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
  return value??null;
}
function fingerprint(value:unknown){
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export function baseIdempotencyKey(req:Request,body:any,required=true){
  const value=String(req.headers.get("idempotency-key")||body?.idempotencyKey||body?.idempotency_key||"").trim();
  if(!value&&required)throw operationError("IDEMPOTENCY_KEY_REQUIRED","Idempotency-Key is required for Base lifecycle operations.",400,false);
  if(value&&(value.length<8||value.length>200||!/^[A-Za-z0-9._:-]+$/.test(value)))throw operationError("IDEMPOTENCY_KEY_INVALID","Idempotency-Key must be 8-200 characters using letters, numbers, dot, underscore, colon or dash.",400,false);
  return value;
}
async function currentInstallation(id:string){
  const {data,error}=await licenseDb().from("orbitfs_installations").select("*").eq("id",id).single();
  if(error||!data)throw operationError("INSTALLATION_NOT_FOUND","OrbitFS installation not found.",404,false);
  return data;
}
async function expireStaleOperation(installationId:string){
  const cutoff=new Date(Date.now()-STALE_AFTER_MS).toISOString();
  await licenseDb().from("orbitfs_deployment_operations").update({
    state:"failed",
    error_code:"OPERATION_LEASE_EXPIRED",
    error_detail:"The previous Base lifecycle operation stopped reporting progress and its execution lease expired.",
    updated_at:new Date().toISOString(),
    completed_at:new Date().toISOString()
  }).eq("installation_id",installationId).in("state",[...ACTIVE_STATES]).lt("heartbeat_at",cutoff);
}
async function operationByKey(installationId:string,key:string){
  const {data,error}=await licenseDb().from("orbitfs_deployment_operations").select("*").eq("installation_id",installationId).eq("idempotency_key",key).maybeSingle();
  if(error)throw error;
  return data||null;
}
async function activeOperation(installationId:string){
  const {data,error}=await licenseDb().from("orbitfs_deployment_operations").select("*").eq("installation_id",installationId).in("state",[...ACTIVE_STATES]).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(error)throw error;
  return data||null;
}
async function patchOperation(id:string,patch:Record<string,unknown>){
  const {data,error}=await licenseDb().from("orbitfs_deployment_operations").update({...patch,heartbeat_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",id).select().single();
  if(error)throw error;
  return data;
}
export async function setBaseOperationState(id:string,state:string,detail:Record<string,unknown>={}){
  return patchOperation(id,{state,detail});
}

export async function runBaseLifecycleOperation(input:{
  install:any;
  action:BaseLifecycleAction;
  version?:string;
  channel?:string;
  releaseId?:string;
  reason?:string;
  idempotencyKey:string;
}){
  const {install,action}=input;
  const key=String(input.idempotencyKey||"").trim();
  if(!key)throw operationError("IDEMPOTENCY_KEY_REQUIRED","Idempotency-Key is required for Base lifecycle operations.",400,false);
  const requestFingerprint=fingerprint({
    action,
    version:input.version||null,
    releaseId:input.releaseId||null,
    channel:String(input.channel||install.release_channel||"stable").toLowerCase(),
    reason:input.reason||null
  });

  await expireStaleOperation(String(install.id));
  const prior=await operationByKey(String(install.id),key);
  if(prior){
    if(String(prior.request_fingerprint)!==requestFingerprint)throw operationError("IDEMPOTENCY_KEY_REUSE","This Idempotency-Key was already used for a different Base lifecycle request.",409,false,String(prior.id));
    if(prior.state==="completed")return {operation:prior,installation:await currentInstallation(String(install.id)),replayed:true};
    if(prior.state==="failed")throw operationError(String(prior.error_code||"BASE_OPERATION_FAILED"),String(prior.error_detail||"The previous Base lifecycle attempt failed."),409,false,String(prior.id));
    throw operationError("OPERATION_IN_PROGRESS","A Base lifecycle operation with this Idempotency-Key is still in progress.",409,true,String(prior.id));
  }

  const now=new Date().toISOString();
  const row={
    installation_id:install.id,
    auth_user_id:install.auth_user_id,
    action,
    idempotency_key:key,
    request_fingerprint:requestFingerprint,
    current_release_id:install.release_id||null,
    requested_release_id:input.releaseId||null,
    release_channel:String(input.channel||install.release_channel||"stable").toLowerCase(),
    state:"requested",
    vercel_project_id:install.vercel_project_id||null,
    vercel_deployment_id:install.vercel_deployment_id||null,
    heartbeat_at:now,
    created_at:now,
    updated_at:now,
    detail:{version:input.version||null,reason:input.reason||null}
  };
  let operation:any=null;
  const created=await licenseDb().from("orbitfs_deployment_operations").insert(row).select().single();
  if(created.error){
    if(String((created.error as any).code||"")==="23505"){
      const same=await operationByKey(String(install.id),key);
      if(same){
        if(String(same.request_fingerprint)!==requestFingerprint)throw operationError("IDEMPOTENCY_KEY_REUSE","This Idempotency-Key was already used for a different Base lifecycle request.",409,false,String(same.id));
        throw operationError("OPERATION_IN_PROGRESS","This Base lifecycle request is already running.",409,true,String(same.id));
      }
      const active=await activeOperation(String(install.id));
      throw operationError("OPERATION_IN_PROGRESS","Another Base lifecycle operation is already running for this installation.",409,true,active?.id||null);
    }
    throw created.error;
  }
  operation=created.data;

  try{
    operation=await patchOperation(String(operation.id),{state:"authorising"});
    const installation=await runCustomerDeployer(install,action,input.version,input.channel,input.releaseId,input.reason,async(state,detail={})=>{
      const progressPatch:any={state,detail:{...(operation?.detail||{}),...detail}};
      if(detail && typeof detail==="object"){
        if("deploymentId" in detail)progressPatch.vercel_deployment_id=(detail as any).deploymentId||null;
        if("projectId" in detail)progressPatch.vercel_project_id=(detail as any).projectId||operation?.vercel_project_id||null;
        if("migrationHeadBefore" in detail)progressPatch.migration_head_before=(detail as any).migrationHeadBefore||null;
        if("migrationHeadAfter" in detail)progressPatch.migration_head_after=(detail as any).migrationHeadAfter||null;
      }
      operation=await patchOperation(String(operation.id),progressPatch);
    });
    operation=await patchOperation(String(operation.id),{
      state:"completed",
      completed_at:new Date().toISOString(),
      vercel_project_id:installation?.vercel_project_id||install.vercel_project_id||null,
      vercel_deployment_id:installation?.vercel_deployment_id||null,
      result:{
        installationId:installation?.installation_id||install.installation_id||null,
        releaseId:installation?.release_id||null,
        releaseVersion:installation?.release_version||null,
        projectId:installation?.vercel_project_id||null,
        deploymentId:installation?.vercel_deployment_id||null
      }
    });
    return {operation,installation,replayed:false};
  }catch(error:any){
    const code=String(error?.code||"BASE_OPERATION_FAILED");
    const detail=String(error?.message||"Base lifecycle operation failed.");
    try{
      await patchOperation(String(operation.id),{
        state:"failed",
        error_code:code,
        error_detail:detail,
        completed_at:new Date().toISOString(),
        result:{recovery:error?.recovery||null}
      });
    }catch{}
    throw Object.assign(error instanceof Error?error:new Error(detail),{operationId:String(operation.id),code});
  }
}
