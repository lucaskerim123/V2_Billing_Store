import {createHash,randomBytes} from "node:crypto";
import {errorMessage} from "@/lib/error-message";
import {gunzipSync} from "node:zlib";
import {licenseDb} from "@/lib/license-api";
import {serviceRpc,userFromToken,userRpc} from "@/lib/paymentServer";
import {masterDownloadReleaseArtifact,masterReleases} from "@/lib/master-api";
import {requireLicenseMasterForDeployment,requireLicenseMasterForMutation} from "@/lib/license-master-availability";

const SUPABASE_API="https://api.supabase.com/v1";
const VERCEL_API="https://api.vercel.com";
const SCHEMA_MAX_BYTES=8*1024*1024;

export type DeployAction="deploy"|"base_update"|"update"|"rollback"|"redeploy";

export function bearer(req:Request){return String(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim()}
export async function requireOrbitUser(req:Request){const token=bearer(req);if(!token)throw Object.assign(new Error("Authentication required"),{status:401});const user=await userFromToken(token);return {token,user}}
export async function requireOrbitAdmin(req:Request){const auth=await requireOrbitUser(req);const ok=await userRpc(auth.token,"has_permission",{p_permission:"licenses.view"});if(ok!==true)throw Object.assign(new Error("Permission denied"),{status:403});return auth}
export function httpError(error:any){const status=Number(error?.status)||500,message=errorMessage(error?.message??error,"Request failed"),code=String(error?.code||(status===401?"UNAUTHENTICATED":status===403?"FORBIDDEN":status===404?"NOT_FOUND":status===409?"CONFLICT":status>=500?"SERVICE_UNAVAILABLE":"REQUEST_FAILED"));return Response.json({error:message,code,operationId:error?.operationId||null,retryable:Boolean(error?.retryable??status>=500)},{status})}

function storeSupabaseRef(){
  try{return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||"").hostname.split(".")[0]||""}catch{return ""}
}
function assertCustomerSupabaseRef(ref:string){
  const storeRef=storeSupabaseRef();
  if(storeRef&&ref===storeRef)throw Object.assign(new Error("The OrbitFS Store database cannot be used as a customer OrbitFS database"),{status:403});
}
function smartRegionCode(value:string){
  const v=String(value||"").trim().toLowerCase();
  if(v==="americas"||v==="emea"||v==="apac")return v;
  if(/^(ap-|asia|au|australia|sg|jp|kr|in|oc|oceania)/.test(v))return "apac";
  if(/^(eu-|europe|uk|gb|me|middle|af|africa)/.test(v))return "emea";
  return "americas";
}

export async function billingOrbitfsConfig(){
  const {data,error}=await licenseDb().from("orbitfs_release_system_settings")
    .select("enabled,maintenance_mode,maintenance_message,customer_deploy_enabled,customer_updates_enabled,customer_rollbacks_enabled,allow_existing_supabase_project,allow_create_supabase_project,supabase_oauth_enabled,vercel_oauth_enabled,supabase_client_id,vercel_client_id,default_supabase_region,panel_project_prefix,health_path,schema_version")
    .eq("id","primary").single();
  if(error)throw error;
  return data;
}
export async function requireSystem(capability:"deploy"|"base_update"|"update"|"rollback"="deploy"){
  const config=await billingOrbitfsConfig();
  if(config.enabled===false)throw Object.assign(new Error("Billing Store customer deployment control is disabled"),{status:503});
  if(config.maintenance_mode===true)throw Object.assign(new Error(config.maintenance_message||"OrbitFS deployment maintenance is active"),{status:503});
  const allowed=capability==="base_update"
    ?config.customer_deploy_enabled!==false&&config.customer_updates_enabled!==false
    :capability==="update"
      ?config.customer_updates_enabled!==false
      :capability==="rollback"
        ?config.customer_rollbacks_enabled!==false
        :config.customer_deploy_enabled!==false;
  if(!allowed)throw Object.assign(new Error(`Billing Store has disabled customer ${capability.replace("_"," ")} operations`),{status:503});
  await requireLicenseMasterForDeployment(capability==="base_update"?"deploy":capability);
  return config;
}
export async function requireSetupSystem(){
  const config=await billingOrbitfsConfig();
  if(config.enabled===false)throw Object.assign(new Error("Billing Store OrbitFS system is disabled"),{status:503});
  if(config.maintenance_mode===true)throw Object.assign(new Error(config.maintenance_message||"OrbitFS deployment maintenance is active"),{status:503});
  await requireLicenseMasterForMutation();
  return config;
}

export async function loadInstallation(id:string,userId:string,allowAdmin=false){
  const db=licenseDb();const {data,error}=await db.from("orbitfs_installations").select("*").eq("id",id).single();
  if(error||!data)throw Object.assign(new Error("OrbitFS installation not found"),{status:404});
  if(data.auth_user_id!==userId&&!allowAdmin)throw Object.assign(new Error("Permission denied"),{status:403});
  return data;
}
export async function event(install:any,type:string,status="info",message="",detail:any={}){await licenseDb().from("orbitfs_deployment_events").insert({installation_id:install.id,auth_user_id:install.auth_user_id,event_type:type,status,message,detail})}


