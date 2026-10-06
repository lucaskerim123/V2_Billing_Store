export type CanonicalLicenseStatus='pending'|'active'|'locked'|'restricted'|'suspended'|'terminated'|'expired';

const CANONICAL=new Set<CanonicalLicenseStatus>(['pending','active','locked','restricted','suspended','terminated','expired']);

function asStatus(value:unknown){
  return String(value||'').trim().toLowerCase();
}

function enforcementScope(row:any){
  const metadata=row?.metadata&&typeof row.metadata==='object'?row.metadata:{};
  const direct=metadata?.license_enforcement&&typeof metadata.license_enforcement==='object'?metadata.license_enforcement:{};
  return asStatus(row?.enforcement_scope||row?.enforcementScope||direct?.scope);
}

function suspensionReason(row:any){
  return String(row?.suspension_reason||row?.suspensionReason||row?.metadata?.license_enforcement?.reason||'').trim().toLowerCase();
}

function activationsOf(row:any){
  const values=[
    ...(Array.isArray(row?.activations)?row.activations:[]),
    ...(Array.isArray(row?.master_activations)?row.master_activations:[])
  ];
  return values;
}

export function canonicalLicenseStatus(row:any):CanonicalLicenseStatus{
  const explicit=asStatus(
    row?.canonical_status||
    row?.effective_status||
    row?.authoritative_canonical_status||
    row?.authoritative_effective_status
  );
  if(CANONICAL.has(explicit as CanonicalLicenseStatus))return explicit as CanonicalLicenseStatus;

  const authority=asStatus(row?.authoritative_status);
  if(CANONICAL.has(authority as CanonicalLicenseStatus))return authority as CanonicalLicenseStatus;

  const raw=asStatus(row?.storage_status||row?.remote_state||row?.status||row?.desired_state||'pending');
  if(raw==='terminated'||raw==='revoked')return 'terminated';
  if(raw==='expired')return 'expired';
  if(raw==='pending')return 'pending';
  if(raw==='restricted')return 'restricted';
  if(raw==='suspended'){
    const scope=enforcementScope(row);
    const reason=suspensionReason(row);
    return scope==='account'||reason.startsWith('account_enforcement:')?'suspended':'restricted';
  }
  if(raw==='locked')return 'locked';
  if(raw==='active'){
    const bound=activationsOf(row).some((activation:any)=>asStatus(activation?.status||activation?.state)==='active');
    return bound?'locked':'active';
  }
  return 'restricted';
}

export function canonicalAccountStatus(row:any):'active'|'suspended'|'terminated'{
  const raw=asStatus(row?.canonical_status||row?.status);
  if(row?.banned_at||raw==='banned'||raw==='terminated')return 'terminated';
  if(raw==='suspended')return 'suspended';
  return 'active';
}

export function canonicalComponentStatus(row:any,component:string):CanonicalLicenseStatus{
  const key=String(component||'').trim().toLowerCase();
  const explicit=row?.component_states?.[key]?.status||row?.authoritative_component_states?.[key]?.status;
  if(CANONICAL.has(asStatus(explicit) as CanonicalLicenseStatus))return asStatus(explicit) as CanonicalLicenseStatus;
  const licence=canonicalLicenseStatus(row);
  if(['pending','restricted','suspended','terminated','expired'].includes(licence))return licence;
  const components=row?.authoritative_components||row?.components||row?.metadata?.license_policy?.components||{};
  const entitled=key==='orbitfs_base'||components?.[key]===true||components?.[key]?.allowed===true;
  return entitled?licence:'restricted';
}

export function isCanonicalLicenseUsable(row:any){
  const status=typeof row==='string'?asStatus(row):canonicalLicenseStatus(row);
  return status==='active'||status==='locked';
}

export function canonicalStatusLabel(status:CanonicalLicenseStatus|string){
  const value=asStatus(status)||'pending';
  return value.charAt(0).toUpperCase()+value.slice(1);
}
