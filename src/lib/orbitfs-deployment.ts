import {createHash,randomBytes} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {licenseDb} from "@/lib/license-api";
import {serviceRpc,userFromToken,userRpc} from "@/lib/paymentServer";
import {masterDownloadReleaseArtifact,masterExecuteDeployment,masterReleases} from "@/lib/master-api";
import {requireLicenseMasterForDeployment} from "@/lib/license-master-availability";

const SUPABASE_API="https://api.supabase.com/v1";
const VERCEL_API="https://api.vercel.com";
const SCHEMA_MAX_BYTES=8*1024*1024;

export type DeployAction="deploy"|"update"|"rollback"|"redeploy";

export function bearer(req:Request){return String(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim()}
export async function requireOrbitUser(req:Request){const token=bearer(req);if(!token)throw Object.assign(new Error("Authentication required"),{status:401});const user=await userFromToken(token);return {token,user}}
export async function requireOrbitAdmin(req:Request){const auth=await requireOrbitUser(req);const ok=await userRpc(auth.token,"has_permission",{p_permission:"licenses.view"});if(ok!==true)throw Object.assign(new Error("Permission denied"),{status:403});return auth}
export function httpError(error:any){return Response.json({error:error?.message||"Request failed"},{status:Number(error?.status)||500})}

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

export async function releaseSettings(){
  const {data,error}=await licenseDb().from("orbitfs_release_system_settings").select("*").eq("id","primary").single();
  if(error)throw error;return data;
}
export async function publicReleaseSettings(){const s=await releaseSettings();return {enabled:s.enabled,maintenance_mode:s.maintenance_mode===true,maintenance_message:String(s.maintenance_message||""),customer_deploy_enabled:s.customer_deploy_enabled,customer_updates_enabled:s.customer_updates_enabled,customer_rollbacks_enabled:s.customer_rollbacks_enabled,allow_existing_supabase_project:s.allow_existing_supabase_project,allow_create_supabase_project:s.allow_create_supabase_project,supabase_oauth_enabled:s.supabase_oauth_enabled,vercel_oauth_enabled:s.vercel_oauth_enabled,schema_version:s.schema_version,release_channel:s.release_channel}}
export async function requireSystem(capability:"deploy"|"update"|"rollback"="deploy"){
  const s=await releaseSettings();
  if(s.enabled===false)throw Object.assign(new Error("OrbitFS customer delivery is shut down by Billing Store"),{status:503});
  if(s.maintenance_mode===true)throw Object.assign(new Error(String(s.maintenance_message||"OrbitFS deployment maintenance is active")),{status:503});
  if(capability==="deploy"&&s.customer_deploy_enabled===false)throw Object.assign(new Error("Base deployment is disabled by Billing Store"),{status:403});
  if(capability==="update"&&s.customer_updates_enabled===false)throw Object.assign(new Error("Update deployment is disabled by Billing Store"),{status:403});
  if(capability==="rollback"&&s.customer_rollbacks_enabled===false)throw Object.assign(new Error("Rollback is disabled by Billing Store"),{status:403});
  await requireLicenseMasterForDeployment(capability);
  return s;
}

export async function loadInstallation(id:string,userId:string,allowAdmin=false){
  const db=licenseDb();const {data,error}=await db.from("orbitfs_installations").select("*").eq("id",id).single();
  if(error||!data)throw Object.assign(new Error("OrbitFS installation not found"),{status:404});
  if(data.auth_user_id!==userId&&!allowAdmin)throw Object.assign(new Error("Permission denied"),{status:403});
  return data;
}
export async function event(install:any,type:string,status="info",message="",detail:any={}){await licenseDb().from("orbitfs_deployment_events").insert({installation_id:install.id,auth_user_id:install.auth_user_id,event_type:type,status,message,detail})}

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
async function connection(userId:string,provider:string){const {data}=await licenseDb().from("orbitfs_provider_connections").select("*").eq("auth_user_id",userId).eq("provider",provider).maybeSingle();return data}

async function supabaseAccessToken(userId:string){
  const conn=await connection(userId,"supabase");if(!conn||conn.status!=="connected")throw Object.assign(new Error("Customer Supabase account is not connected"),{status:409});
  let token=await providerSecret(userId,"supabase","access_token");if(!token)throw Object.assign(new Error("Supabase connection token is missing"),{status:409});
  if(conn.token_expires_at&&new Date(conn.token_expires_at).getTime()<Date.now()+60000){
    const refresh=await providerSecret(userId,"supabase","refresh_token"),s=await releaseSettings(),secret=await releaseSecret("supabase_client_secret");
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
  if(!r.ok)throw Object.assign(new Error(`Supabase API ${r.status}: ${await r.text()}`),{status:r.status>=500?502:r.status});return r.status===204?null:r.json();
}

async function vercelAccessToken(userId:string){const conn=await connection(userId,"vercel");if(!conn||conn.status!=="connected")throw Object.assign(new Error("Customer Vercel account is not connected"),{status:409});const token=await providerSecret(userId,"vercel","access_token");if(!token)throw Object.assign(new Error("Vercel connection token is missing"),{status:409});return {token,teamId:conn.team_id||conn.metadata?.team_id||null}}
export async function customerVercelCredentials(userId:string){return vercelAccessToken(userId)}
export async function customerInstallationDbSecret(installationRecordId:string){const secret=String(await installationSecret(installationRecordId,"db_secret")||"").trim();if(!secret)throw Object.assign(new Error("OrbitFS database secret is missing"),{status:409});return secret}
function withTeam(path:string,teamId?:string|null){if(!teamId)return path;const u=new URL(path,VERCEL_API);u.searchParams.set("teamId",teamId);return u.pathname+u.search}
export async function vercelApi(userId:string,path:string,init:RequestInit={}){const {token,teamId}=await vercelAccessToken(userId);const r=await fetch(`${VERCEL_API}${withTeam(path,teamId)}`,{...init,headers:{authorization:`Bearer ${token}`,"content-type":"application/json",...(init.headers||{})}});if(!r.ok)throw Object.assign(new Error(`Vercel API ${r.status}: ${await r.text()}`),{status:r.status>=500?502:r.status});return r.status===204?null:r.json()}

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
  await assertSupabaseProjectReady(install);
  const releaseSchema=String(release.manifest?.databaseSchemaVersion||release.manifest?.releaseInfo?.databaseSchemaVersion||"").trim();
  if(!releaseSchema)throw Object.assign(new Error(`Published Base release ${release.version} does not declare a customer database schema version. Publish a current Base release before initializing this installation.`),{status:409});
  const schemaAsset=await releaseSchemaText(release);
  const effectiveSchema=schemaAsset.schemaVersion;
  const sql=schemaAsset.sql;
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
values ('${safe(baseMigrationId)}','${safe(schemaAsset.sha256)}','base','${safe(schemaAsset.path)}','${safe(String(release.id))}','${safe(String(release.version))}',now())
on conflict (migration_id) do nothing;
insert into storage.buckets(id,name,public,file_size_limit) values ('orbitfs-files','orbitfs-files',false,1073741824) on conflict (id) do update set name=excluded.name,public=false,file_size_limit=excluded.file_size_limit;`;
  const installSql=`BEGIN;\n${sql}\n${runtimeSql}\nCOMMIT;`;
  try{
    await supabaseApi(install.auth_user_id,`/projects/${install.supabase_project_ref}/database/query`,{method:"POST",body:JSON.stringify({query:installSql})});
  }catch(e:any){
    const message=String(e?.message||"Database initialization failed");
    await licenseDb().from("orbitfs_installations").update({state:"preparing_database",last_error:message}).eq("id",install.id);
    await event(install,"database.failed","error",message);
    throw e;
  }
  const {data,error}=await licenseDb().from("orbitfs_installations").update({schema_version:effectiveSchema,database_initialized_at:new Date().toISOString(),state:"awaiting_vercel",last_error:null,release_id:String(release.id),release_version:String(release.version),release_sha256:String(release.sha256||release.checksum||""),release_source_commit:release.source_sha||release.source_commit||release.manifest?.sourceCommit||null,release_channel:channel}).eq("id",install.id).select().single();if(error)throw error;await event(data,"database.ready","ok",`Customer database initialized with OrbitFS database schema ${effectiveSchema}`,{releaseId:release.id,releaseVersion:release.version,databaseSchemaVersion:effectiveSchema,databaseSchemaSha256:schemaAsset.sha256,databaseSchemaSource:schemaAsset.source,databaseMigrationCount:"migrationCount" in schemaAsset?schemaAsset.migrationCount:null,databaseLatestMigration:"latestMigration" in schemaAsset?schemaAsset.latestMigration:null,baseMigrationId});return data;
}

async function publishableKey(install:any){
  assertCustomerSupabaseRef(install.supabase_project_ref);
  const keys=await supabaseApi(install.auth_user_id,`/projects/${install.supabase_project_ref}/api-keys?reveal=true`) as any[];
  let key=(keys||[]).find((x:any)=>x.type==="publishable")||(keys||[]).find((x:any)=>x.name==="anon"||x.type==="anon");
  if(!key)key=await supabaseApi(install.auth_user_id,`/projects/${install.supabase_project_ref}/api-keys?reveal=true`,{method:"POST",body:JSON.stringify({type:"publishable",name:"default"})});
  const value=key?.api_key||key?.key||key?.value;if(!value)throw new Error("Could not retrieve or create a Supabase publishable key from the customer's project");return value;
}
async function ensureVercelProject(install:any){
  if(install.vercel_project_id)return install;
  const s=await releaseSettings(),{teamId}=await vercelAccessToken(install.auth_user_id),name=`${s.panel_project_prefix}-${install.installation_id.slice(-8)}`.toLowerCase().replace(/[^a-z0-9-]/g,"-");let p:any;
  try{p=await vercelApi(install.auth_user_id,"/v11/projects",{method:"POST",body:JSON.stringify({name,framework:"sveltekit"})})}catch(e:any){if(!String(e.message).includes("404"))throw e;try{p=await vercelApi(install.auth_user_id,"/v10/projects",{method:"POST",body:JSON.stringify({name,framework:"sveltekit"})})}catch(e2:any){if(!String(e2.message).includes("404"))throw e2;p=await vercelApi(install.auth_user_id,"/v9/projects",{method:"POST",body:JSON.stringify({name,framework:"sveltekit"})})}}
  const {data,error}=await licenseDb().from("orbitfs_installations").update({vercel_team_id:teamId||p.accountId||p.teamId||null,vercel_project_id:p.id,vercel_project_name:p.name||name,state:"configuring",last_error:null}).eq("id",install.id).select().single();if(error)throw error;await event(data,"vercel.project_created","ok",`OrbitFS Panel project ${p.name||name} created in customer Vercel account`);return data;
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
  const key=await publishableKey(install),secret=await installationSecret(install.id,"db_secret");
  if(!key)throw new Error("Customer Supabase publishable key is missing");
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
    ORBITFS_DB_SECRET:secret,
    ORBITFS_INSTALLATION_ID:String(install.installation_id||"").trim(),
    ORBITFS_PANEL_URL:panelUrl||"https://panel.incendiarynetworks.cc",
    ORBITFS_LICENSE_API_URL:ORBITFS_LICENSE_API_URL,
    ORBITFS_APP_VERSION:version||"unknown",
    ORBITFS_ENGINE_RELEASE_PROVIDER:ORBITFS_SHARED_ENGINE_RELEASE_PROVIDER,
    ORBITFS_ENGINE_RELEASE_TIMEOUT_MS:ORBITFS_ENGINE_RELEASE_TIMEOUT_MS,
    ORBITFS_VERCEL_TIMEOUT_MS:ORBITFS_VERCEL_TIMEOUT_MS,
    ORBITFS_LICENSE_REFRESH_MINUTES:ORBITFS_LICENSE_REFRESH_MINUTES,
    ORBITFS_LICENSE_TIMEOUT_MS:ORBITFS_LICENSE_TIMEOUT_MS,
    ORBITFS_SCHEMA_VERSION:schemaVersion,
    ORBITFS_PANEL_RELEASE_VERSION:version,
    ORBITFS_RELEASE_CHANNEL:channel,
    ORBITFS_RELEASE_ID:release,
    ORBITFS_RELEASE_SHA256:checksumValue,
    ORBITFS_RELEASE_SOURCE_COMMIT:sourceCommit
  };
  for(const [name,value] of Object.entries(vars)){if(value)await upsertVercelEnv(install,name,value)}
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

export async function syncDeployment(install:any){
  if(!install.vercel_deployment_id)return install;
  const result=await vercelApi(install.auth_user_id,`/v13/deployments/${encodeURIComponent(String(install.vercel_deployment_id))}`,{method:"GET"});
  const state=String(result?.readyState||result?.state||"").toUpperCase();
  if(["ERROR","CANCELED"].includes(state)){const msg=result?.error?.message||result?.error||`Vercel deployment ${state.toLowerCase()}`;await licenseDb().from("orbitfs_installations").update({state:"failed",health_status:"failed",last_error:msg,last_health_at:new Date().toISOString()}).eq("id",install.id);await event(install,"panel.failed","error",msg);return {...install,state:"failed",health_status:"failed",last_error:msg}}
  if(state!=="READY")return install;
  const resultUrl=result?.url?`https://${String(result.url).replace(/^https?:\/\//,"")}`:null;
  const url=install.production_url||install.deployment_url||resultUrl||null;let healthy=false;
  if(url){try{const s=await releaseSettings(),r=await fetch(new URL(s.health_path||"/api/health",url),{redirect:"follow",cache:"no-store"});healthy=r.status<500}catch{healthy=false}}
  const patch={state:"ready",health_status:healthy?"healthy":"degraded",last_health_at:new Date().toISOString(),production_url:url,last_error:healthy?null:"Panel deployed but health check did not succeed"},{data,error}=await licenseDb().from("orbitfs_installations").update(patch).eq("id",install.id).select().single();if(error)throw error;await event(data,"panel.ready",healthy?"ok":"warning",healthy?"OrbitFS Panel is ready in the customer Vercel account":"Panel deployed; health check is degraded",{url});return data;
}