type DatabaseRuntimeAccessContract={
  version:1;
  schema:string;
  publishableRole:string;
  authenticatedRole:string;
  serviceRole:string;
  publicReadTables:string[];
  authenticatedReadTables:string[];
  serverFullAccessTables:string[];
  restPreflightTables:string[];
  serverPreflightTables:string[];
  runtimeSecretHeader:"x-orbitfs-secret";
  runtimeSecretRoles:string[];
  runtimeSecretTablePrefixes:string[];
  runtimeSecretExcludedTables:string[];
  runtimeSecretPreflightTables:string[];
  runtimeSecretRepairRpc:"orbitfs_repair_runtime_access";
  runtimeSecretProbeTable:"orbitfs_runtime_secret_probe";
  legacyCompatibility:boolean;
};
function runtimeAccessTables(value:any,label:string){
  const tables=(Array.isArray(value)?value:[]).map((item:any)=>String(item||"").trim()).filter(Boolean);
  if(!tables.length||tables.some((table:string)=>!/^[a-z_][a-z0-9_]*$/.test(table)))throw Object.assign(new Error(`Base release has an invalid ${label} runtime-access table list`),{status:422,code:"BASE_DATABASE_RUNTIME_ACCESS_INVALID"});
  return [...new Set(tables)];
}
function runtimeAccessPrefixes(value:any,label:string){
  const prefixes=(Array.isArray(value)?value:[]).map((item:any)=>String(item||"").trim()).filter(Boolean);
  if(!prefixes.length||prefixes.some((prefix:string)=>!/^[a-z_][a-z0-9_]*$/.test(prefix)))throw Object.assign(new Error(`Base release has an invalid ${label} runtime-access prefix list`),{status:422,code:"BASE_DATABASE_RUNTIME_ACCESS_INVALID"});
  return [...new Set(prefixes)];
}
function sqlLiteral(value:string){return "'"+value.replaceAll("'","''")+"'"}
function databaseRuntimeAccessContract(release:any):DatabaseRuntimeAccessContract{
  const raw=release?.manifest?.databaseRuntimeAccess;
  if(!(raw&&typeof raw==="object"&&!Array.isArray(raw)))throw Object.assign(new Error("License Manager did not provide the authoritative Base database runtime-access contract"),{status:502,code:"BASE_DATABASE_RUNTIME_ACCESS_MISSING"});
  const legacyCompatibility=false;
  const source=raw;
  const schema=String(source.schema||"").trim(),publishableRole=String(source.publishableRole||"").trim(),authenticatedRole=String(source.authenticatedRole||"").trim(),serviceRole=String(source.serviceRole||"").trim();
  if(Number(source.version)!==1||schema!=="public"||publishableRole!=="anon"||authenticatedRole!=="authenticated"||serviceRole!=="service_role")throw Object.assign(new Error("Base release runtime-access contract is invalid"),{status:422,code:"BASE_DATABASE_RUNTIME_ACCESS_INVALID"});
  const publicReadTables=runtimeAccessTables(source.publicReadTables,"public-read");
  const authenticatedReadTables=runtimeAccessTables(source.authenticatedReadTables,"authenticated-read");
  const serverFullAccessTables=runtimeAccessTables(source.serverFullAccessTables,"server-full-access");
  const restPreflightTables=runtimeAccessTables(source.restPreflightTables,"REST-preflight");
  const serverPreflightTables=runtimeAccessTables(source.serverPreflightTables,"server-REST-preflight");
  const runtimeSecretHeader=String(source.runtimeSecretHeader||"").trim();
  const runtimeSecretRoles=runtimeAccessTables(source.runtimeSecretRoles,"runtime-secret-role");
  const runtimeSecretTablePrefixes=runtimeAccessPrefixes(source.runtimeSecretTablePrefixes,"runtime-secret-table");
  const runtimeSecretExcludedTables=runtimeAccessTables(source.runtimeSecretExcludedTables,"runtime-secret-excluded");
  const runtimeSecretPreflightTables=runtimeAccessTables(source.runtimeSecretPreflightTables,"runtime-secret-preflight");
  const runtimeSecretRepairRpc=String(source.runtimeSecretRepairRpc||"").trim();
  const runtimeSecretProbeTable=String(source.runtimeSecretProbeTable||"").trim();
  if(restPreflightTables.some((table)=>!publicReadTables.includes(table)))throw Object.assign(new Error("Base release REST preflight tables must be included in public-read access"),{status:422,code:"BASE_DATABASE_RUNTIME_ACCESS_INVALID"});
  if(serverPreflightTables.some((table)=>!serverFullAccessTables.includes(table)))throw Object.assign(new Error("Base release server preflight tables must be included in server full access"),{status:422,code:"BASE_DATABASE_RUNTIME_ACCESS_INVALID"});
  if(runtimeSecretHeader!=="x-orbitfs-secret"||runtimeSecretRepairRpc!=="orbitfs_repair_runtime_access"||runtimeSecretProbeTable!=="orbitfs_runtime_secret_probe"||!["anon","authenticated"].every((role)=>runtimeSecretRoles.includes(role)))throw Object.assign(new Error("Base release runtime-secret access contract is invalid"),{status:422,code:"BASE_DATABASE_RUNTIME_ACCESS_INVALID"});
  if(publicReadTables.some((table)=>!authenticatedReadTables.includes(table)))throw Object.assign(new Error("Base release public-read tables must also be authenticated-readable"),{status:422,code:"BASE_DATABASE_RUNTIME_ACCESS_INVALID"});
  if(authenticatedReadTables.length!==publicReadTables.length||authenticatedReadTables.some((table)=>!publicReadTables.includes(table)))throw Object.assign(new Error("Base release runtime access contract v1 requires public/authenticated read tables to match"),{status:422,code:"BASE_DATABASE_RUNTIME_ACCESS_INVALID"});
  if(runtimeSecretPreflightTables.some((table)=>runtimeSecretExcludedTables.includes(table)||!runtimeSecretTablePrefixes.some((prefix)=>table.startsWith(prefix))))throw Object.assign(new Error("Base release runtime-secret preflight tables are outside the permitted runtime table prefixes"),{status:422,code:"BASE_DATABASE_RUNTIME_ACCESS_INVALID"});
  if([...new Set([...publicReadTables,...authenticatedReadTables])].some((table)=>runtimeSecretExcludedTables.includes(table)||!runtimeSecretTablePrefixes.some((prefix)=>table.startsWith(prefix))))throw Object.assign(new Error("Base release runtime-readable tables are outside the permitted runtime table prefixes"),{status:422,code:"BASE_DATABASE_RUNTIME_ACCESS_INVALID"});
  if(!runtimeSecretExcludedTables.includes(runtimeSecretProbeTable)||!runtimeSecretTablePrefixes.some((prefix)=>runtimeSecretProbeTable.startsWith(prefix)))throw Object.assign(new Error("Base release runtime-secret probe table must be inside the runtime namespace and excluded from generic DML repair"),{status:422,code:"BASE_DATABASE_RUNTIME_ACCESS_INVALID"});
  return {version:1,schema,publishableRole,authenticatedRole,serviceRole,publicReadTables,authenticatedReadTables,serverFullAccessTables,restPreflightTables,serverPreflightTables,runtimeSecretHeader:"x-orbitfs-secret",runtimeSecretRoles,runtimeSecretTablePrefixes,runtimeSecretExcludedTables,runtimeSecretPreflightTables,runtimeSecretRepairRpc:"orbitfs_repair_runtime_access",runtimeSecretProbeTable:"orbitfs_runtime_secret_probe",legacyCompatibility};
}
function sqlIdentifier(value:string){return `"${value.replaceAll('"','""')}"`}
function runtimeAccessGrantSql(contract:DatabaseRuntimeAccessContract){
  const schema=sqlIdentifier(contract.schema),service=sqlIdentifier(contract.serviceRole);
  const publishable=sqlIdentifier(contract.publishableRole),authenticated=sqlIdentifier(contract.authenticatedRole);
  const prefixes=`array[${contract.runtimeSecretTablePrefixes.map(sqlLiteral).join(",")}]::text[]`;
  const excluded=`array[${contract.runtimeSecretExcludedTables.map(sqlLiteral).join(",")}]::text[]`;
  const publicRead=`array[${contract.publicReadTables.map(sqlLiteral).join(",")}]::text[]`;
  const secretPredicate="private.orbitfs_server_secret_valid()";
  return [
    `grant usage on schema ${schema} to ${publishable}, ${authenticated}, ${service};`,
    `do $orbitfs_runtime_repair$
declare r record;
declare is_public_read boolean;
begin
  if to_regprocedure('${contract.schema}.${contract.runtimeSecretRepairRpc}(text[],text[],text[])') is not null then
    revoke execute on function ${schema}.${sqlIdentifier(contract.runtimeSecretRepairRpc)}(text[],text[],text[]) from public, ${publishable}, ${authenticated};
    grant execute on function ${schema}.${sqlIdentifier(contract.runtimeSecretRepairRpc)}(text[],text[],text[]) to ${service};
  end if;

  for r in
    select tablename
    from pg_tables
    where schemaname=${sqlLiteral(contract.schema)}
      and exists (select 1 from unnest(${prefixes}) p(prefix) where tablename like p.prefix || '%')
      and not (tablename = any(${excluded}))
  loop
    is_public_read := r.tablename = any(${publicRead});

    execute format('alter table %I.%I enable row level security', ${sqlLiteral(contract.schema)}, r.tablename);
    execute format('grant select, insert, update, delete on table %I.%I to ${contract.publishableRole}, ${contract.authenticatedRole}', ${sqlLiteral(contract.schema)}, r.tablename);

    if is_public_read then
      execute format('drop policy if exists %I on %I.%I', 'orbitfs runtime public read', ${sqlLiteral(contract.schema)}, r.tablename);
      execute format('create policy %I on %I.%I as permissive for select to ${contract.publishableRole}, ${contract.authenticatedRole} using (true)', 'orbitfs runtime public read', ${sqlLiteral(contract.schema)}, r.tablename);

      execute format('drop policy if exists %I on %I.%I', 'orbitfs runtime secret access insert', ${sqlLiteral(contract.schema)}, r.tablename);
      execute format('drop policy if exists %I on %I.%I', 'orbitfs runtime secret required insert', ${sqlLiteral(contract.schema)}, r.tablename);
      execute format('create policy %I on %I.%I as permissive for insert to ${contract.publishableRole}, ${contract.authenticatedRole} with check (${secretPredicate})', 'orbitfs runtime secret access insert', ${sqlLiteral(contract.schema)}, r.tablename);
      execute format('create policy %I on %I.%I as restrictive for insert to ${contract.publishableRole}, ${contract.authenticatedRole} with check (${secretPredicate})', 'orbitfs runtime secret required insert', ${sqlLiteral(contract.schema)}, r.tablename);

      execute format('drop policy if exists %I on %I.%I', 'orbitfs runtime secret access update', ${sqlLiteral(contract.schema)}, r.tablename);
      execute format('drop policy if exists %I on %I.%I', 'orbitfs runtime secret required update', ${sqlLiteral(contract.schema)}, r.tablename);
      execute format('create policy %I on %I.%I as permissive for update to ${contract.publishableRole}, ${contract.authenticatedRole} using (${secretPredicate}) with check (${secretPredicate})', 'orbitfs runtime secret access update', ${sqlLiteral(contract.schema)}, r.tablename);
      execute format('create policy %I on %I.%I as restrictive for update to ${contract.publishableRole}, ${contract.authenticatedRole} using (${secretPredicate}) with check (${secretPredicate})', 'orbitfs runtime secret required update', ${sqlLiteral(contract.schema)}, r.tablename);

      execute format('drop policy if exists %I on %I.%I', 'orbitfs runtime secret access delete', ${sqlLiteral(contract.schema)}, r.tablename);
      execute format('drop policy if exists %I on %I.%I', 'orbitfs runtime secret required delete', ${sqlLiteral(contract.schema)}, r.tablename);
      execute format('create policy %I on %I.%I as permissive for delete to ${contract.publishableRole}, ${contract.authenticatedRole} using (${secretPredicate})', 'orbitfs runtime secret access delete', ${sqlLiteral(contract.schema)}, r.tablename);
      execute format('create policy %I on %I.%I as restrictive for delete to ${contract.publishableRole}, ${contract.authenticatedRole} using (${secretPredicate})', 'orbitfs runtime secret required delete', ${sqlLiteral(contract.schema)}, r.tablename);
    else
      execute format('drop policy if exists %I on %I.%I', 'orbitfs runtime secret access', ${sqlLiteral(contract.schema)}, r.tablename);
      execute format('drop policy if exists %I on %I.%I', 'orbitfs runtime secret required', ${sqlLiteral(contract.schema)}, r.tablename);
      execute format('create policy %I on %I.%I as permissive for all to ${contract.publishableRole}, ${contract.authenticatedRole} using (${secretPredicate}) with check (${secretPredicate})', 'orbitfs runtime secret access', ${sqlLiteral(contract.schema)}, r.tablename);
      execute format('create policy %I on %I.%I as restrictive for all to ${contract.publishableRole}, ${contract.authenticatedRole} using (${secretPredicate}) with check (${secretPredicate})', 'orbitfs runtime secret required', ${sqlLiteral(contract.schema)}, r.tablename);
    end if;
  end loop;
end
$orbitfs_runtime_repair$;`,
    ...contract.publicReadTables.map((table)=>`grant select on table ${schema}.${sqlIdentifier(table)} to ${publishable}, ${authenticated};`),
    ...contract.serverFullAccessTables.map((table)=>`grant all privileges on table ${schema}.${sqlIdentifier(table)} to ${service};`),
    `do $orbitfs_sequence_grants$
declare r record;
begin
  for r in
    select distinct seq.relname as sequence_name
    from pg_class seq
    join pg_namespace sn on sn.oid=seq.relnamespace
    join pg_depend d on d.objid=seq.oid and d.deptype in ('a','i')
    join pg_class tbl on tbl.oid=d.refobjid
    join pg_namespace tn on tn.oid=tbl.relnamespace
    where sn.nspname=${sqlLiteral(contract.schema)}
      and tn.nspname=${sqlLiteral(contract.schema)}
      and seq.relkind='S'
      and exists (select 1 from unnest(${prefixes}) p(prefix) where tbl.relname like p.prefix || '%')
      and not (tbl.relname = any(${excluded}))
  loop
    execute format('grant usage, select, update on sequence %I.%I to ${contract.serviceRole}', ${sqlLiteral(contract.schema)}, r.sequence_name);
  end loop;
end
$orbitfs_sequence_grants$;`
  ].join("\n");
}
async function databaseRestPreflight(install:any,key:string,tables:string[],credential:string,extraHeaders:Record<string,string>={}){
  for(const table of tables){
    const url=new URL(`https://${install.supabase_project_ref}.supabase.co/rest/v1/${table}`);
    url.searchParams.set("select","*");
    url.searchParams.set("limit","1");
    const response=await fetch(url,{headers:{apikey:key,accept:"application/json",...extraHeaders},cache:"no-store"});
    if(!response.ok){
      const detail=(await response.text()).slice(0,500);
      const code=response.status===401||response.status===403
        ?(credential.includes("publishable")?"CUSTOMER_SUPABASE_PUBLISHABLE_KEY_REJECTED":"CUSTOMER_SUPABASE_SERVER_KEY_REJECTED")
        :"CUSTOMER_DATABASE_RUNTIME_ACCESS_FAILED";
      throw Object.assign(new Error(`Customer Supabase ${credential} preflight failed for ${table} (HTTP ${response.status}): ${detail}`),{status:502,code});
    }
  }
}
async function databaseRuntimeSecretProbe(install:any,key:string,contract:DatabaseRuntimeAccessContract,dbSecret:string){
  const url=new URL(`https://${install.supabase_project_ref}.supabase.co/rest/v1/${encodeURIComponent(contract.runtimeSecretProbeTable)}`);
  url.searchParams.set("select","probe_key,contract_version");
  url.searchParams.set("probe_key","eq.runtime");
  url.searchParams.set("limit","1");
  const response=await fetch(url,{headers:{apikey:key,accept:"application/json",[contract.runtimeSecretHeader]:dbSecret},cache:"no-store"});
  const body:any=await response.json().catch(()=>null);
  if(!response.ok){
    const detail=body&&typeof body==="object"?String(body.message||body.error_description||body.error||"").slice(0,500):"";
    throw Object.assign(new Error(`Customer Supabase runtime-secret probe failed (HTTP ${response.status})${detail?`: ${detail}`:""}`),{status:502,code:"CUSTOMER_DATABASE_RUNTIME_SECRET_FAILED"});
  }
  if(!Array.isArray(body)||body.length!==1||body[0]?.probe_key!=="runtime"||Number(body[0]?.contract_version)!==1)throw Object.assign(new Error("Customer Supabase did not accept the OrbitFS database runtime secret"),{status:502,code:"CUSTOMER_DATABASE_RUNTIME_SECRET_FAILED"});
}
async function verifyDatabaseRuntimeAccess(install:any,contract:DatabaseRuntimeAccessContract,source:string){
  const checks:{key:string;expr:string}[]=[
    {key:"runtime_repair_rpc_service_only",expr:`to_regprocedure('${contract.schema}.${contract.runtimeSecretRepairRpc}(text[],text[],text[])') is not null and has_function_privilege('${contract.serviceRole}','${contract.schema}.${contract.runtimeSecretRepairRpc}(text[],text[],text[])','EXECUTE') and not has_function_privilege('${contract.publishableRole}','${contract.schema}.${contract.runtimeSecretRepairRpc}(text[],text[],text[])','EXECUTE') and not has_function_privilege('${contract.authenticatedRole}','${contract.schema}.${contract.runtimeSecretRepairRpc}(text[],text[],text[])','EXECUTE')`},
    {key:"runtime_probe_table_restricted",expr:`to_regclass('${contract.schema}.${contract.runtimeSecretProbeTable}') is not null and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='${contract.schema}' and c.relname='${contract.runtimeSecretProbeTable}' and c.relrowsecurity) and has_table_privilege('${contract.publishableRole}','${contract.schema}.${contract.runtimeSecretProbeTable}','SELECT') and has_table_privilege('${contract.authenticatedRole}','${contract.schema}.${contract.runtimeSecretProbeTable}','SELECT') and not has_table_privilege('${contract.publishableRole}','${contract.schema}.${contract.runtimeSecretProbeTable}','INSERT') and not has_table_privilege('${contract.publishableRole}','${contract.schema}.${contract.runtimeSecretProbeTable}','UPDATE') and not has_table_privilege('${contract.publishableRole}','${contract.schema}.${contract.runtimeSecretProbeTable}','DELETE') and not has_table_privilege('${contract.authenticatedRole}','${contract.schema}.${contract.runtimeSecretProbeTable}','INSERT') and not has_table_privilege('${contract.authenticatedRole}','${contract.schema}.${contract.runtimeSecretProbeTable}','UPDATE') and not has_table_privilege('${contract.authenticatedRole}','${contract.schema}.${contract.runtimeSecretProbeTable}','DELETE') and exists(select 1 from pg_policies where schemaname='${contract.schema}' and tablename='${contract.runtimeSecretProbeTable}' and policyname='orbitfs runtime secret probe' and cmd='SELECT')`},
    {key:"publishable_schema_usage",expr:`has_schema_privilege('${contract.publishableRole}','${contract.schema}','USAGE')`},
    {key:"authenticated_schema_usage",expr:`has_schema_privilege('${contract.authenticatedRole}','${contract.schema}','USAGE')`},
    {key:"service_schema_usage",expr:`has_schema_privilege('${contract.serviceRole}','${contract.schema}','USAGE')`}
  ];
  for(const table of contract.publicReadTables)checks.push({key:`publishable_select_${table}`,expr:`has_table_privilege('${contract.publishableRole}','${contract.schema}.${table}','SELECT')`});
  for(const table of contract.authenticatedReadTables)checks.push({key:`authenticated_select_${table}`,expr:`has_table_privilege('${contract.authenticatedRole}','${contract.schema}.${table}','SELECT')`});
  for(const table of contract.runtimeSecretPreflightTables){
    for(const role of contract.runtimeSecretRoles)for(const privilege of ["SELECT","INSERT","UPDATE","DELETE"])checks.push({key:`runtime_${role}_${privilege.toLowerCase()}_${table}`,expr:`has_table_privilege('${role}','${contract.schema}.${table}','${privilege}')`});
    checks.push({key:`runtime_rls_${table}`,expr:`exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='${contract.schema}' and c.relname='${table}' and c.relrowsecurity)`});
    if(contract.publicReadTables.includes(table)){
      checks.push({key:`runtime_public_read_${table}`,expr:`exists(select 1 from pg_policies where schemaname='${contract.schema}' and tablename='${table}' and policyname='orbitfs runtime public read' and permissive='PERMISSIVE' and cmd='SELECT')`});
      for(const action of ["INSERT","UPDATE","DELETE"])checks.push({key:`runtime_secret_${action.toLowerCase()}_${table}`,expr:`exists(select 1 from pg_policies where schemaname='${contract.schema}' and tablename='${table}' and policyname='orbitfs runtime secret access ${action.toLowerCase()}' and permissive='PERMISSIVE' and cmd='${action}') and exists(select 1 from pg_policies where schemaname='${contract.schema}' and tablename='${table}' and policyname='orbitfs runtime secret required ${action.toLowerCase()}' and permissive='RESTRICTIVE' and cmd='${action}')`});
    }else{
      checks.push({key:`runtime_secret_policy_${table}`,expr:`exists(select 1 from pg_policies where schemaname='${contract.schema}' and tablename='${table}' and policyname='orbitfs runtime secret access' and permissive='PERMISSIVE' and cmd='ALL') and exists(select 1 from pg_policies where schemaname='${contract.schema}' and tablename='${table}' and policyname='orbitfs runtime secret required' and permissive='RESTRICTIVE' and cmd='ALL')`});
    }
  }
  for(const table of contract.serverFullAccessTables){
    for(const privilege of ["SELECT","INSERT","UPDATE","DELETE"])checks.push({key:`service_${privilege.toLowerCase()}_${table}`,expr:`has_table_privilege('${contract.serviceRole}','${contract.schema}.${table}','${privilege}')`});
  }
  checks.push({key:"service_sequence_usage",expr:`not exists(
    select 1
    from pg_class seq
    join pg_namespace sn on sn.oid=seq.relnamespace
    join pg_depend d on d.objid=seq.oid and d.deptype in ('a','i')
    join pg_class tbl on tbl.oid=d.refobjid
    join pg_namespace tn on tn.oid=tbl.relnamespace
    where sn.nspname='${contract.schema}'
      and tn.nspname='${contract.schema}'
      and seq.relkind='S'
      and exists (
        select 1
        from unnest(array[${contract.runtimeSecretTablePrefixes.map(sqlLiteral).join(",")}]::text[]) p(prefix)
        where tbl.relname like p.prefix || '%'
      )
      and not (tbl.relname = any(array[${contract.runtimeSecretExcludedTables.map(sqlLiteral).join(",")}]::text[]))
      and not has_sequence_privilege('${contract.serviceRole}',format('%I.%I',sn.nspname,seq.relname),'USAGE')
  )`});
  const query=`select ${checks.map((check)=>`${check.expr} as ${sqlIdentifier(check.key)}`).join(",\n")};`;
  const verification=await supabaseApi(install.auth_user_id,`/projects/${install.supabase_project_ref}/database/query`,{method:"POST",body:JSON.stringify({query})});
  const row=Array.isArray(verification)?verification[0]:verification?.data?.[0]||verification?.result?.[0]||verification;
  const failed=checks.filter((check)=>row?.[check.key]!==true).map((check)=>check.key);
  if(failed.length)throw Object.assign(new Error(`Customer Supabase runtime-access verification failed: ${failed.join(", ")}`),{status:502,code:"CUSTOMER_DATABASE_RUNTIME_ACCESS_FAILED"});
  const publishable=await publishableKey(install);
  await databaseRestPreflight(install,publishable,contract.restPreflightTables,"publishable-key");
  const dbSecret=String(await installationSecret(install.id,"db_secret")||"").trim();
  if(!dbSecret)throw Object.assign(new Error("OrbitFS database secret is missing for runtime-secret preflight"),{status:409,code:"CUSTOMER_DATABASE_RUNTIME_SECRET_MISSING"});
  await databaseRuntimeSecretProbe(install,publishable,contract,dbSecret);
  await databaseRestPreflight(install,publishable,contract.runtimeSecretPreflightTables,"publishable-key + runtime-secret",{[contract.runtimeSecretHeader]:dbSecret});
  const server=await supabaseSecretKey(install);
  await databaseRestPreflight(install,server,contract.serverPreflightTables,"server-secret");
  await event(install,"database.runtime_access_verified","ok","Customer Supabase runtime access verified",{source,contractVersion:contract.version,legacyCompatibility:contract.legacyCompatibility,publicReadTables:contract.publicReadTables,authenticatedReadTables:contract.authenticatedReadTables,serverFullAccessTables:contract.serverFullAccessTables,restPreflightTables:contract.restPreflightTables,serverPreflightTables:contract.serverPreflightTables,runtimeSecretTablePrefixes:contract.runtimeSecretTablePrefixes,runtimeSecretExcludedTables:contract.runtimeSecretExcludedTables,runtimeSecretPreflightTables:contract.runtimeSecretPreflightTables,runtimeSecretProbeTable:contract.runtimeSecretProbeTable});
}
async function repairDatabaseRuntimeAccess(install:any,contract:DatabaseRuntimeAccessContract,source:string){
  await supabaseApi(install.auth_user_id,`/projects/${install.supabase_project_ref}/database/query`,{method:"POST",body:JSON.stringify({query:runtimeAccessGrantSql(contract)})});
  await verifyDatabaseRuntimeAccess(install,contract,`${source}-direct-repair`);
}
async function installationDatabaseRuntimeAccessContract(install:any){
  const channel=String(install.release_channel||"stable").trim().toLowerCase()||"stable";
  // Runtime-access policy is current technical authority, not historical installation identity.
  // License Manager publishes exactly one current Base per channel; old release ids are retained
  // only for deployment history/rollback and must never block repair of a live installation.
  const releaseRows=await masterReleases("orbitfs_base",channel,"base","deployer",true,false);
  const releases=Array.isArray(releaseRows?.releases)?releaseRows.releases:Array.isArray(releaseRows)?releaseRows:[];
  const release=releases.find((item:any)=>
    String(item?.status||"").toLowerCase()==="published"
    &&String(item?.review_status||"").toLowerCase()==="approved"
    &&!item?.archived_at
  )||null;
  if(!release)throw Object.assign(new Error(`License Manager has no current published Base release in ${channel} for runtime-access repair`),{status:409,code:"BASE_CURRENT_RELEASE_NOT_FOUND"});
  return databaseRuntimeAccessContract(release);
}
export async function ensureCustomerDatabaseRuntimeAccess(install:any,source="runtime"){
  const accessContract=await installationDatabaseRuntimeAccessContract(install);
  try{
    await verifyDatabaseRuntimeAccess(install,accessContract,`${source}-preflight`);
    return accessContract;
  }catch(preflightError:any){
    try{
      await repairDatabaseRuntimeAccess(install,accessContract,source);
      return accessContract;
    }catch(repairError:any){
      if(repairError&&typeof repairError==="object"&&!repairError.cause)repairError.cause=preflightError;
      throw repairError;
    }
  }
}


