import {licenseDb} from "@/lib/license-api";
import {masterControl} from "@/lib/master-api";
import {licenseControlForAccountEnforcement,normalizeAccountEnforcementState,type CanonicalAccountEnforcementState} from "@/lib/account-enforcement-state";

function storageStatus(result:any,fallback:string){
  return String(
    result?.license?.storage_status||
    result?.storage_status||
    result?.licence?.storage_status||
    result?.binding?.storage_status||
    result?.license?.status||
    result?.status||
    result?.licence?.status||
    result?.binding?.status||
    fallback
  ).trim().toLowerCase();
}

export async function syncAccountEnforcementNow(input:{
  authUserId:string;
  state:CanonicalAccountEnforcementState|string;
  reason?:string|null;
  actorRef:string;
}){
  const authUserId=String(input.authUserId||"").trim();
  if(!authUserId)throw new Error("Customer account id is required");
  const state=normalizeAccountEnforcementState(input.state);
  const plan=licenseControlForAccountEnforcement(state,String(input.reason||""));
  const db=licenseDb();
  const query=await db.from("license_bindings")
    .select("id,license_id,desired_state,remote_state,suspension_reason,api_source,archived_at")
    .eq("auth_user_id",authUserId)
    .is("archived_at",null);
  if(query.error)throw query.error;

  const results:any[]=[];
  const failures:any[]=[];
  const skipped:any[]=[];

  for(const binding of query.data||[]){
    const bindingId=String(binding.id||"").trim();
    const licenseId=String(binding.license_id||"").trim();
    if(!bindingId||!licenseId||String(binding.api_source||"").toLowerCase()==="website"){
      skipped.push({bindingId:bindingId||null,licenseId:licenseId||null,reason:!licenseId?"missing_license_id":"non_master_binding"});
      continue;
    }

    try{
      const control:any={action:plan.action,actorRef:input.actorRef};
      if("scope" in plan)control.scope=plan.scope;
      if("reason" in plan)control.reason=plan.reason;
      const remote=await masterControl(licenseId,control);
      const confirmed=storageStatus(remote,plan.expectedStorageStatus);
      if(confirmed!==plan.expectedStorageStatus){
        throw new Error("License Manager returned storage state "+confirmed+" while Billing expected "+plan.expectedStorageStatus);
      }

      const now=new Date().toISOString();
      const write=await db.from("license_bindings").update({
        remote_state:confirmed,
        last_synced_at:now,
        last_sync_error:null,
        updated_at:now
      }).eq("id",bindingId);
      if(write.error)throw write.error;

      const queueWrite=await db.from("license_enforcement_queue").update({
        state:"cancelled",
        finished_at:now,
        last_error:null
      }).eq("binding_id",bindingId)
        .eq("source","account_enforcement")
        .eq("action",plan.queueAction)
        .in("state",["queued","running"]);
      results.push({
        bindingId,
        licenseId,
        action:plan.action,
        remoteState:confirmed,
        queueCleared:!queueWrite.error,
        queueWarning:queueWrite.error?.message||null
      });
    }catch(error:any){
      const message=String(error?.message||error).slice(0,1000);
      await db.from("license_bindings").update({last_sync_error:message,updated_at:new Date().toISOString()}).eq("id",bindingId);
      await db.from("license_enforcement_queue").update({last_error:message})
        .eq("binding_id",bindingId)
        .eq("source","account_enforcement")
        .eq("action",plan.queueAction)
        .in("state",["queued","running"]);
      failures.push({bindingId,licenseId,error:message});
    }
  }

  return {
    ok:failures.length===0,
    state,
    processed:results.length,
    failed:failures.length,
    skipped:skipped.length,
    results,
    failures,
    skippedBindings:skipped
  };
}
