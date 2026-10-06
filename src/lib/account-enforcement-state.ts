export type CanonicalAccountEnforcementState="active"|"suspended"|"terminated";

export function normalizeAccountEnforcementState(value:unknown):CanonicalAccountEnforcementState{
  const state=String(value||"").trim().toLowerCase();
  if(state==="active")return "active";
  if(state==="terminated"||state==="banned")return "terminated";
  return "suspended";
}

export function licenseControlForAccountEnforcement(state:CanonicalAccountEnforcementState|string,reason:string){
  const normalized=normalizeAccountEnforcementState(state);
  const cleanReason=String(reason||"").trim();
  if(normalized==="active")return {action:"activate",queueAction:"unblock",expectedStorageStatus:"active"} as const;
  if(normalized==="terminated")return {
    action:"terminate",
    reason:"account_enforcement:terminated:"+(cleanReason||"account terminated"),
    queueAction:"block",
    expectedStorageStatus:"revoked"
  } as const;
  return {
    action:"suspend",
    scope:"account",
    reason:"account_enforcement:suspended:"+(cleanReason||"account suspended"),
    queueAction:"block",
    expectedStorageStatus:"suspended"
  } as const;
}

export function accountEnforcementRemoteSatisfied(binding:any){
  const desired=String(binding?.desired||binding?.desired_state||"").trim().toLowerCase();
  const remote=String(binding?.remote||binding?.remote_state||"").trim().toLowerCase();
  const reason=String(binding?.reason||binding?.suspension_reason||"").trim().toLowerCase();
  return desired==="suspended"&&remote==="revoked"&&(
    reason.startsWith("account_enforcement:banned:")||
    reason.startsWith("account_enforcement:terminated:")
  );
}

export function canReactivateAccountEnforcement(state:CanonicalAccountEnforcementState|string){
  return normalizeAccountEnforcementState(state)==="suspended";
}

export function accountEnforcementAllowsExpiry(state:CanonicalAccountEnforcementState|string){
  return normalizeAccountEnforcementState(state)==="suspended";
}