const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
export async function createOAuthState(userId:string,provider:"supabase"|"vercel",installationId:string|null,returnPath="/portal/orbitfs"){
  // A new connection attempt invalidates unfinished attempts for the same customer/provider.
  await licenseDb().from("orbitfs_oauth_states").delete().eq("auth_user_id",userId).eq("provider",provider).is("consumed_at",null);
  const state=randomBytes(32).toString("hex");
  const {error}=await licenseDb().from("orbitfs_oauth_states").insert({state_hash:hash(state),auth_user_id:userId,installation_id:installationId,provider,return_path:returnPath,expires_at:new Date(Date.now()+10*60*1000).toISOString()});
  if(error)throw error;return state;
}
export async function disconnectProviderConnection(userId:string,provider:"supabase"|"vercel"){
  return serviceRpc("service_disconnect_orbitfs_provider_connection",{p_user_id:userId,p_provider:provider});
}
export async function consumeOAuthState(state:string,provider:"supabase"|"vercel"){
  if(!state)throw Object.assign(new Error("Missing OAuth state"),{status:400});const db=licenseDb();
  const {data,error}=await db.from("orbitfs_oauth_states").select("*").eq("state_hash",hash(state)).eq("provider",provider).single();
  if(error||!data||data.consumed_at||new Date(data.expires_at).getTime()<Date.now())throw Object.assign(new Error("OAuth state is invalid or expired"),{status:400});
  await db.from("orbitfs_oauth_states").update({consumed_at:new Date().toISOString()}).eq("state_hash",data.state_hash);return data;
}

async function releaseSecret(key:string){return serviceRpc("service_orbitfs_release_secret",{p_key:key}) as Promise<string|null>}
async function providerSecret(userId:string,provider:string,key:"access_token"|"refresh_token"){return serviceRpc("service_orbitfs_provider_secret",{p_user_id:userId,p_provider:provider,p_key:key}) as Promise<string|null>}
async function installationSecret(id:string,key:"db_secret"|"db_password"){return serviceRpc("service_orbitfs_installation_secret",{p_installation_id:id,p_key:key}) as Promise<string|null>}
async function storeInstallationSecret(id:string,key:"db_secret"|"db_password",value:string){await serviceRpc("service_store_orbitfs_installation_secret",{p_installation_id:id,p_key:key,p_value:value})}

export async function saveProviderConnection(userId:string,provider:"supabase"|"vercel",tokens:any,metadata:any={}){
  const expiry=tokens.expires_in?new Date(Date.now()+Number(tokens.expires_in)*1000).toISOString():tokens.expires_at||null;
  return serviceRpc("service_upsert_orbitfs_provider_connection",{p_user_id:userId,p_provider:provider,p_access_token:String(tokens.access_token||""),p_refresh_token:String(tokens.refresh_token||""),p_expires_at:expiry,p_metadata:metadata});
}
async function connection(userId:string,provider:string){
  const {data,error}=await licenseDb().from("orbitfs_provider_connections").select("*").eq("auth_user_id",userId).eq("provider",provider).maybeSingle();
  if(error)throw Object.assign(new Error(`Could not read ${provider} connection: ${error.message}`),{status:500});
  return data;
}

async function supabaseAccessToken(userId:string){
  const conn=await connection(userId,"supabase");if(!conn||conn.status!=="connected")throw Object.assign(new Error("Customer Supabase account is not connected"),{status:409});
  let token=await providerSecret(userId,"supabase","access_token");if(!token)throw Object.assign(new Error("Supabase connection token is missing"),{status:409});
  if(conn.token_expires_at&&new Date(conn.token_expires_at).getTime()<Date.now()+60000){
    const refresh=await providerSecret(userId,"supabase","refresh_token"),s=await billingOrbitfsConfig(),secret=await releaseSecret("supabase_client_secret");
    if(!refresh||!s.supabase_client_id||!secret)throw Object.assign(new Error("Supabase connection needs to be reconnected"),{status:409});
    const form=new URLSearchParams({grant_type:"refresh_token",refresh_token:refresh});
    const basic=Buffer.from(`${s.supabase_client_id}:${secret}`).toString("base64");
    const r=await fetch("https://api.supabase.com/v1/oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded",accept:"application/json",authorization:`Basic ${basic}`},body:form});
    if(!r.ok)throw Object.assign(new Error(`Supabase token refresh failed: ${await r.text()}`),{status:502});
    const j=await r.json();await saveProviderConnection(userId,"supabase",j,conn.metadata||{});token=j.access_token;
  }
  return token;
}
export async function supabaseApi(userId:string,path:string,init:RequestInit={}){
  const token=await supabaseAccessToken(userId);const r=await fetch(`${SUPABASE_API}${path}`,{...init,headers:{authorization:`Bearer ${token}`,"content-type":"application/json",...(init.headers||{})}});
  if(!r.ok){const detail=await r.text(),message=`Supabase API ${r.status}: ${detail}`;if(r.status===401||r.status===403)await licenseDb().from("orbitfs_provider_connections").update({status:"error",last_error:message,updated_at:new Date().toISOString()}).eq("auth_user_id",userId).eq("provider","supabase");throw Object.assign(new Error(message),{status:r.status>=500?502:r.status});}return r.status===204?null:r.json();
}

async function vercelAccessToken(userId:string){const conn=await connection(userId,"vercel");if(!conn||conn.status!=="connected")throw Object.assign(new Error("Customer Vercel account is not connected"),{status:409});const token=await providerSecret(userId,"vercel","access_token");if(!token)throw Object.assign(new Error("Vercel connection token is missing"),{status:409});return {token,teamId:conn.team_id||conn.metadata?.team_id||null}}
export async function customerVercelCredentials(userId:string){return vercelAccessToken(userId)}
export async function customerInstallationDbSecret(installationRecordId:string){const secret=String(await installationSecret(installationRecordId,"db_secret")||"").trim();if(!secret)throw Object.assign(new Error("OrbitFS database secret is missing"),{status:409});return secret}
function withTeam(path:string,teamId?:string|null){if(!teamId)return path;const u=new URL(path,VERCEL_API);u.searchParams.set("teamId",teamId);return u.pathname+u.search}
export async function vercelApi(userId:string,path:string,init:RequestInit={}){const {token,teamId}=await vercelAccessToken(userId);const r=await fetch(`${VERCEL_API}${withTeam(path,teamId)}`,{...init,headers:{authorization:`Bearer ${token}`,"content-type":"application/json",...(init.headers||{})}});if(!r.ok){const detail=await r.text(),message=`Vercel API ${r.status}: ${detail}`;if(r.status===401||r.status===403)await licenseDb().from("orbitfs_provider_connections").update({status:"error",last_error:message,updated_at:new Date().toISOString()}).eq("auth_user_id",userId).eq("provider","vercel");throw Object.assign(new Error(message),{status:r.status>=500?502:r.status});}return r.status===204?null:r.json()}

export async function listSupabaseResources(userId:string){
  const [organizations,projects]=await Promise.all([supabaseApi(userId,"/organizations"),supabaseApi(userId,"/projects")]);
  const storeRef=storeSupabaseRef();
  return {organizations:Array.isArray(organizations)?organizations:[],projects:(Array.isArray(projects)?projects:[]).filter((p:any)=>(p.id||p.ref)!==storeRef)};
}
export async function selectSupabaseProject(install:any,ref:string){
  const s=await requireSystem("deploy");if(!s.allow_existing_supabase_project)throw Object.assign(new Error("Existing Supabase projects are disabled by the administrator"),{status:403});
  assertCustomerSupabaseRef(ref);
  const projects=await supabaseApi(install.auth_user_id,"/projects") as any[],p=(projects||[]).find((x:any)=>x.id===ref||x.ref===ref);
  if(!p)throw Object.assign(new Error("Supabase project is not available in the customer's connected account"),{status:404});
  const projectRef=p.id||p.ref;assertCustomerSupabaseRef(projectRef);
  const patch={supabase_project_ref:projectRef,supabase_organization_id:p.organization_id||p.organization?.id||p.organization_slug||null,supabase_project_name:p.name||null,supabase_region:p.region||null,state:"preparing_database",last_error:null};
  const {data,error}=await licenseDb().from("orbitfs_installations").update(patch).eq("id",install.id).select().single();if(error)throw error;await event(data,"supabase.project_selected","ok",`Customer Supabase project ${p.name||ref} selected`);return data;
}
export async function createSupabaseProject(install:any,input:any){
  const s=await requireSystem("deploy");if(!s.allow_create_supabase_project)throw Object.assign(new Error("Creating Supabase projects is disabled by the administrator"),{status:403});
  const org=String(input.organizationSlug||input.organizationId||"").trim(),name=String(input.name||`OrbitFS ${install.installation_id}`).trim();if(!org)throw Object.assign(new Error("Customer Supabase organization is required"),{status:400});
  const password=randomBytes(24).toString("base64url"),region=String(input.region||s.default_supabase_region||"apac"),body={name,organization_slug:org,db_pass:password,region_selection:{type:"smartGroup",code:smartRegionCode(region)}};
  const p=await supabaseApi(install.auth_user_id,"/projects",{method:"POST",body:JSON.stringify(body)}),ref=p.id||p.ref;if(!ref)throw new Error("Supabase did not return a project reference");assertCustomerSupabaseRef(ref);await storeInstallationSecret(install.id,"db_password",password);
  const {data,error}=await licenseDb().from("orbitfs_installations").update({supabase_project_ref:ref,supabase_organization_id:org,supabase_project_name:p.name||name,supabase_region:p.region||smartRegionCode(region),state:"preparing_database",last_error:null}).eq("id",install.id).select().single();if(error)throw error;await event(data,"supabase.project_created","ok",`Customer Supabase project ${p.name||name} created`);return data;
}

async function releaseSchemaText(release:any){
  const manifest=release?.manifest&&typeof release.manifest==="object"?release.manifest:{};
  const expectedSchemaVersion=String(manifest.databaseSchemaVersion||manifest.releaseInfo?.databaseSchemaVersion||"").trim();
  const expectedSchemaHash=String(manifest.databaseSchemaSha256||manifest.releaseInfo?.databaseSchemaSha256||"").trim().toLowerCase();
  const schemaPath=String(manifest.databaseSchemaPath||manifest.releaseInfo?.databaseSchemaPath||"").trim();
  const expectedMigrationCount=Number(manifest.databaseMigrationCount??manifest.releaseInfo?.databaseMigrationCount??0);
  const expectedLatestMigration=String(manifest.databaseLatestMigration||manifest.releaseInfo?.databaseLatestMigration||"").trim();

  if(!expectedSchemaVersion||!/^[a-f0-9]{64}$/.test(expectedSchemaHash)||schemaPath!=="supabase/customer-schema.sql"||!Number.isInteger(expectedMigrationCount)||expectedMigrationCount<1||!/^\d{14}$/.test(expectedLatestMigration)){
    throw Object.assign(new Error(`Published Base release ${release?.version||""} does not contain the verified customer database snapshot required for automatic deployment. Publish a current Base release before initializing a customer database.`),{status:409});
  }

  const artifact=await masterDownloadReleaseArtifact(String(release.id));
  if(artifact.bytes.byteLength>75*1024*1024)throw Object.assign(new Error("Base release artifact is too large"),{status:413});
  const artifactHash=createHash("sha256").update(artifact.bytes).digest("hex");
  const expectedArtifactHash=String(release.sha256||release.checksum||"").trim().toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(expectedArtifactHash)||artifactHash!==expectedArtifactHash)throw Object.assign(new Error("Base release artifact checksum does not match License Manager"),{status:422});

  let pkg:any;
  try{pkg=JSON.parse(gunzipSync(artifact.bytes,{maxOutputLength:SCHEMA_MAX_BYTES*20}).toString("utf8"))}
  catch{throw Object.assign(new Error("Base release artifact could not be unpacked for database initialization"),{status:422})}

  if(pkg?.format!=="orbitfs-base-deployment-v2"||Number(pkg?.schemaVersion)!==2||String(pkg.version||"")!==String(release.version||""))throw Object.assign(new Error("Base release artifact identity is invalid"),{status:422});

  const pkgSchemaVersion=String(pkg.databaseSchemaVersion||pkg.releaseInfo?.databaseSchemaVersion||"").trim();
  const pkgSchemaHash=String(pkg.databaseSchemaSha256||pkg.releaseInfo?.databaseSchemaSha256||"").trim().toLowerCase();
  const pkgSchemaPath=String(pkg.databaseSchemaPath||pkg.releaseInfo?.databaseSchemaPath||"").trim();
  const pkgMigrationCount=Number(pkg.databaseMigrationCount??pkg.releaseInfo?.databaseMigrationCount??0);
  const pkgLatestMigration=String(pkg.databaseLatestMigration||pkg.releaseInfo?.databaseLatestMigration||"").trim();

  if(pkgSchemaVersion!==expectedSchemaVersion||pkgSchemaHash!==expectedSchemaHash||pkgSchemaPath!==schemaPath||pkgMigrationCount!==expectedMigrationCount||pkgLatestMigration!==expectedLatestMigration){
    throw Object.assign(new Error("Base release database snapshot metadata does not match License Manager"),{status:422});
  }

  const file=(Array.isArray(pkg.files)?pkg.files:[]).find((entry:any)=>String(entry?.file||"")===schemaPath);
  if(!file||file.encoding!=="base64"||typeof file.data!=="string")throw Object.assign(new Error("Base release does not contain its declared customer database snapshot"),{status:422});
  const bytes=Buffer.from(file.data,"base64");
  if(bytes.byteLength<1||bytes.byteLength>SCHEMA_MAX_BYTES)throw Object.assign(new Error("Base release customer database snapshot size is invalid"),{status:422});
  const sha256=createHash("sha256").update(bytes).digest("hex");
  if(sha256!==expectedSchemaHash||String(file.sha256||"").toLowerCase()!==sha256||Number(file.size)!==bytes.byteLength)throw Object.assign(new Error("Base release customer database snapshot checksum failed"),{status:422});

  const sql=bytes.toString("utf8");
  if(!["orbitfs_users","orbitfs_workspaces","orbitfs_workspace_members","orbitfs_files","orbitfs_settings","orbitfs_license","orbitfs_addons","orbitfs_audit_log"].every(name=>sql.includes(name)))throw Object.assign(new Error("Base release customer database snapshot is incomplete"),{status:422});
  if(/\b(?:begin|commit|rollback)\s*;/i.test(sql))throw Object.assign(new Error("Base release customer database snapshot contains unsupported explicit transaction control"),{status:422});

  return {sql,sha256,source:"release-artifact" as const,path:schemaPath,schemaVersion:expectedSchemaVersion,migrationCount:expectedMigrationCount,latestMigration:expectedLatestMigration};
}

async function assertSupabaseProjectReady(install:any){
  assertCustomerSupabaseRef(install.supabase_project_ref);
  const health=await supabaseApi(install.auth_user_id,`/projects/${install.supabase_project_ref}/health?services=db`);
  const rows=Array.isArray(health)?health:Array.isArray(health?.services)?health.services:[];
  if(!rows.length)throw Object.assign(new Error("Supabase database health check returned no status. Try again shortly."),{status:409});
  const db=rows.find((x:any)=>String(x?.name||x?.service||"").toLowerCase()==="db")||rows[0];
  if(String(db?.status||"").toUpperCase()!=="ACTIVE_HEALTHY")throw Object.assign(new Error(`Supabase database is still starting (${db?.status||"not ready"}). Try again shortly.`),{status:409});
}
export async function initializeSupabaseDatabase(install:any,releaseId?:string){
  await requireSystem("deploy");if(!install.supabase_project_ref)throw Object.assign(new Error("Choose a customer Supabase project first"),{status:409});
  const channel=String(install.release_channel||"stable"),releaseRows=await masterReleases("orbitfs_base",channel,"base","deployer"),published=(releaseRows?.releases||[]).filter((r:any)=>String(r.status||"").toLowerCase()==="published"&&String(r.review_status||"").toLowerCase()==="approved"),release=releaseId?published.find((r:any)=>String(r.id)===releaseId):published[0];
  if(!release?.id)throw Object.assign(new Error(releaseId?"Selected Base release is no longer published in License Master":"No published Base release is available for this channel"),{status:409});
  if(String(release.channel||channel)!==channel)throw Object.assign(new Error("Selected Base release does not match the installation release channel"),{status:409});
  const accessContract=databaseRuntimeAccessContract(release);
  await assertSupabaseProjectReady(install);
  const releaseSchema=String(release.manifest?.databaseSchemaVersion||release.manifest?.releaseInfo?.databaseSchemaVersion||"").trim();
  if(!releaseSchema)throw Object.assign(new Error(`Published Base release ${release.version} does not declare a customer database schema version. Publish a current Base release before initializing this installation.`),{status:409});
  let schemaAsset;
  try{schemaAsset=await releaseSchemaText(release)}
  catch(error:any){
    const message=String(error?.message||"Base release artifact could not be loaded");
    await licenseDb().from("orbitfs_installations").update({state:"preparing_database",last_error:message,updated_at:new Date().toISOString()}).eq("id",install.id);
    await event(install,"database.release_artifact_failed","error",message,{releaseId:String(release.id),releaseVersion:String(release.version||""),releaseChannel:channel,code:String(error?.code||""),status:Number(error?.status)||null});
    throw error;
  }
  const effectiveSchema=schemaAsset.schemaVersion;
  const rawSql=schemaAsset.sql;
  if(!rawSql.includes("-- OrbitFS Base customer database snapshot"))throw Object.assign(new Error("Published Base database asset is not a generated OrbitFS customer snapshot"),{status:422,code:"BASE_SCHEMA_SNAPSHOT_INVALID"});
  if(!rawSql.includes("20260923135040_profile_state_workspace_scope.sql"))throw Object.assign(new Error("Published Base database snapshot is missing the canonical workspace-scoped profile-state migration"),{status:422,code:"BASE_SCHEMA_PROFILE_SCOPE_MISSING"});
  if(/\bcreate\s+(?:unique\s+)?index\s+concurrently\b/i.test(rawSql)||/\b(?:vacuum|reindex)\b/i.test(rawSql))throw Object.assign(new Error("Published Base database snapshot contains a command that cannot run inside the installer transaction"),{status:422,code:"BASE_SCHEMA_TRANSACTION_UNSAFE"});
  const snapshotConstraintNames=new Set([...rawSql.matchAll(/\badd\s+constraint\s+"?([a-z0-9_]+)"?\s+(?:primary\s+key|unique)\b/ig)].map(match=>String(match[1]||"").toLowerCase()));
  const invalidSequenceTargets=[...new Set([...rawSql.matchAll(/\b(?:pg_catalog\.)?setval\s*\(\s*'([^']+)'\s*(?:::regclass)?/ig)].map(match=>String(match[1]||"").replaceAll('"',"")).filter(target=>{
    const relation=target.split(".").at(-1)?.toLowerCase()||"";
    return relation.endsWith("_pkey")||snapshotConstraintNames.has(relation);
  }))];
  if(invalidSequenceTargets.length)throw Object.assign(new Error(`Published Base database snapshot contains invalid sequence reset target(s): ${invalidSequenceTargets.join(", ")}. Rebuild and republish the Base package; the deployer will not rewrite an immutable release snapshot.`),{status:422,code:"BASE_SCHEMA_SEQUENCE_TARGET_INVALID",invalidSequenceTargets});
  const obsoleteProfileConflict=/on\s+conflict\s*\(\s*workspace_id\s*,\s*user_id\s*\)\s+do\s+nothing/i.test(rawSql);
  const namedUniqueAdds=[...rawSql.matchAll(/alter\s+table\s+([a-z0-9_.]+)\s+add\s+constraint\s+([a-z0-9_]+)\s+unique\s*\(([^;]+)\)\s*;/ig)].length;
  let sql=rawSql.replace(/on\s+conflict\s*\(\s*workspace_id\s*,\s*user_id\s*\)\s+do\s+nothing/ig,"on conflict do nothing");
  sql=sql.replace(/alter\s+table\s+([a-z0-9_.]+)\s+add\s+constraint\s+([a-z0-9_]+)\s+unique\s*\(([^;]+)\)\s*;/ig,(_match,tableName,constraintName,columns)=>{
    const parts=String(tableName).split(".");
    const schemaName=parts.length>1?parts[0]:"public";
    return [
      `alter table ${tableName} drop constraint if exists ${constraintName};`,
      `drop index if exists ${schemaName}.${constraintName};`,
      `alter table ${tableName} add constraint ${constraintName} unique (${String(columns).trim()});`
    ].join("\n");
  });
  await licenseDb().from("orbitfs_installations").update({state:"preparing_database",last_error:null}).eq("id",install.id);
  await event(install,"database.initializing","info",`Initializing customer database from OrbitFS Base ${release.version} release snapshot`,{releaseId:release.id,releaseVersion:release.version,databaseSchemaVersion:effectiveSchema,databaseSchemaSha256:schemaAsset.sha256,databaseMigrationCount:schemaAsset.migrationCount,databaseLatestMigration:schemaAsset.latestMigration});
  let dbSecret=String(await installationSecret(install.id,"db_secret")||"");
  if(!dbSecret){dbSecret=randomBytes(32).toString("hex");await storeInstallationSecret(install.id,"db_secret",dbSecret)}
  const safe=(value:string)=>value.replaceAll("'","''");
  const dbSecretSha256=createHash("sha256").update(dbSecret).digest("hex");
  const baseMigrationId=`base-schema-${effectiveSchema}-${schemaAsset.sha256.slice(0,16)}`;
  const runtimeSql=`insert into private.orbitfs_runtime_secret(id,secret_sha256,updated_at) values (true,'${safe(dbSecretSha256)}',now()) on conflict (id) do update set secret_sha256=excluded.secret_sha256,updated_at=now();
create table if not exists public.orbitfs_schema_migrations (
  migration_id text primary key,
  sha256 text not null,
  component text not null default 'shared',
  source_file text not null,
  release_id text,
  release_version text,
  applied_at timestamptz not null default now()
);
alter table public.orbitfs_schema_migrations enable row level security;
revoke all on public.orbitfs_schema_migrations from anon, authenticated;
grant all on public.orbitfs_schema_migrations to service_role;
insert into public.orbitfs_schema_migrations(migration_id,sha256,component,source_file,release_id,release_version,applied_at)
values ('${safe(baseMigrationId)}','${safe(schemaAsset.sha256)}','shared','${safe(schemaAsset.path)}','${safe(String(release.id))}','${safe(String(release.version))}',now())
on conflict (migration_id) do nothing;
insert into storage.buckets(id,name,public,file_size_limit) values ('orbitfs-files','orbitfs-files',false,1073741824) on conflict (id) do update set name=excluded.name,public=false,file_size_limit=excluded.file_size_limit;\n${runtimeAccessGrantSql(accessContract)}`;
  const legacyRlsCompatPrelude=[
    "do $$",
    "begin",
    "  if to_regprocedure('public.rls_auto_enable()') is null then",
    "    execute 'create function public.rls_auto_enable() returns void language plpgsql as ''begin null; end''';",
    "    comment on function public.rls_auto_enable() is 'orbitfs-snapshot-compat';",
    "  end if;",
    "end",
    "$$;"
  ].join("\n");
  const legacyRlsCompatCleanup=[
    "do $$",
    "begin",
    "  if to_regprocedure('public.rls_auto_enable()') is not null",
    "     and obj_description(to_regprocedure('public.rls_auto_enable()'), 'pg_proc') = 'orbitfs-snapshot-compat' then",
    "    execute 'drop function public.rls_auto_enable()';",
    "  end if;",
    "end",
    "$$;"
  ].join("\n");
  const installSql=`BEGIN;\n${legacyRlsCompatPrelude}\n${sql}\n${legacyRlsCompatCleanup}\n${runtimeSql}\nCOMMIT;`;
  try{
    await supabaseApi(install.auth_user_id,`/projects/${install.supabase_project_ref}/database/query`,{method:"POST",body:JSON.stringify({query:installSql})});
  }catch(e:any){
    const message=String(e?.message||"Database initialization failed");
    await licenseDb().from("orbitfs_installations").update({state:"preparing_database",last_error:message}).eq("id",install.id);
    await event(install,"database.failed","error",message);
    throw e;
  }
  const verification=await supabaseApi(install.auth_user_id,`/projects/${install.supabase_project_ref}/database/query`,{method:"POST",body:JSON.stringify({query:`select
  to_regclass('public.orbitfs_users') is not null as orbitfs_users,
  to_regclass('public.orbitfs_workspaces') is not null as orbitfs_workspaces,
  to_regclass('public.orbitfs_workspace_members') is not null as orbitfs_workspace_members,
  to_regclass('public.orbitfs_files') is not null as orbitfs_files,
  to_regclass('public.orbitfs_settings') is not null as orbitfs_settings,
  to_regclass('public.orbitfs_license') is not null as orbitfs_license,
  to_regclass('public.orbitfs_addons') is not null as orbitfs_addons,
  to_regclass('public.orbitfs_audit_log') is not null as orbitfs_audit_log,
  to_regclass('public.orbitfs_profile_state') is not null as orbitfs_profile_state,
  exists(
    select 1
    from pg_constraint c
    join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public'
      and t.relname='orbitfs_profile_state'
      and c.contype='u'
      and pg_get_constraintdef(c.oid) ~* '^UNIQUE \\(workspace_id\\)$'
  ) as profile_state_workspace_unique,
  not exists(
    select 1
    from public.orbitfs_profile_state
    group by workspace_id
    having count(*) > 1
  ) as profile_state_no_duplicate_workspaces,
  exists(
    select 1
    from public.orbitfs_schema_migrations
    where migration_id='${safe(baseMigrationId)}'
      and sha256='${safe(schemaAsset.sha256)}'
      and release_id='${safe(String(release.id))}'
      and release_version='${safe(String(release.version))}'
  ) as base_migration_recorded,
  to_regclass('private.orbitfs_runtime_secret') is not null as runtime_secret,
  to_regclass('public.orbitfs_schema_migrations') is not null as schema_migrations,
  to_regprocedure('public.rls_auto_enable()') is null as legacy_rls_helper_removed;`})});
  const verificationRow=Array.isArray(verification)?verification[0]:verification?.data?.[0]||verification?.result?.[0]||verification;
  const requiredChecks=["orbitfs_users","orbitfs_workspaces","orbitfs_workspace_members","orbitfs_files","orbitfs_settings","orbitfs_license","orbitfs_addons","orbitfs_audit_log","orbitfs_profile_state","profile_state_workspace_unique","profile_state_no_duplicate_workspaces","base_migration_recorded","runtime_secret","schema_migrations","legacy_rls_helper_removed"];
  const failedChecks=requiredChecks.filter((key)=>verificationRow?.[key]!==true);
  if(failedChecks.length){
    const message=`OrbitFS database verification failed after schema import: ${failedChecks.join(", ")}`;
    await licenseDb().from("orbitfs_installations").update({state:"preparing_database",last_error:message,updated_at:new Date().toISOString()}).eq("id",install.id);
    await event(install,"database.verify_failed","error",message,{failedChecks,releaseId:String(release.id),releaseVersion:String(release.version)});
    throw Object.assign(new Error(message),{status:502});
  }
  try{await verifyDatabaseRuntimeAccess(install,accessContract,"base-initialize")}
  catch(e:any){
    const message=String(e?.message||"Customer Supabase runtime-access verification failed");
    await licenseDb().from("orbitfs_installations").update({state:"preparing_database",last_error:message,updated_at:new Date().toISOString()}).eq("id",install.id);
    await event(install,"database.runtime_access_failed","error",message,{releaseId:String(release.id),releaseVersion:String(release.version),code:String(e?.code||"CUSTOMER_DATABASE_RUNTIME_ACCESS_FAILED")});
    throw e;
  }
  const {data,error}=await licenseDb().from("orbitfs_installations").update({schema_version:effectiveSchema,database_initialized_at:new Date().toISOString(),state:"awaiting_vercel",last_error:null,release_id:String(release.id),release_version:String(release.version),release_sha256:String(release.sha256||release.checksum||""),release_source_commit:release.source_sha||release.source_commit||release.manifest?.sourceCommit||null,release_channel:channel}).eq("id",install.id).select().single();if(error)throw error;
  await event(data,"database.ready","ok",`Customer database initialized and verified with OrbitFS database schema ${effectiveSchema}`,{releaseId:release.id,releaseVersion:release.version,databaseSchemaVersion:effectiveSchema,databaseSchemaSha256:schemaAsset.sha256,databaseSchemaSource:schemaAsset.source,databaseMigrationCount:"migrationCount" in schemaAsset?schemaAsset.migrationCount:null,databaseLatestMigration:"latestMigration" in schemaAsset?schemaAsset.latestMigration:null,baseMigrationId,profileStateConflictCompatibilityApplied:obsoleteProfileConflict,namedUniqueConstraintCompatibilityCount:namedUniqueAdds,runtimeAccessContractVersion:accessContract.version,runtimeAccessLegacyCompatibility:accessContract.legacyCompatibility});
  return data;
}

async function supabaseProjectKeys(install:any){
  assertCustomerSupabaseRef(install.supabase_project_ref);
  const keys=await supabaseApi(install.auth_user_id,`/projects/${install.supabase_project_ref}/api-keys?reveal=true`) as any[];
  return Array.isArray(keys)?keys:[];
}
function supabaseApiKeyValue(key:any){return String(key?.api_key||key?.key||key?.value||"").trim()}
function supabaseApiKeyDisabled(key:any){
  const state=String(key?.status||key?.state||"").trim().toLowerCase();
  return key?.disabled===true||["disabled","revoked","inactive","deleted"].includes(state);
}
function supabaseApiKeyFormat(value:string){
  if(value.startsWith("sb_publishable_"))return "publishable";
  if(value.startsWith("sb_secret_"))return "secret";
  if(value.startsWith("eyJ")&&value.split(".").length===3)return "legacy-jwt";
  return "unknown";
}
function supabaseApiKeyFingerprint(value:string){return createHash("sha256").update(value).digest("hex")}
function supabaseKeyRequestHeaders(value:string){
  const headers:Record<string,string>={apikey:value,accept:"application/json","user-agent":"OrbitFS-Billing-Deployer/1.0"};
  if(value.startsWith("eyJ")&&value.split(".").length===3)headers.authorization=`Bearer ${value}`;
  return headers;
}
const wait=(ms:number)=>new Promise<void>((resolve)=>setTimeout(resolve,ms));
async function probeSupabaseApiKey(install:any,value:string,kind:"publishable"|"server"){
  const ref=String(install?.supabase_project_ref||"").trim();
  assertCustomerSupabaseRef(ref);
  if(!value||supabaseApiKeyFormat(value)==="unknown")return false;
  const url=`https://${ref}.supabase.co/auth/v1/settings`;
  let response:Response;
  try{
    response=await fetch(url,{headers:supabaseKeyRequestHeaders(value),cache:"no-store",signal:AbortSignal.timeout(10000)});
  }catch(error:any){
    throw Object.assign(new Error(`Could not reach customer Supabase while validating the ${kind} API key: ${String(error?.message||error)}`),{status:502,code:"CUSTOMER_SUPABASE_KEY_PROBE_FAILED"});
  }
  if(response.ok)return true;
  if(response.status===401||response.status===403)return false;
  const detail=(await response.text().catch(()=>"")).slice(0,500);
  throw Object.assign(new Error(`Customer Supabase ${kind} API-key validation failed unexpectedly (HTTP ${response.status})${detail?`: ${detail}`:""}`),{status:502,code:"CUSTOMER_SUPABASE_KEY_PROBE_FAILED"});
}
async function firstWorkingSupabaseKey(install:any,keys:any[],kind:"publishable"|"server"){
  const seen=new Set<string>();
  for(const key of keys){
    if(supabaseApiKeyDisabled(key))continue;
    const value=supabaseApiKeyValue(key);
    if(!value||seen.has(value))continue;
    seen.add(value);
    if(await probeSupabaseApiKey(install,value,kind))return value;
  }
  return "";
}
async function createAndValidateSupabaseKey(install:any,type:"publishable"|"secret",kind:"publishable"|"server"){
  const created=await supabaseApi(install.auth_user_id,`/projects/${install.supabase_project_ref}/api-keys?reveal=true`,{
    method:"POST",
    body:JSON.stringify({type,name:`orbitfs-${kind}-${Date.now().toString(36)}`})
  });
  const value=supabaseApiKeyValue(created);
  if(!value)throw Object.assign(new Error(`Supabase created a ${kind} API key but did not return its value`),{status:502,code:"CUSTOMER_SUPABASE_KEY_CREATE_FAILED"});
  for(const delay of [0,250,750,1500,3000]){
    if(delay)await wait(delay);
    if(await probeSupabaseApiKey(install,value,kind))return value;
  }
  throw Object.assign(new Error(`New customer Supabase ${kind} API key was created but did not become usable`),{status:502,code:"CUSTOMER_SUPABASE_KEY_NOT_ACTIVE"});
}
async function publishableKey(install:any){
  const keys=await supabaseProjectKeys(install);
  const candidates=[
    ...keys.filter((x:any)=>x.type==="publishable"),
    ...keys.filter((x:any)=>String(x.name||"").toLowerCase()==="anon"||String(x.type||"").toLowerCase()==="anon"||String(x.role||"").toLowerCase()==="anon")
  ];
  const live=await firstWorkingSupabaseKey(install,candidates,"publishable");
  if(live)return live;
  return createAndValidateSupabaseKey(install,"publishable","publishable");
}
async function supabaseSecretKey(install:any){
  const keys=await supabaseProjectKeys(install);
  const candidates=[
    ...keys.filter((x:any)=>x.type==="secret"),
    ...keys.filter((x:any)=>String(x.name||"").toLowerCase()==="service_role"||String(x.type||"").toLowerCase()==="service_role"||String(x.role||"").toLowerCase()==="service_role"),
    ...keys.filter((x:any)=>String(x.name||"").toLowerCase().includes("secret")&&String(x.name||"").toLowerCase()!=="anon")
  ];
  const live=await firstWorkingSupabaseKey(install,candidates,"server");
  if(live)return live;
  return createAndValidateSupabaseKey(install,"secret","server");
}
export async function customerSupabaseServerKey(install:any){return supabaseSecretKey(install)}

// Customer-managed OrbitFS projects must keep their production domain public.
// Restrict this change to Vercel Authentication: never silently remove password/IP policies.
export async function ensureStandardPanelProtection(install:any):Promise<void>{
 const id=String(install?.vercel_project_id||"").trim();if(!id)throw new Error("Customer Vercel project is missing");
 const project=await vercelApi(String(install.auth_user_id),`/v9/projects/${encodeURIComponent(id)}`,{method:"GET"});
 const scope=String(project?.ssoProtection?.deploymentType||"");
 if(scope==="all"||scope==="all_except_custom_domains"){
  await vercelApi(String(install.auth_user_id),`/v9/projects/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({ssoProtection:{deploymentType:"prod_deployment_urls_and_all_previews"}})});
 }
 if(project?.passwordProtection?.deploymentType==="all")throw Object.assign(new Error("Customer Vercel project has password protection on its production domain. Change its scope to Standard Protection before publishing a public panel."),{status:409});
}

export async function ensureVercelProject(install:any){
  if(install?.vercel_project_id)return install;
  const settings=await billingOrbitfsConfig();
  const {teamId}=await vercelAccessToken(install.auth_user_id);
  const name=`${settings.panel_project_prefix}-${String(install.installation_id||install.id).slice(-8)}`.toLowerCase().replace(/[^a-z0-9-]/g,"-");
  let project:any=null;
  try{
    project=await vercelApi(install.auth_user_id,"/v11/projects",{method:"POST",body:JSON.stringify({name,framework:"sveltekit",ssoProtection:{deploymentType:"prod_deployment_urls_and_all_previews"}})});
  }catch(error:any){
    const message=String(error?.message||"");
    if(!message.includes("409"))throw error;
    project=await vercelApi(install.auth_user_id,`/v9/projects/${encodeURIComponent(name)}`,{method:"GET"});
  }
  const projectId=String(project?.id||"").trim();
  if(!projectId)throw Object.assign(new Error("Vercel project creation did not return a project id"),{status:502});
  const patch={
    vercel_team_id:teamId||project?.accountId||project?.teamId||null,
    vercel_project_id:projectId,
    vercel_project_name:String(project?.name||name),
    state:"configuring",
    last_error:null,
    updated_at:new Date().toISOString()
  };
  const {data,error}=await licenseDb().from("orbitfs_installations").update(patch).eq("id",install.id).select().single();
  if(error)throw error;
  await event(data,"vercel.project_ready","ok",`OrbitFS Panel project ${patch.vercel_project_name} is ready in the customer Vercel account`,{projectId,teamId:patch.vercel_team_id});
  return data;
}
async function upsertVercelEnv(install:any,key:string,value:string){
  await vercelApi(install.auth_user_id,`/v10/projects/${encodeURIComponent(install.vercel_project_id)}/env?upsert=true`,{method:"POST",body:JSON.stringify({key,value,type:"encrypted",target:["production","preview","development"]})});
}
const ORBITFS_LICENSE_API_URL="https://incendiarynetworks.cc/api/v1/license";
const ORBITFS_SHARED_ENGINE_RELEASE_PROVIDER=String(process.env.ORBITFS_SHARED_ENGINE_RELEASE_PROVIDER||"https://incendiarynetworks.cc/api/v1/updater").trim().replace(/\/+$/,"");
const ORBITFS_ENGINE_RELEASE_TIMEOUT_MS="30000";
const ORBITFS_VERCEL_TIMEOUT_MS="120000";
const ORBITFS_LICENSE_REFRESH_MINUTES="30";
const ORBITFS_LICENSE_TIMEOUT_MS="8000";

export async function configureVercel(install:any,releaseVersion?:string,panelUrl?:string,releaseChannel?:string,releaseId?:string,releaseSha256?:string,releaseSourceCommit?:string){
  if(!install?.supabase_project_ref)throw new Error("Customer Supabase project is not configured");
  if(!install?.vercel_project_id)throw new Error("Customer Vercel project is not configured");
  let accessContract:DatabaseRuntimeAccessContract;
  try{
    accessContract=await ensureCustomerDatabaseRuntimeAccess(install,"vercel-configure");
  }catch(e:any){
    const message=String(e?.message||"Customer Supabase runtime-access repair failed");
    await licenseDb().from("orbitfs_installations").update({last_error:message,updated_at:new Date().toISOString()}).eq("id",install.id);
    await event(install,"database.runtime_access_failed","error",message,{stage:"vercel-configure",code:String(e?.code||"CUSTOMER_DATABASE_RUNTIME_ACCESS_FAILED")});
    throw e;
  }
  const key=await publishableKey(install),supabaseServerKey=await supabaseSecretKey(install),secret=await installationSecret(install.id,"db_secret"),vercelCredentials=await vercelAccessToken(install.auth_user_id);
  if(!key)throw new Error("Customer Supabase publishable key is missing");
  if(!supabaseServerKey)throw new Error("Customer Supabase server secret key is missing");
  if(!secret)throw new Error("OrbitFS database secret is missing");
  const version=String(releaseVersion||install.release_version||"").trim();
  const release=String(releaseId||install.release_id||"").trim();
  const checksumValue=String(releaseSha256||install.release_sha256||"").trim();
  const sourceCommit=String(releaseSourceCommit||install.release_source_commit||"").trim();
  const schemaVersion=String(install.schema_version||"1").trim();
  const channel=String(releaseChannel||install.release_channel||"stable").trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(channel))throw new Error("Invalid OrbitFS release channel");
  const vars:Record<string,string>={
    SUPABASE_URL:`https://${install.supabase_project_ref}.supabase.co`,
    SUPABASE_PUBLISHABLE_KEY:key,
    SUPABASE_SECRET_KEY:supabaseServerKey,
    ORBITFS_SUPABASE_CONNECTION_ATTESTATION:JSON.stringify({
      version:1,
      projectRef:String(install.supabase_project_ref||"").trim(),
      publishableKeySha256:supabaseApiKeyFingerprint(key),
      publishableKeyFormat:supabaseApiKeyFormat(key),
      serverKeySha256:supabaseApiKeyFingerprint(supabaseServerKey),
      serverKeyFormat:supabaseApiKeyFormat(supabaseServerKey)
    }),
    ORBITFS_DB_SECRET:secret,
    ORBITFS_DATABASE_RUNTIME_ACCESS_CONTRACT:JSON.stringify({
      version:accessContract.version,
      schema:accessContract.schema,
      publicReadTables:accessContract.publicReadTables,
      runtimeSecretHeader:accessContract.runtimeSecretHeader,
      runtimeSecretRoles:accessContract.runtimeSecretRoles,
      runtimeSecretTablePrefixes:accessContract.runtimeSecretTablePrefixes,
      runtimeSecretExcludedTables:accessContract.runtimeSecretExcludedTables,
      runtimeSecretPreflightTables:accessContract.runtimeSecretPreflightTables,
      runtimeSecretRepairRpc:accessContract.runtimeSecretRepairRpc,
      runtimeSecretProbeTable:accessContract.runtimeSecretProbeTable
    }),
    ORBITFS_INSTALLATION_ID:String(install.installation_id||"").trim(),
    ORBITFS_INSTALLATION_ROUTE:"billing_store",
    ORBITFS_PANEL_URL:panelUrl||"https://panel.incendiarynetworks.cc",
    ORBITFS_LICENSE_API_URL:ORBITFS_LICENSE_API_URL,
    ORBITFS_APP_VERSION:version||"unknown",
    ORBITFS_ENGINE_RELEASE_PROVIDER:ORBITFS_SHARED_ENGINE_RELEASE_PROVIDER,
    ORBITFS_ENGINE_RELEASE_TIMEOUT_MS:ORBITFS_ENGINE_RELEASE_TIMEOUT_MS,
    ORBITFS_VERCEL_TIMEOUT_MS:ORBITFS_VERCEL_TIMEOUT_MS,
    ORBITFS_ENGINE_PROJECT_PREFIX:"orbitfs-engine",
    ORBITFS_VERCEL_TOKEN:String(vercelCredentials.token||""),
    ORBITFS_VERCEL_TEAM_ID:String(vercelCredentials.teamId||""),
    ORBITFS_LICENSE_REFRESH_MINUTES:ORBITFS_LICENSE_REFRESH_MINUTES,
    ORBITFS_LICENSE_TIMEOUT_MS:ORBITFS_LICENSE_TIMEOUT_MS,
    ORBITFS_LICENSE_PROVIDER_OUTAGE_FREEZE:"true",
    ORBITFS_SCHEMA_VERSION:schemaVersion,
    ORBITFS_PANEL_RELEASE_VERSION:version,
    ORBITFS_RELEASE_CHANNEL:channel,
    ORBITFS_RELEASE_ID:release,
    ORBITFS_RELEASE_SHA256:checksumValue,
    ORBITFS_RELEASE_SOURCE_COMMIT:sourceCommit
  };
  for(const [name,value] of Object.entries(vars)){if(value)await upsertVercelEnv(install,name,value)}
  await event(install,"supabase.runtime_credentials_attested","ok","Validated customer Supabase credentials were written to the Base deployment",{
    projectRef:String(install.supabase_project_ref||"").trim(),
    publishableKeyFingerprint:supabaseApiKeyFingerprint(key).slice(0,16),
    publishableKeyFormat:supabaseApiKeyFormat(key),
    serverKeyFingerprint:supabaseApiKeyFingerprint(supabaseServerKey).slice(0,16),
    serverKeyFormat:supabaseApiKeyFormat(supabaseServerKey)
  });
}
export async function configureVercelUpdateIdentity(install:any,input:{version:string;releaseId:string;sha256:string;sourceCommit?:string|null;channel:string;components?:string[]}){
  if(!install?.vercel_project_id)throw new Error("Customer Vercel project is not configured");
  const channel=String(input.channel||install.release_channel||"stable").trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(channel))throw new Error("Invalid OrbitFS release channel");
  const vars:Record<string,string>={
    ORBITFS_RELEASE_CHANNEL:channel,
    ORBITFS_UPDATE_RELEASE_VERSION:String(input.version||"").trim(),
    ORBITFS_UPDATE_RELEASE_ID:String(input.releaseId||"").trim(),
    ORBITFS_UPDATE_RELEASE_SHA256:String(input.sha256||"").trim(),
    ORBITFS_UPDATE_RELEASE_SOURCE_COMMIT:String(input.sourceCommit||"").trim(),
    ORBITFS_UPDATE_COMPONENTS:JSON.stringify(Array.isArray(input.components)?input.components:[])
  };
  for(const [name,value] of Object.entries(vars)){if(value)await upsertVercelEnv(install,name,value)}
}

// Resolve only a project-level production address; generated deployment URLs can be protected.
export async function resolveProductionUrl(install:any,deployment?:any):Promise<string|null>{
 const normalize=(v:any)=>String(v||"").trim().replace(/^https?:\/\//,"").replace(/\/$/,"").toLowerCase();
 const projectDomain=`${String(install.vercel_project_name||"").trim().toLowerCase()}.vercel.app`;
 const deploymentHost=normalize(deployment?.url);
 const aliases=Array.isArray(deployment?.alias)?deployment.alias.map(normalize).filter(Boolean):[];
 const result=await vercelApi(String(install.auth_user_id),`/v9/projects/${encodeURIComponent(String(install.vercel_project_id))}/domains`,{method:"GET"});
 const domains=Array.isArray(result?.domains)?result.domains:[];
 const candidates=domains.filter((d:any)=>d?.verified!==false&&normalize(d?.name)&&normalize(d?.name)!==deploymentHost);
 const custom=candidates.find((d:any)=>!d.redirect&&!normalize(d.name).endsWith(".vercel.app"))
  ||candidates.find((d:any)=>!normalize(d.name).endsWith(".vercel.app"));
 const customAlias=aliases.find((host:string)=>host!==deploymentHost&&!host.endsWith(".vercel.app"));
 const project=candidates.find((d:any)=>normalize(d.name)===projectDomain);
 const vercel=candidates.find((d:any)=>!d.redirect&&normalize(d.name).endsWith(".vercel.app"))
  ||candidates.find((d:any)=>normalize(d.name).endsWith(".vercel.app"));
 const name=normalize(custom?.name)||customAlias||normalize(project?.name)||(aliases.includes(projectDomain)&&projectDomain!==deploymentHost?projectDomain:"")||normalize(vercel?.name)||normalize(candidates[0]?.name);
 return name?`https://${name}`:null;
}
export async function checkPublicPanelHealth(url:string,path:string):Promise<boolean>{
 try{const r=await fetch(new URL(path||"/api/health",url),{redirect:"manual",cache:"no-store",signal:AbortSignal.timeout(15000)});return r.status>=200&&r.status<300&&!r.headers.get("x-vercel-mitigated")}catch{return false}
}

export async function syncDeployment(install:any){
  if(!install.vercel_deployment_id)return install;
  const result=await vercelApi(install.auth_user_id,`/v13/deployments/${encodeURIComponent(String(install.vercel_deployment_id))}`,{method:"GET"});
  const state=String(result?.readyState||result?.state||"").toUpperCase();
  if(["ERROR","CANCELED","CANCELLED"].includes(state)){
    const msg=String(result?.error?.message||result?.errorMessage||result?.error?.code||result?.error||`Vercel deployment ${state.toLowerCase()}`);
    await licenseDb().from("orbitfs_installations").update({state:"failed",health_status:"failed",last_error:msg,last_health_at:new Date().toISOString()}).eq("id",install.id);
    await event(install,"panel.failed","error",msg);
    return {...install,state:"failed",health_status:"failed",last_error:msg};
  }
  if(state!=="READY")return install;

  const history=await licenseDb().from("orbitfs_installation_releases")
    .select("id,status,deployment_url,ready_at")
    .eq("installation_id",install.id)
    .eq("vercel_deployment_id",String(install.vercel_deployment_id))
    .eq("status","ready")
    .maybeSingle();
  if(history.error)throw history.error;
  if(!history.data)return install;

  const resultUrl=result?.url?`https://${String(result.url).replace(/^https?:\/\//,"")}`:null;
  const url=await resolveProductionUrl(install,result);
  const settings=await billingOrbitfsConfig();
  const healthy=url?await checkPublicPanelHealth(url,settings.health_path||"/api/health"):false;
  const nextHealth=healthy?"healthy":"degraded";
  const patch={state:"ready",health_status:nextHealth,last_health_at:new Date().toISOString(),production_url:url,deployment_url:resultUrl||install.deployment_url||history.data.deployment_url||null,last_error:healthy?null:!url?"Production domain is not assigned":"Production Panel public health check failed; inspect Vercel protection and runtime"};
  const {data,error}=await licenseDb().from("orbitfs_installations").update(patch).eq("id",install.id).select().single();
  if(error)throw error;
  const previousUrl=String(install.production_url||"").replace(/\/$/,"");
  const nextUrl=String(url||"").replace(/\/$/,"");
  const domainChanged=previousUrl!==nextUrl;
  const healthChanged=String(install.health_status||"")!==nextHealth;
  const stateChanged=String(install.state||"")!=="ready";
  if(domainChanged)await event(data,previousUrl?"panel.domain_changed":"panel.domain_detected",healthy?"ok":"warning",nextUrl?(previousUrl?`Production domain changed to ${nextUrl}`:`Production domain detected: ${nextUrl}`):"Production domain is no longer assigned",{previousUrl:previousUrl||null,url:nextUrl||null});
  if(healthChanged||stateChanged)await event(data,"panel.ready",healthy?"ok":"warning",healthy?"OrbitFS Panel is ready in the customer Vercel account":"Panel deployed; health check is degraded",{url});
  return data;
}
