import {compareOrbitReleaseVersions} from "@/lib/orbitfs-version";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {licenseDb} from "@/lib/license-api";
import {masterDownloadReleaseArtifact,masterExecuteDeployment,masterReleases,masterRequest,type MasterDeploymentResult} from "@/lib/master-api";
import {billingOrbitfsConfig,configureVercel,resolveProductionUrl,ensureSelectedBaseVercelAliasOnDeployment,checkPublicPanelHealth,ensureStandardPanelProtection,customerInstallationDbSecret,customerVercelCredentials,ensureVercelProject,ensureCustomerDatabaseRuntimeAccess,event,requireSystem,supabaseApi,vercelApi,type DeployAction} from "@/lib/orbitfs-deployment";
import {customerReleaseChannels} from "@/lib/orbitfs-release-channels";
import {reportDevPanelReleaseEvent} from "@/lib/dev-panel-events";
import {errorMessage} from "@/lib/error-message";

const MAX_FILES=5000,MAX_FILE_BYTES=25*1024*1024,MAX_TOTAL_BYTES=70*1024*1024;
const ORBITFS_UPDATER_PROTOCOL=2;
const SAFE_PATH=/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*(?:^|\/)(?:\.git|\.vercel|node_modules)(?:\/|$))[A-Za-z0-9._@+\-\/\[\]()=]+$/;
type ReleaseFile={file:string;data:string;encoding?:string;sha256?:string;size?:number;component?:string};
type Package={format?:string;schemaVersion?:number;version:string;releaseId?:string;sourceCommit?:string;components?:string[];projectSettings?:Record<string,unknown>;files:ReleaseFile[];[key:string]:any};
type UpdateBundle={format:"orbitfs-update-bundle-v3";schemaVersion:number;version:string;sourceCommit?:string;components:string[];minimumBaseVersion?:string;minimumUpdaterProtocol?:number;minimumEngineDeployerProtocol?:number;checkpointRequired?:boolean;updateScope?:string;executor?:string;baseBaseline?:unknown;payloads:{engine:Package|null;panel?:Package|null};[key:string]:any};
type ParsedArtifact={root:Package|UpdateBundle;artifactSha256:string};
const fail=(message:string,status=400,code="ORBITFS_DEPLOYMENT_FAILED",retryable=status>=500):never=>{throw Object.assign(new Error(message),{status,code,retryable})};
const checksum=(buf:Buffer)=>createHash("sha256").update(buf).digest("hex");
const sha1=(buf:Buffer)=>createHash("sha1").update(buf).digest("hex");
function decodedReleaseFile(file:{file:string;data:string;sha256?:string;size?:number}){
  const bytes=Buffer.from(String(file.data||""),"base64");
  if(file.size!==undefined&&Number(file.size)!==bytes.byteLength)fail(`Release file size mismatch before Vercel upload: ${file.file}`,422);
  if(file.sha256&&String(file.sha256).toLowerCase()!==checksum(bytes))fail(`Release file checksum mismatch before Vercel upload: ${file.file}`,422);
  return bytes;
}
function isDatabaseOnlyBaseFile(path:string){
  const value=String(path||"").replaceAll("\\","/");
  // SQL assets belong to the Supabase/database phase, never the Vercel app payload.
  // Filter by file type rather than directory so release packages can safely move
  // database helper files without causing a customer Vercel deployment failure.
  return /\.sql$/i.test(value);
}
function baseVercelDeploymentFiles(files:Array<{file:string;data:string;sha256:string;size:number}>){
  const deploymentFiles=files.filter(file=>!isDatabaseOnlyBaseFile(file.file));
  if(!deploymentFiles.length)fail("Base release contains no deployable application files",422);
  if(deploymentFiles.some(file=>/\.sql$/i.test(file.file)))fail("Base Vercel payload contains a database SQL asset",422);
  return deploymentFiles;
}
function validateDeployableBaseFiles(files:Array<{file:string;data:string;sha256:string;size:number}>){
  const byPath=new Map(files.map(file=>[file.file,file]));
  for(const required of ["package.json","package-lock.json","svelte.config.js","vite.config.ts","tools/prepare-license-runtime.mjs","deployment/base-environment.json"]){
    if(!byPath.has(required))fail(`Base release is missing required Vercel build file: ${required}`,422);
  }
  for(const jsonPath of ["package.json","package-lock.json"]){
    try{JSON.parse(decodedReleaseFile(byPath.get(jsonPath)!).toString("utf8"))}
    catch{fail(`Base release contains invalid JSON in ${jsonPath}`,422)}
  }
  const pkg=JSON.parse(decodedReleaseFile(byPath.get("package.json")!).toString("utf8"));
  if(String(pkg?.scripts?.build||"")!=="node tools/prepare-license-runtime.mjs && vite build")fail("Base release package.json has an unexpected production build script",422);
  if(!pkg?.dependencies?.["@sveltejs/adapter-vercel"])fail("Base release is missing @sveltejs/adapter-vercel",422);
  const lock=JSON.parse(decodedReleaseFile(byPath.get("package-lock.json")!).toString("utf8"));
  if(!Number.isInteger(Number(lock?.lockfileVersion))||Number(lock.lockfileVersion)<2)fail("Base release package-lock.json is not a supported npm lockfile",422);
  if(![...byPath.keys()].some(path=>path.startsWith("src/")))fail("Base release is missing application source files",422);
  if(!byPath.has("supabase/customer-schema.sql"))fail("Base release is missing the customer database snapshot",422);
  for(const required of [
    "src/lib/server/vercel-engine-provision.ts",
    "src/lib/server/engine-host.ts",
    "src/lib/server/engine-release-client.ts",
    "src/lib/server/engine-update-planner.ts",
    "src/lib/server/license.ts",
    "src/lib/server/runtime-secrets.ts",
    "src/routes/api/engine-host/+server.ts",
    "src/routes/api/engine-host/[action]/+server.ts",
    "src/routes/api/engine-host/launch/+server.ts",
    "src/routes/api/engine-license/+server.ts",
    "src/routes/api/license/activate/+server.ts",
    "src/routes/api/license/status/+server.ts",
    "src/hooks.server.ts",
    "src/routes/setup/+page.svelte",
    "src/routes/setup/owner/+page.svelte",
    "src/routes/api/setup/[...rest]/+server.ts",
    "src/routes/api/setup/status/+server.ts",
    "src/routes/api/setup/owner/+server.ts",
    "src/routes/api/store/update-engine/+server.ts"
  ])if(!byPath.has(required))fail(`Base release is missing required runtime/deployer file: ${required}`,422);
  const environment=JSON.parse(decodedReleaseFile(byPath.get("deployment/base-environment.json")!).toString("utf8"));
  const environmentNames=new Set((Array.isArray(environment?.variables)?environment.variables:[]).map((item:any)=>String(item?.name||"")));
  for(const requiredEnvironment of ["SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","SUPABASE_SECRET_KEY","ORBITFS_SUPABASE_CONNECTION_ATTESTATION","ORBITFS_DB_SECRET"]){
    if(!environmentNames.has(requiredEnvironment))fail(`Base release environment contract is missing ${requiredEnvironment}`,422);
  }
  const innerSource=decodedReleaseFile(byPath.get("src/lib/server/vercel-engine-provision.ts")!).toString("utf8");
  for(const marker of [
    "ORBITFS_SUPABASE_CONNECTION_ATTESTATION",
    "ENGINE_SUPABASE_PROJECT_MISMATCH",
    "ENGINE_SUPABASE_PUBLISHABLE_KEY_MISMATCH",
    "ENGINE_SUPABASE_SERVER_KEY_MISMATCH",
    "ENGINE_DATABASE_PUBLISHABLE_KEY_REJECTED",
    "ENGINE_DATABASE_SERVER_KEY_REJECTED"
  ]){
    if(!innerSource.includes(marker))fail(`Base release Inner Engine deployer is missing Supabase safeguard: ${marker}`,422);
  }
  baseVercelDeploymentFiles(files);
}
async function uploadVercelDeploymentFiles(userId:string,files:Array<{file:string;data:string;sha256:string;size:number}>){
  const {token,teamId}=await customerVercelCredentials(userId);
  const uploaded=new Array<{file:string;sha:string;size:number}>(files.length);
  const requestUrl=(path:string)=>{const url=new URL(path,"https://api.vercel.com");if(teamId)url.searchParams.set("teamId",String(teamId));return url.toString()};
  const uploadOne=async(file:{file:string;data:string;sha256:string;size:number},index:number)=>{
    const bytes=decodedReleaseFile(file);
    const digest=sha1(bytes);
    let response=await fetch(requestUrl("/v2/files"),{
      method:"POST",
      headers:{authorization:`Bearer ${token}`,"content-type":"application/octet-stream","content-length":String(bytes.length),"x-vercel-digest":digest},
      body:new Uint8Array(bytes),
      signal:AbortSignal.timeout(30000)
    });
    if(!response.ok&&response.status===404){
      response=await fetch(requestUrl("/v2/now/files"),{
        method:"POST",
        headers:{authorization:`Bearer ${token}`,"content-type":"application/octet-stream","content-length":String(bytes.length),"x-now-digest":digest},
        body:new Uint8Array(bytes),
        signal:AbortSignal.timeout(30000)
      });
    }
    if(!response.ok&&response.status!==409){
      const detail=await response.text();
      fail(`Vercel file upload failed for ${file.file} (${response.status}): ${detail}`,response.status>=500?502:response.status);
    }
    uploaded[index]={file:file.file,sha:digest,size:bytes.length};
  };
  let cursor=0;
  const workers=Array.from({length:Math.min(6,files.length)},async()=>{
    while(true){
      const index=cursor++;
      if(index>=files.length)return;
      await uploadOne(files[index],index);
    }
  });
  await Promise.all(workers);
  return uploaded;
}

const releaseType=(action:DeployAction)=>action==="update"?"update":"base";

async function exactRelease(releaseId:string):Promise<any>{
  const result=await masterRequest(`/api/v1/releases/${encodeURIComponent(releaseId)}`,{method:"GET",cache:"no-store"},"deployer");
  const release=result?.release||result;
  if(!release?.id)fail("Release was not found in License Manager",404);
  return release;
}
async function publishedRelease(version:string|undefined,action:DeployAction,channel="stable",releaseId?:string):Promise<any>{
  if(action==="redeploy"&&releaseId){
    const release=await exactRelease(releaseId);
    if(String(release.release_type||"").toLowerCase()!=="base")fail("Redeploy requires a Base release",409);
    if(String(release.channel||channel).toLowerCase()!==channel)fail("Selected release channel does not match the installation channel",409);
    if(String(release.review_status||"").toLowerCase()!=="approved"||!String(release.checksum||release.sha256||"").trim())fail("Installed Base release is not verified for redeployment",409);
    return release;
  }
  // Deployment authorization must always resolve live License Manager state.
  // A cached release list can retain a just-withdrawn revision and cause redeploy
  // to authorize the wrong immutable release id.
  const rows=await masterReleases("orbitfs_base",channel,releaseType(action),"deployer",true,false);
  const releases=(Array.isArray(rows?.releases)?rows.releases:Array.isArray(rows)?rows:[]).filter((r:any)=>String(r.status||"").toLowerCase()==="published"&&String(r.review_status||"").toLowerCase()==="approved"&&!r.archived_at);
  const wanted=releaseId?releases.find((r:any)=>String(r.id)===String(releaseId)):version?releases.find((r:any)=>String(r.version)===version):releases[0];
  if(!wanted?.id)fail(releaseId?`Selected published ${releaseType(action)} release is no longer available in License Manager`:version?`Published ${releaseType(action)} release ${version} was not found in License Manager`:`No approved published ${releaseType(action)} release is available`,404);
  if(String(wanted.channel||channel).toLowerCase()!==channel)fail("Selected release channel does not match the installation channel",409);
  return wanted;
}

function gunzipArtifact(bytes:Buffer){try{return gunzipSync(bytes)}catch{throw Object.assign(new Error("Release artifact is not a valid OrbitFS gzip package"),{status:422})}}
function expectedSource(release:any){return String(release?.source_sha||release?.source_commit||release?.manifest?.sourceCommit||"").trim()}
function parseArtifact(raw:Buffer,release:any):Package|UpdateBundle{
  try{
    const value:any=JSON.parse(raw.toString("utf8"));
    if(!value||typeof value!=="object"||!value.version)fail("Release package manifest is incomplete",422);
    if(String(value.version)!==String(release.version))fail("Release package version does not match License Master",422);
    const expected=expectedSource(release),actual=String(value.sourceCommit||"").trim();
    if(expected&&actual&&expected!==actual)fail("Release package source commit does not match License Master",422);
    if(value.format==="orbitfs-update-bundle-v3"){
      if(Number(value.schemaVersion)!==3||!Array.isArray(value.components)||!value.components.length||!value.payloads||typeof value.payloads!=="object")fail("Update bundle manifest is incomplete",422);
      return value as UpdateBundle;
    }
    if(value.format&&String(value.format)!=="orbitfs-base-deployment-v2")fail("Release package format is not supported by the customer deployer",422);
    if(!Array.isArray(value.files)||!value.files.length)fail("Release package file list is incomplete",422);
    return value as Package;
  }catch(error){
    if(error instanceof Error&&"status" in error)throw error;
    throw Object.assign(new Error("Release package contains invalid JSON"),{status:422});
  }
}
function validateFiles(files:ReleaseFile[],label:string){
  if(!Array.isArray(files)||files.length<1||files.length>MAX_FILES)fail(`${label} file count is invalid`,422);
  let total=0;
  const seen=new Set<string>();
  const normalized=files.map((entry:any)=>{
    const file=String(entry?.file||"").replaceAll("\\","/");
    if(!SAFE_PATH.test(file)||seen.has(file))fail(`Unsafe or duplicate ${label} path: ${file}`,422);
    seen.add(file);
    if(entry.encoding!=="base64"||typeof entry.data!=="string")fail(`${label} file ${file} is not base64 encoded`,422);
    const data=Buffer.from(entry.data,"base64");
    if(data.byteLength>MAX_FILE_BYTES)fail(`${label} file ${file} exceeds the file size limit`,413);
    total+=data.byteLength;
    const actual=checksum(data);
    if(entry.sha256&&String(entry.sha256).toLowerCase()!==actual)fail(`${label} checksum mismatch for ${file}`,422);
    if(entry.size!==undefined&&Number(entry.size)!==data.byteLength)fail(`${label} size mismatch for ${file}`,422);
    return {file,data:data.toString("base64"),sha256:actual,size:data.byteLength,component:entry.component?String(entry.component):undefined};
  });
  if(total>MAX_TOTAL_BYTES)fail(`${label} exceeds the total file size limit`,413);
  return normalized;
}
async function readArtifact(release:any):Promise<ParsedArtifact>{
  const artifact=await masterDownloadReleaseArtifact(String(release.id));
  if(artifact.bytes.byteLength>75*1024*1024)fail("Release artifact exceeds the customer deployer size limit",413);
  const digest=checksum(artifact.bytes);
  const expected=String(release.sha256||release.checksum||release.artifactSha256||"").trim().toLowerCase();
  if(expected&&expected!==digest)fail("Release artifact checksum does not match License Master metadata",422);
  const raw=gunzipArtifact(artifact.bytes);
  if(raw.byteLength>MAX_TOTAL_BYTES*3)fail("Release package exceeds the customer deployer unpacked size limit",413);
  return {root:parseArtifact(raw,release),artifactSha256:digest};
}
function validateBaseRuntimeOwnership(pkg:Package,release:any){
  const ownership=(pkg as any).runtimeOwnership&&typeof (pkg as any).runtimeOwnership==="object"&&!Array.isArray((pkg as any).runtimeOwnership)?(pkg as any).runtimeOwnership:{};
  const excluded=Array.isArray(ownership.excludedUpdateTargets)?ownership.excludedUpdateTargets.map((value:any)=>String(value||"").trim().toLowerCase()).filter(Boolean).sort():[];
  if(String(ownership.base||"")!=="base-deployer-updater"||String(ownership.innerDeployer||"")!=="base"||String(ownership.engineUpdaterExecutor||"")!=="base-inner-deployer-v1"||excluded.join(",")!==["apex","mcp","studio"].sort().join(",")){
    fail("Base package does not declare the required Base / inner-deployer ownership boundary",422,"BASE_RUNTIME_OWNERSHIP_INVALID");
  }
  const packagedProtocol=Number((pkg as any).engineDeployerProtocol??(pkg as any).releaseInfo?.engineDeployerProtocol??0);
  const authorityProtocol=Number(release?.manifest?.engineDeployerProtocol??0);
  if(!Number.isInteger(packagedProtocol)||packagedProtocol<1)fail("Base package does not declare a valid inner-deployer protocol",422,"BASE_ENGINE_DEPLOYER_PROTOCOL_MISSING");
  if(authorityProtocol&&packagedProtocol!==authorityProtocol)fail("Base package inner-deployer protocol does not match License Manager",422,"BASE_ENGINE_DEPLOYER_PROTOCOL_MISMATCH");
}
function requireEngineUpdatePayload(bundle:UpdateBundle):Package{
  const payloads=(bundle as any).payloads;
  if(!payloads||typeof payloads!=="object"||Array.isArray(payloads)){
    fail("Update Bundle payloads are missing or invalid",422,"ENGINE_RELEASE_PAYLOAD_MISSING");
  }
  const engine=(payloads as {engine?:unknown}).engine;
  if(!engine||typeof engine!=="object"||Array.isArray(engine)){
    fail("Update Bundle has no Shared Engine payload",422,"ENGINE_RELEASE_PAYLOAD_MISSING");
  }
  return engine as Package;
}
async function readBasePackage(release:any):Promise<{pkg:Package;files:Array<{file:string;data:string;sha256:string;size:number}>;artifactSha256:string}>{
  const parsed=await readArtifact(release);
  if((parsed.root as any).format==="orbitfs-update-bundle-v3")fail("Base deployment cannot use an Update Bundle artifact",422);
  const pkg=parsed.root as Package;
  const releaseComponents=[...(Array.isArray(release?.manifest?.components)?release.manifest.components:[])].map((x:any)=>String(x||"").trim().toLowerCase()).filter(Boolean).sort();
  const packageComponents=[...(Array.isArray(pkg.components)?pkg.components:[])].map(x=>String(x||"").trim().toLowerCase()).filter(Boolean).sort();
  if(releaseComponents.length&&packageComponents.length&&releaseComponents.join(",")!==packageComponents.join(","))fail("Release package components do not match License Manager",422);

  const manifest=release?.manifest&&typeof release.manifest==="object"?release.manifest:{};
  validateBaseRuntimeOwnership(pkg,release);
  const expectedSchemaVersion=String(manifest.databaseSchemaVersion||manifest.releaseInfo?.databaseSchemaVersion||"").trim();
  const expectedSchemaHash=String(manifest.databaseSchemaSha256||manifest.releaseInfo?.databaseSchemaSha256||"").trim().toLowerCase();
  const expectedSchemaPath=String(manifest.databaseSchemaPath||manifest.releaseInfo?.databaseSchemaPath||"").trim();
  const expectedMigrationCount=Number(manifest.databaseMigrationCount??manifest.releaseInfo?.databaseMigrationCount??0);
  const expectedLatestMigration=String(manifest.databaseLatestMigration||manifest.releaseInfo?.databaseLatestMigration||"").trim();

  if(!expectedSchemaVersion||!/^[a-f0-9]{64}$/.test(expectedSchemaHash)||expectedSchemaPath!=="supabase/customer-schema.sql"||!Number.isInteger(expectedMigrationCount)||expectedMigrationCount<1||!/^\d{14}$/.test(expectedLatestMigration)){
    fail(`Published Base release ${release.version} is missing its verified customer database snapshot metadata`,422);
  }

  const packageSchemaVersion=String((pkg as any).databaseSchemaVersion||(pkg as any).releaseInfo?.databaseSchemaVersion||"").trim();
  const packageSchemaHash=String((pkg as any).databaseSchemaSha256||(pkg as any).releaseInfo?.databaseSchemaSha256||"").trim().toLowerCase();
  const packageSchemaPath=String((pkg as any).databaseSchemaPath||(pkg as any).releaseInfo?.databaseSchemaPath||"").trim();
  const packageMigrationCount=Number((pkg as any).databaseMigrationCount??(pkg as any).releaseInfo?.databaseMigrationCount??0);
  const packageLatestMigration=String((pkg as any).databaseLatestMigration||(pkg as any).releaseInfo?.databaseLatestMigration||"").trim();

  if(packageSchemaVersion!==expectedSchemaVersion||packageSchemaHash!==expectedSchemaHash||packageSchemaPath!==expectedSchemaPath||packageMigrationCount!==expectedMigrationCount||packageLatestMigration!==expectedLatestMigration){
    fail("Base package customer database metadata does not match License Manager",422);
  }

  const files=validateFiles(pkg.files,"Base package");
  const schemaFile=files.find(file=>file.file===expectedSchemaPath);
  if(!schemaFile||schemaFile.sha256!==expectedSchemaHash)fail("Base package customer database snapshot is missing or has the wrong checksum",422);

  validateDeployableBaseFiles(files);
  return {pkg,files,artifactSha256:parsed.artifactSha256};
}
async function readCurrentBasePackageForRedeploy(release:any):Promise<{pkg:Package;files:Array<{file:string;data:string;sha256:string;size:number}>;artifactSha256:string}>{
  const parsed=await readArtifact(release);
  if((parsed.root as any).format==="orbitfs-update-bundle-v3")fail("Base redeploy cannot use an Update Bundle artifact",422);
  const pkg=parsed.root as Package;
  validateBaseRuntimeOwnership(pkg,release);
  const files=validateFiles(pkg.files,"Installed Base package");
  validateDeployableBaseFiles(files);
  return {pkg,files,artifactSha256:parsed.artifactSha256};
}
type DatabaseMigration={id:string;file:string;component?:string;encoding:"base64";data:string;size:number;sha256:string};
function sqlLiteral(value:unknown){return "'"+String(value??"").replaceAll("'","''")+"'";}
function invalidSqlSequenceTargets(sql:string){
  const constraintNames=new Set([...String(sql||"").matchAll(/\b(?:add\s+constraint|constraint)\s+"?([a-z0-9_]+)"?\s+(?:primary\s+key|unique)\b/ig)].map(match=>String(match[1]||"").toLowerCase()));
  return [...new Set([...String(sql||"").matchAll(/\b(?:pg_catalog\.)?setval\s*\(\s*'([^']+)'\s*(?:::regclass)?/ig)].map(match=>String(match[1]||"").replaceAll('"',"")).filter(target=>{
    const relation=target.split(".").at(-1)?.toLowerCase()||"";
    return relation.endsWith("_pkey")||constraintNames.has(relation);
  }))];
}
function managementRows(value:any):any[]{
  if(Array.isArray(value)){
    if(value.length===1&&value[0]&&typeof value[0]==="object"){
      const nested=managementRows(value[0]);if(nested.length)return nested;
    }
    return value;
  }
  if(!value||typeof value!=="object")return [];
  for(const key of ["rows","data","result","results"]){
    const candidate=(value as any)[key];
    if(Array.isArray(candidate))return candidate;
    if(candidate&&typeof candidate==="object"){const nested=managementRows(candidate);if(nested.length)return nested;}
  }
  return [];
}
function validateDatabaseContract(bundle:UpdateBundle){
  const database=(bundle as any).database;
  if(!database||typeof database!=="object"||Array.isArray(database))fail("Update Bundle database migration contract is missing",422);
  const migrations:Array<any>=Array.isArray(database.migrations)?database.migrations:[];
  if(database.format!=="orbitfs-db-migrations-v1"||database.mode!=="shared-panel"||database.provider!=="supabase")fail("Update Bundle database migration contract is invalid",422);
  if(Number(database.migrationCount||0)!==migrations.length||Number((bundle as any).databaseMigrationCount||0)!==migrations.length)fail("Update Bundle database migration count is invalid",422);
  const seen=new Set<string>();let total=0;
  const normalized:DatabaseMigration[]=migrations.map((migration:any)=>{
    const id=String(migration?.id||"").trim(),file=String(migration?.file||"").replaceAll("\\","/");
    if(!/^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/.test(id)||seen.has(id))fail("Update Bundle contains an invalid or duplicate database migration id",422);
    seen.add(id);
    if(!/^supabase\/migrations\/[A-Za-z0-9._\/-]+\.sql$/.test(file)||migration?.encoding!=="base64"||typeof migration?.data!=="string")fail(`Invalid customer database migration: ${file||id}`,422);
    const sql=Buffer.from(migration.data,"base64");total+=sql.byteLength;
    if(sql.byteLength>2*1024*1024||total>8*1024*1024)fail("Customer database migration payload is too large",413);
    const sha=checksum(sql);
    if(Number(migration.size)!==sql.byteLength||String(migration.sha256||"").toLowerCase()!==sha)fail(`Customer database migration checksum mismatch: ${file}`,422);
    const sqlText=sql.toString("utf8");
    if(/\b(?:begin|commit|rollback)\s*;/i.test(sqlText))fail(`Database migration contains unsupported explicit transaction control: ${file}`,422);
    if(/\b(?:drop\s+table|drop\s+schema|truncate\s+(?:table\s+)?|alter\s+table[\s\S]{0,300}?drop\s+column)\b/i.test(sqlText))fail(`Destructive customer database migration is not permitted in an Update release: ${file}`,422);
    const invalidSequenceTargets=invalidSqlSequenceTargets(sqlText);
    if(invalidSequenceTargets.length)fail(`Update migration ${file} contains invalid setval() sequence target(s): ${invalidSequenceTargets.join(", ")}. Rebuild and republish the Update package.`,422,"UPDATE_MIGRATION_SEQUENCE_TARGET_INVALID",false);
    return {id,file,component:String(migration.component||"shared").trim().toLowerCase()||"shared",encoding:"base64" as const,data:migration.data,size:sql.byteLength,sha256:sha};
  });
  const engine=(bundle as any)?.payloads?.engine;
  if(engine&&JSON.stringify(engine.database||null)!==JSON.stringify(database))fail("Update Bundle database contract does not match its Engine payload",422);
  if((bundle as any)?.releaseAnalysis?.flags?.schemaChanged===true&&!normalized.length)fail("Update contains database/schema changes but no customer database migration",422);
  return normalized;
}
async function applyCustomerDatabaseMigrations(install:any,release:any,bundle:UpdateBundle,executionComponents:string[]){
  const allMigrations=validateDatabaseContract(bundle);
  const allowed=new Set(["shared",...executionComponents.map(value=>String(value||"").trim().toLowerCase()).filter(Boolean)]);
  const migrations=allMigrations.filter(migration=>allowed.has(String(migration.component||"shared").toLowerCase()));
  const skippedByEntitlement=allMigrations.filter(migration=>!allowed.has(String(migration.component||"shared").toLowerCase())).map(migration=>migration.id);
  if(!install.supabase_project_ref)fail("Customer Supabase project is not configured for database migrations",409);
  const project=String(install.supabase_project_ref);
  const query=async(sql:string)=>supabaseApi(String(install.auth_user_id),`/projects/${encodeURIComponent(project)}/database/query`,{method:"POST",body:JSON.stringify({query:sql})});
  await query(`create table if not exists public.orbitfs_schema_migrations (
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
  grant all on public.orbitfs_schema_migrations to service_role;`);
  if(!migrations.length)return {required:0,applied:0,skipped:0,ids:[] as string[],skippedByEntitlement};
  const existingRaw=await query("select migration_id,sha256 from public.orbitfs_schema_migrations order by applied_at asc;");
  const rows=managementRows(existingRaw);
  const existing=new Map(rows.filter((row:any)=>row&&row.migration_id).map((row:any)=>[String(row.migration_id),String(row.sha256||"").toLowerCase()]));
  let applied=0,skipped=0;const ids:string[]=[];
  for(const migration of migrations){
    const known=existing.get(migration.id);
    if(known){
      if(known!==migration.sha256)fail(`Customer database migration ${migration.id} was previously applied with a different checksum. Publish a new migration instead of changing migration history.`,409);
      skipped++;ids.push(migration.id);continue;
    }
    const sql=Buffer.from(migration.data,"base64").toString("utf8");
    await event(install,"database.migration.started","info",`Applying database migration ${migration.id}`,{releaseId:release.id,releaseVersion:release.version,file:migration.file,component:migration.component,sha256:migration.sha256});
    try{
      await query(`begin;
${sql}
insert into public.orbitfs_schema_migrations(migration_id,sha256,component,source_file,release_id,release_version,applied_at)
values (${sqlLiteral(migration.id)},${sqlLiteral(migration.sha256)},${sqlLiteral(migration.component||"shared")},${sqlLiteral(migration.file)},${sqlLiteral(release.id)},${sqlLiteral(release.version)},now());
commit;`);
    }catch(error){
      await event(install,"database.migration.failed","error",`Database migration ${migration.id} failed`,{releaseId:release.id,file:migration.file,error:error instanceof Error?error.message:String(error)});
      throw error;
    }
    applied++;ids.push(migration.id);existing.set(migration.id,migration.sha256);
    await event(install,"database.migration.completed","ok",`Database migration ${migration.id} applied`,{releaseId:release.id,file:migration.file,component:migration.component,sha256:migration.sha256});
  }
  return {required:migrations.length,applied,skipped,ids,skippedByEntitlement};
}

type BaseMigration={id:string;file:string;size:number;sha256:string;data:string};
function packagedBaseMigrationEntries(files:Array<{file:string;data:string;sha256:string;size:number}>){
  return files.flatMap(file=>{
    const match=file.file.match(/^supabase\/migrations\/([0-9]{14})_[A-Za-z0-9._-]+\.sql$/);
    return match?[{id:match[1],file:file.file,size:file.size,sha256:file.sha256}]:[];
  }).sort((a,b)=>a.id.localeCompare(b.id)||a.file.localeCompare(b.file));
}
function validateBaseMigrationChain(pkg:Package,files:Array<{file:string;data:string;sha256:string;size:number}>):BaseMigration[]{
  const declared=Array.isArray((pkg as any).databaseMigrations)?(pkg as any).databaseMigrations:[];
  const count=Number((pkg as any).databaseMigrationCount??(pkg as any).releaseInfo?.databaseMigrationCount??0);
  const latest=String((pkg as any).databaseLatestMigration||(pkg as any).releaseInfo?.databaseLatestMigration||"").trim();
  if(!Number.isInteger(count)||count<1||!/^[0-9]{14}$/.test(latest))fail("Base release database migration chain is incomplete",422);
  const inferred=packagedBaseMigrationEntries(files);
  if(inferred.length!==count)fail("Base release database migration count does not match its packaged migration files",422);
  const source=declared.length?declared:inferred;
  if(source.length!==count)fail("Base release database migration chain is incomplete",422);
  const byPath=new Map(files.map(file=>[file.file,file]));
  const seen=new Set<string>();
  const normalized:BaseMigration[]=source.map((migration:any,index:number)=>{
    const id=String(migration?.id||"").trim(),file=String(migration?.file||"").replaceAll("\\","/");
    if(!/^[0-9]{14}$/.test(id)||seen.has(id))fail("Base release contains an invalid or duplicate migration id",422);
    seen.add(id);
    const match=file.match(/^supabase\/migrations\/([0-9]{14})_[A-Za-z0-9._-]+\.sql$/);
    if(!match||match[1]!==id)fail(`Base migration path does not match its id: ${file||id}`,422);
    const packaged=byPath.get(file);
    if(!packaged)fail(`Base migration is missing from the deployment package: ${file}`,422);
    const packagedFile=packaged as {file:string;data:string;sha256:string;size:number};
    const sha=String(migration?.sha256||packagedFile.sha256||"").trim().toLowerCase();
    const size=Number(migration?.size??packagedFile.size);
    if(!/^[a-f0-9]{64}$/.test(sha)||sha!==packagedFile.sha256||size!==packagedFile.size)fail(`Base migration checksum mismatch: ${file}`,422);
    const sqlText=Buffer.from(packagedFile.data,"base64").toString("utf8");
    const invalidSequenceTargets=invalidSqlSequenceTargets(sqlText);
    if(invalidSequenceTargets.length)fail(`Base migration ${file} contains invalid setval() sequence target(s): ${invalidSequenceTargets.join(", ")}. Rebuild and republish the Base package.`,422,"BASE_MIGRATION_SEQUENCE_TARGET_INVALID",false);
    if(index>0&&id<=String(source[index-1]?.id||""))fail("Base migration ids must be strictly increasing",422);
    return {id,file,size:packagedFile.size,sha256:sha,data:packagedFile.data};
  });
  if(normalized.at(-1)?.id!==latest)fail("Base release latest migration does not match its migration chain",422);
  return normalized;
}
function baseDatabaseSnapshotHash(release:any){
  const manifest=release?.manifest&&typeof release.manifest==="object"?release.manifest:{};
  return String(manifest.databaseSchemaSha256||manifest.releaseInfo?.databaseSchemaSha256||"").trim().toLowerCase();
}
async function currentBaseMigrationBaseline(currentRelease:any,target:BaseMigration[]){
  const source=currentRelease?.manifest&&typeof currentRelease.manifest==="object"?currentRelease.manifest:{};
  let count=Number(source.databaseMigrationCount??source.releaseInfo?.databaseMigrationCount??0);
  let latest=String(source.databaseLatestMigration||source.releaseInfo?.databaseLatestMigration||"").trim();
  let declared=Array.isArray(source.databaseMigrations)?source.databaseMigrations:[];
  const manifestCountValid=Number.isInteger(count)&&count>0;
  const manifestLatestValid=/^[0-9]{14}$/.test(latest);
  if(!manifestCountValid||!manifestLatestValid||declared.length<count){
    const parsed=await readArtifact(currentRelease);
    if((parsed.root as any).format==="orbitfs-update-bundle-v3")fail("Installed Base release points to an Update Bundle",409);
    const pkg=parsed.root as Package;
    const files=validateFiles(pkg.files,"Installed Base package");
    const chain=validateBaseMigrationChain(pkg,files);
    const packageCount=chain.length,packageLatest=chain.at(-1)?.id||"";
    if(manifestCountValid&&count!==packageCount)fail("Installed Base release migration count does not match its immutable package",409);
    if(manifestLatestValid&&latest!==packageLatest)fail("Installed Base release latest migration does not match its immutable package",409);
    count=packageCount;
    latest=packageLatest;
    declared=chain;
  }
  if(!Number.isInteger(count)||count<1||count>target.length||!/^[0-9]{14}$/.test(latest))fail("Installed Base release does not contain enough migration baseline metadata for an automatic Base update",409);
  if(target[count-1]?.id!==latest)fail("Target Base release does not extend the installed Base migration history",409);
  if(declared.length<count)fail("Installed Base migration metadata is incomplete",409);
  for(let index=0;index<count;index++){
    const before=declared[index],after=target[index];
    if(String(before?.id||"")!==after.id||String(before?.file||"").replaceAll("\\","/")!==after.file||String(before?.sha256||"").toLowerCase()!==after.sha256){
      fail(`Base migration history diverged at ${after.id}. Published migrations are immutable.`,409);
    }
  }
  return {count,latest};
}
async function installedBaseMigrationBaseline(install:any,currentRelease:any,target:BaseMigration[]){
  if(currentRelease){
    try{return {...await currentBaseMigrationBaseline(currentRelease,target),source:"release"}}
    catch(error:any){
      // If the installed release still exists but its immutable metadata is invalid,
      // do not hide that corruption behind the legacy installation fallback.
      if(String(error?.message||"").includes("migration")||Number(error?.status||0)===422)throw error;
    }
  }

  const history=await licenseDb().from("orbitfs_deployment_events")
    .select("detail,created_at")
    .eq("installation_id",String(install.id))
    .eq("event_type","database.ready")
    .eq("status","ok")
    .order("created_at",{ascending:false})
    .limit(1)
    .maybeSingle();
  if(history.error)throw history.error;
  const detail=history.data?.detail&&typeof history.data.detail==="object"?history.data.detail:{};
  const count=Number((detail as any).databaseMigrationCount??0);
  const latest=String((detail as any).databaseLatestMigration||"").trim();
  if(!Number.isInteger(count)||count<1||count>target.length||!/^[0-9]{14}$/.test(latest)){
    fail("Installed Base migration baseline is unavailable. The retired release record and installation database-ready history do not provide a safe immutable migration prefix.",409,"BASE_MIGRATION_BASELINE_MISSING");
  }
  if(target[count-1]?.id!==latest){
    fail(`Target Base release does not extend the installed database migration history. Installed latest migration is ${latest}; target prefix resolves to ${target[count-1]?.id||"missing"}.`,409,"BASE_MIGRATION_HISTORY_DIVERGED");
  }
  return {count,latest,source:"installation_database_ready"};
}
async function applyBaseDatabaseMigrations(install:any,currentRelease:any,targetRelease:any,pkg:Package,files:Array<{file:string;data:string;sha256:string;size:number}>){
  if(!install.supabase_project_ref)fail("Customer Supabase project is not configured for Base migrations",409);
  const currentSchemaHash=baseDatabaseSnapshotHash(currentRelease);
  const targetSchemaHash=baseDatabaseSnapshotHash(targetRelease);
  if(/^[a-f0-9]{64}$/.test(currentSchemaHash)&&currentSchemaHash===targetSchemaHash){
    await event(install,"base.database.migration.skipped","ok","Base database schema snapshot is unchanged; no forward migration is required.",{
      fromReleaseId:String(currentRelease.id),
      toReleaseId:String(targetRelease.id),
      databaseSchemaSha256:targetSchemaHash
    });
    return {baseline:null,target:null,required:0,seeded:0,applied:0,skipped:0,ids:[] as string[],mode:"schema_unchanged"};
  }
  const chain=validateBaseMigrationChain(pkg,files);
  const baseline=await installedBaseMigrationBaseline(install,currentRelease,chain);
  const project=String(install.supabase_project_ref);
  const query=async(sql:string)=>supabaseApi(String(install.auth_user_id),`/projects/${encodeURIComponent(project)}/database/query`,{method:"POST",body:JSON.stringify({query:sql})});
  await query(`create table if not exists public.orbitfs_schema_migrations (
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
  grant all on public.orbitfs_schema_migrations to service_role;`);
  const existingRaw=await query("select migration_id,sha256,source_file from public.orbitfs_schema_migrations order by applied_at asc;");
  const rows=managementRows(existingRaw);
  const existing=new Map(rows.filter((row:any)=>row&&row.migration_id).map((row:any)=>[String(row.migration_id),{sha256:String(row.sha256||"").toLowerCase(),sourceFile:String(row.source_file||"")}]));
  let seeded=0,applied=0,skipped=0;const ids:string[]=[];

  for(let index=0;index<baseline.count;index++){
    const migration=chain[index],known=existing.get(migration.id);
    if(known){
      if(known.sha256!==migration.sha256||known.sourceFile!==migration.file)fail(`Installed Base migration ${migration.id} conflicts with the published immutable migration history.`,409);
      skipped++;ids.push(migration.id);continue;
    }
    await query(`insert into public.orbitfs_schema_migrations(migration_id,sha256,component,source_file,release_id,release_version,applied_at)
values (${sqlLiteral(migration.id)},${sqlLiteral(migration.sha256)},'shared',${sqlLiteral(migration.file)},${sqlLiteral(currentRelease?.id||install.release_id||"legacy-installed-base")},${sqlLiteral(currentRelease?.version||install.release_version||"unknown")},coalesce(${sqlLiteral(install.database_initialized_at||new Date().toISOString())}::timestamptz,now()))
on conflict (migration_id) do nothing;`);
    existing.set(migration.id,{sha256:migration.sha256,sourceFile:migration.file});seeded++;ids.push(migration.id);
  }

  for(let index=baseline.count;index<chain.length;index++){
    const migration=chain[index],known=existing.get(migration.id);
    if(known){
      if(known.sha256!==migration.sha256||known.sourceFile!==migration.file)fail(`Customer database migration ${migration.id} was previously applied with different immutable metadata.`,409);
      skipped++;ids.push(migration.id);continue;
    }
    const sql=Buffer.from(migration.data,"base64").toString("utf8");
    if(/\b(?:begin|commit|rollback)\s*;/i.test(sql))fail(`Base migration contains unsupported explicit transaction control: ${migration.file}`,422);
    if(/\b(?:drop\s+table|drop\s+schema|truncate\s+(?:table\s+)?|alter\s+table[\s\S]{0,300}?drop\s+column)\b/i.test(sql))fail(`Destructive Base migration requires a deliberately designed migration path and cannot be auto-applied: ${migration.file}`,422);
    await event(install,"base.database.migration.started","info",`Applying Base migration ${migration.id}`,{releaseId:targetRelease.id,releaseVersion:targetRelease.version,file:migration.file,sha256:migration.sha256});
    try{
      await query(`begin;
${sql}
insert into public.orbitfs_schema_migrations(migration_id,sha256,component,source_file,release_id,release_version,applied_at)
values (${sqlLiteral(migration.id)},${sqlLiteral(migration.sha256)},'shared',${sqlLiteral(migration.file)},${sqlLiteral(targetRelease.id)},${sqlLiteral(targetRelease.version)},now());
commit;`);
    }catch(error){
      await event(install,"base.database.migration.failed","error",`Base migration ${migration.id} failed`,{releaseId:targetRelease.id,file:migration.file,error:error instanceof Error?error.message:String(error)});
      throw error;
    }
    applied++;ids.push(migration.id);existing.set(migration.id,{sha256:migration.sha256,sourceFile:migration.file});
    await event(install,"base.database.migration.completed","ok",`Base migration ${migration.id} applied`,{releaseId:targetRelease.id,file:migration.file,sha256:migration.sha256});
  }
  return {baseline:baseline.count,target:chain.length,required:Math.max(0,chain.length-baseline.count),seeded,applied,skipped,ids};
}
async function deploymentDiagnostics(userId:string,id:string){
  try{
    const events=await vercelApi(userId,`/v3/deployments/${encodeURIComponent(id)}/events?direction=backward&follow=0&limit=80&builds=1`,{method:"GET"});
    const rows=Array.isArray(events)?events:[];
    const lines=rows.map((entry:any)=>String(entry?.payload?.text||entry?.text||entry?.payload?.info?.name||"").trim()).filter(Boolean);
    return lines.slice(0,12);
  }catch{return [] as string[]}
}
async function waitForReady(userId:string,id:string):Promise<any>{
  const deadline=Date.now()+Math.max(120000,Number(process.env.ORBITFS_CUSTOMER_DEPLOY_TIMEOUT_MS||600000));let last:any=null;
  while(Date.now()<deadline){
    last=await vercelApi(userId,`/v13/deployments/${encodeURIComponent(id)}`,{method:"GET"});
    const state=String(last?.readyState||last?.state||"").toUpperCase();
    if(state==="READY")return last;
    if(["ERROR","CANCELED","CANCELLED"].includes(state)){
      const diagnostics=await deploymentDiagnostics(userId,id);
      const native=String(last?.errorMessage||last?.error?.message||last?.errorCode||last?.error?.code||"").trim();
      const detail=[native,...diagnostics].filter(Boolean).join(" | ").slice(0,4000);
      const error=Object.assign(new Error(`Vercel deployment failed (${state})${detail?`: ${detail}`:""}`),{status:502,code:String(last?.errorCode||last?.error?.code||"VERCEL_DEPLOYMENT_FAILED"),deploymentId:id,diagnostics});
      throw error;
    }
    await new Promise(r=>setTimeout(r,60000));
  }
  return last;
}
async function registerInstalledBaseRoute(baseUrl:string,install:any,deploymentId:string){
  const secret=await customerInstallationDbSecret(String(install.id));
  const target=String(baseUrl||"").trim().replace(/\/+$/,"");
  if(!target)fail("Deployed Base URL is unavailable for first-time setup registration",502,"BASE_SETUP_ROUTE_UNAVAILABLE",true);
  const response=await fetch(`${target}/api/setup/register-installation`,{
    method:"POST",
    headers:{"content-type":"application/json","x-orbitfs-db-secret":secret,"x-orbitfs-installation-id":String(install.installation_id||"")},
    body:JSON.stringify({installationRoute:"billing_store",registeredBy:"billing_store",deploymentId,projectId:String(install.vercel_project_id||"")}),
    cache:"no-store",
    signal:AbortSignal.timeout(30000)
  });
  const body:any=await response.json().catch(()=>({}));
  if(!response.ok)fail(errorMessage(body?.error??body?.message??body,`Deployed Base setup registration returned ${response.status}`),response.status<500?response.status:502,"BASE_SETUP_ROUTE_REGISTRATION_FAILED",response.status>=500);
  if(body?.installation?.route!=="billing_store")fail("Deployed Base did not confirm the Billing Store installation route",502,"BASE_SETUP_ROUTE_REGISTRATION_FAILED",true);
  return body;
}
async function applyBaseUpdatePatch(install:any,release:any,bundle:UpdateBundle,patch:any,channel:string){
  const installedReleaseId=String(install.release_id||"").trim();
  if(!installedReleaseId)fail("Installed Base release identity is missing",409,"BASE_INSTALLATION_REQUIRED");
  const installedRelease=await exactRelease(installedReleaseId);
  const current=await readCurrentBasePackageForRedeploy(installedRelease);
  const patchFiles=Array.isArray(patch?.files)&&patch.files.length?validateFiles(patch.files,"Base update patch"):[];
  const deletePaths=Array.isArray(patch?.deletePaths)?patch.deletePaths.map((value:any)=>String(value||"").replaceAll("\\","/").trim()).filter(Boolean):[];
  if(!patchFiles.length&&!deletePaths.length)fail("Base update patch contains no changes",422,"UPDATE_BASE_PATCH_EMPTY");
  if(patchFiles.some(file=>/\.sql$/i.test(file.file))||deletePaths.some((file:string)=>/\.sql$/i.test(file)))fail("Base SQL changes must use Update database migrations, not the Base file patch",422,"UPDATE_BASE_PATCH_SQL_INVALID");

  const merged=new Map(current.files.map(file=>[file.file,file]));
  for(const file of deletePaths)merged.delete(file);
  for(const file of patchFiles)merged.set(file.file,file);
  const mergedFiles=[...merged.values()].sort((a,b)=>a.file.localeCompare(b.file));
  validateDeployableBaseFiles(mergedFiles);
  const deploymentFiles=baseVercelDeploymentFiles(mergedFiles);
  const uploadedFiles=await uploadVercelDeploymentFiles(String(install.auth_user_id),deploymentFiles);
  const previousDeploymentId=String(install.vercel_deployment_id||"").trim()||null;
  const body:any={
    name:install.vercel_project_name||`orbitfs-${String(install.installation_id||"").slice(-8)}`.toLowerCase(),
    project:install.vercel_project_id,target:"production",files:uploadedFiles,
    projectSettings:{framework:"sveltekit",installCommand:"npm ci",buildCommand:"npm run build",...(current.pkg.projectSettings||{})},
    meta:{
      orbitfsReleaseId:String(release.id),orbitfsVersion:String(release.version),orbitfsAction:"update-base-patch",
      orbitfsChannel:channel,orbitfsSourceCommit:String(bundle.sourceCommit||expectedSource(release)),
      orbitfsInstallationRoute:"billing_store_updater"
    }
  };
  const created=await vercelApi(String(install.auth_user_id),"/v13/deployments",{method:"POST",body:JSON.stringify(body)});
  if(!created?.id&&!created?.uid)fail("Vercel did not return a Base patch deployment id",502);
  const deploymentId=String(created.id||created.uid);
  const ready=await waitForReady(String(install.auth_user_id),deploymentId);
  if(String(ready?.readyState||ready?.state||"").toUpperCase()!=="READY")fail("Base patch deployment did not become ready",504);
  const deploymentUrl=ready?.url?`https://${String(ready.url).replace(/^https?:\/\//,"")}`:install.deployment_url;
  return {deploymentId,deploymentUrl,previousDeploymentId,fileCount:deploymentFiles.length,patchFileCount:patchFiles.length,deleteCount:deletePaths.length};
}

function expectedEngineProjectName(installationId:string){
  const suffix=String(installationId||"").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,10)||"host";
  return ("orbitfs-engine-"+suffix).slice(0,100);
}
function verifiedInnerDeployment(deployment:any,installationId:string){
  const meta=deployment?.meta&&typeof deployment.meta==="object"?deployment.meta:{};
  return String(meta.orbitfsInstallationId||"").trim()===String(installationId||"").trim() &&
    /^\d+$/.test(String(meta.orbitfsEngineDeployerProtocol||"").trim()) &&
    String(meta.installationRoute||"").trim().length>0 &&
    String(meta.orbitfsDistribution||"").trim().length>0;
}
function normalizedHttpsOrigin(value:any){
  try{
    const url=new URL(String(value||"").trim());
    if(url.protocol!=="https:"||url.username||url.password||url.pathname!=="/"||url.search||url.hash)return null;
    return url.origin;
  }catch{return null}
}
async function selectedEngineHostState(install:any){
  if(!install?.supabase_project_ref||!install?.database_initialized_at)return null;
  try{
    const result=await supabaseApi(String(install.auth_user_id),`/projects/${encodeURIComponent(String(install.supabase_project_ref))}/database/query`,{
      method:"POST",
      body:JSON.stringify({query:"select value from public.orbitfs_settings where scope_type='global' and scope_id='' and key='engine_host.shared' limit 1;"})
    });
    const row=managementRows(result)[0]||null;
    const state=row?.value&&typeof row.value==="object"&&!Array.isArray(row.value)?row.value:null;
    if(!state)return null;
    if(String(state.installationId||"").trim()!==String(install.installation_id||"").trim())return null;
    return state;
  }catch{return null}
}
async function verifiedSelectedEngineHostUrl(install:any,state:any,projectId:string,projectName:string,deploymentId:string|null){
  const selected=normalizedHttpsOrigin(state?.hostUrl);
  if(!selected)return null;
  if(state?.projectId&&String(state.projectId)!==projectId)return null;
  if(state?.projectName&&String(state.projectName)!==projectName)return null;
  const host=new URL(selected).hostname.toLowerCase();
  const allowed=new Set<string>([`${projectName.toLowerCase()}.vercel.app`]);
  let project:any=null;
  try{project=await vercelApi(String(install.auth_user_id),"/v9/projects/"+encodeURIComponent(projectId))}catch{}
  for(const alias of Array.isArray(project?.alias)?project.alias:[])allowed.add(String(alias||"").replace(/^https?:\/\//i,"").replace(/\/$/,"").toLowerCase());
  if(deploymentId){
    try{
      const deployment=await vercelApi(String(install.auth_user_id),"/v13/deployments/"+encodeURIComponent(deploymentId));
      for(const alias of Array.isArray(deployment?.alias)?deployment.alias:[])allowed.add(String(alias||"").replace(/^https?:\/\//i,"").replace(/\/$/,"").toLowerCase());
    }catch{}
  }
  try{
    const result=await vercelApi(String(install.auth_user_id),"/v9/projects/"+encodeURIComponent(projectId)+"/domains");
    for(const domain of Array.isArray(result?.domains)?result.domains:[]){
      if(domain?.verified===false||domain?.misconfigured===true)continue;
      const name=String(domain?.name||"").trim().toLowerCase();
      if(name)allowed.add(name);
    }
  }catch{}
  return allowed.has(host)?selected:null;
}
async function recordSharedEngineDeploymentState(install:any,deploymentId:string,deploymentUrl:string|null){
  if(!install?.supabase_project_ref||!install?.database_initialized_at)return;
  const stamp=new Date().toISOString();
  const sql=`update public.orbitfs_settings
set value=coalesce(value,'{}'::jsonb)||jsonb_build_object(
  'state','ready',
  'deploymentId',${sqlLiteral(deploymentId)}::text,
  'deploymentUrl',${deploymentUrl?sqlLiteral(deploymentUrl)+"::text":"null"},
  'lastSyncAt',${sqlLiteral(stamp)}::text,
  'lastHealthAt',${sqlLiteral(stamp)}::text,
  'lastError',null,
  'updatedAt',${sqlLiteral(stamp)}::text
),
updated_at=${sqlLiteral(stamp)}::timestamptz
where scope_type='global' and scope_id='' and key='engine_host.shared'
returning key;`;
  const result=await supabaseApi(String(install.auth_user_id),`/projects/${encodeURIComponent(String(install.supabase_project_ref))}/database/query`,{
    method:"POST",body:JSON.stringify({query:sql})
  });
  if(!managementRows(result).length)fail("Shared Engine Host state is missing from the customer database",409,"ENGINE_HOST_STATE_MISSING");
}

async function rebindSelectedEngineVercelAlias(install:any,state:any,deploymentId:string,projectId:string){
  if(String(state?.domainMode||"")!=="vercel")return;
  const domain=String(state?.domainName||"").trim().toLowerCase();
  if(!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/.test(domain))fail("Stored Engine Vercel address is invalid",409,"ENGINE_VERCEL_ALIAS_INVALID");
  await vercelApi(String(install.auth_user_id),"/v2/deployments/"+encodeURIComponent(deploymentId)+"/aliases",{method:"POST",body:JSON.stringify({alias:domain,redirect:null})});
  const alias=await vercelApi(String(install.auth_user_id),"/v4/aliases/"+encodeURIComponent(domain));
  const aliasDeploymentId=String(alias?.deploymentId||alias?.deployment?.id||"").trim();
  const aliasProjectId=String(alias?.projectId||alias?.project?.id||alias?.deployment?.projectId||"").trim();
  if(aliasDeploymentId!==deploymentId||(aliasProjectId&&aliasProjectId!==projectId))fail("Selected Engine Vercel address was not moved to the new deployment",502,"ENGINE_VERCEL_ALIAS_REBIND_FAILED",true);
}

async function updaterConnection(install:any){
  const metadata=install?.metadata&&typeof install.metadata==="object"?install.metadata:{};
  const existing=metadata.updaterConnection&&typeof metadata.updaterConnection==="object"?metadata.updaterConnection:{};
  const selectedState=await selectedEngineHostState(install);
  if(existing.linked===true&&existing.autoVerified===true&&existing.provenance==="inner-deployer-v1"&&existing.engineProjectId&&existing.engineProjectName&&/^https:\/\//i.test(String(existing.engineHostUrl||""))){
    const engineProjectId=String(existing.engineProjectId),engineProjectName=String(existing.engineProjectName);
    const currentDeploymentId=String(existing.engineDeploymentId||selectedState?.deploymentId||"").trim()||null;
    const selectedHost=await verifiedSelectedEngineHostUrl(install,selectedState,engineProjectId,engineProjectName,currentDeploymentId);
    const engineHostUrl=selectedHost||String(existing.engineHostUrl).replace(/\/$/,"");
    if(engineHostUrl!==String(existing.engineHostUrl).replace(/\/$/,"")||currentDeploymentId!==String(existing.engineDeploymentId||"").trim()){
      const now=new Date().toISOString();
      const connection={...existing,engineHostUrl,engineDeploymentId:currentDeploymentId,domainMode:selectedState?.domainMode||existing.domainMode||null,domainName:selectedState?.domainName||existing.domainName||null,domainVerified:selectedState?.domainVerified!==false,updatedAt:now,verifiedAt:now};
      await licenseDb().from("orbitfs_installations").update({metadata:{...metadata,updaterConnection:connection},updated_at:now}).eq("id",install.id).eq("auth_user_id",install.auth_user_id);
    }
    return {engineProjectId,engineProjectName,engineHostUrl,engineDeploymentId:currentDeploymentId};
  }

  const installationId=String(install?.installation_id||"").trim();
  if(!installationId)fail("OrbitFS installation identity is missing",409,"UPDATER_INSTALLATION_ID_MISSING");
  const name=expectedEngineProjectName(installationId);
  let project:any=null;
  try{project=await vercelApi(String(install.auth_user_id),"/v9/projects/"+encodeURIComponent(name))}
  catch(error:any){
    if(Number(error?.status||0)!==404)throw error;
  }
  if(!project?.id||String(project.name||"")!==name){
    fail("This installation has no Shared Engine Host created by the Inner Deployer. Manually created Engine projects cannot use the OrbitFS Updater.",409,"UPDATER_INNER_DEPLOYER_REQUIRED");
  }
  const deploymentResponse:any=await vercelApi(String(install.auth_user_id),"/v6/deployments?projectId="+encodeURIComponent(String(project.id))+"&target=production&limit=20");
  const deployments=Array.isArray(deploymentResponse?.deployments)?deploymentResponse.deployments:[];
  let verified:any=null;
  for(const row of deployments.slice(0,10)){
    if(verifiedInnerDeployment(row,installationId)){verified=row;break}
    const id=String(row?.uid||row?.id||"").trim();
    if(!id)continue;
    try{
      const detail=await vercelApi(String(install.auth_user_id),"/v13/deployments/"+encodeURIComponent(id));
      if(verifiedInnerDeployment(detail,installationId)){verified=detail;break}
    }catch{}
  }
  if(!verified)fail("The Shared Engine Host was not created by the Inner Deployer, so this installation cannot use the OrbitFS Updater.",409,"UPDATER_INNER_DEPLOYER_REQUIRED");
  const aliases=Array.isArray(verified.alias)?verified.alias:[];
  const engineDeploymentId=String(verified.uid||verified.id||selectedState?.deploymentId||"").trim()||null;
  const selectedHost=await verifiedSelectedEngineHostUrl(install,selectedState,String(project.id),name,engineDeploymentId);
  const engineHostUrl=selectedHost||"https://"+String(aliases[0]||project.alias?.[0]||name+".vercel.app").replace(/^https?:\/\//i,"").replace(/\/$/,"");
  const now=new Date().toISOString();
  const connection={
    ...existing,
    linked:true,autoVerified:true,provenance:"inner-deployer-v1",
    engineProjectId:String(project.id),engineProjectName:name,engineHostUrl,
    engineDeploymentId,
    domainMode:selectedState?.domainMode||null,domainName:selectedState?.domainName||null,domainVerified:selectedState?.domainVerified!==false,
    verifiedAt:now,linkedAt:existing.linkedAt||now,updatedAt:now
  };
  await licenseDb().from("orbitfs_installations").update({
    metadata:{...metadata,updaterConnection:connection},updated_at:now
  }).eq("id",install.id).eq("auth_user_id",install.auth_user_id);
  return {engineProjectId:String(project.id),engineProjectName:name,engineHostUrl,engineDeploymentId};
}

async function sharedEngineHostHealthy(hostUrl:string){
  const url=String(hostUrl||"").trim();
  if(!/^https?:\/\//i.test(url))return false;
  try{
    const response=await fetch(url,{method:"GET",cache:"no-store",redirect:"follow",signal:AbortSignal.timeout(15000)});
    return response.status<500;
  }catch{return false}
}
async function applyEngineUpdatePayload(install:any,release:any,bundle:UpdateBundle,engine:Package,channel:string,components:string[]){
  const connection=await updaterConnection(install);
  const files=validateFiles(engine.files,"Engine update payload");
  const uploadedFiles=await uploadVercelDeploymentFiles(String(install.auth_user_id),files);
  const body:any={
    name:connection.engineProjectName,
    project:connection.engineProjectId,
    target:"production",
    files:uploadedFiles,
    projectSettings:{framework:"sveltekit",installCommand:"npm ci",buildCommand:"npm run build",...(engine.projectSettings||{})},
    meta:{
      orbitfsReleaseId:String(release.id),
      orbitfsVersion:String(release.version),
      orbitfsAction:"update",
      orbitfsChannel:channel,
      orbitfsSourceCommit:String(bundle.sourceCommit||expectedSource(release)),
      orbitfsInstallationRoute:"billing_store_updater",
      orbitfsUpdateTargets:components.join(",")
    }
  };
  const created=await vercelApi(String(install.auth_user_id),"/v13/deployments",{method:"POST",body:JSON.stringify(body)});
  if(!created?.id&&!created?.uid)fail("Vercel did not return an Engine Host update deployment id",502);
  const deploymentId=String(created.id||created.uid);
  const ready=await waitForReady(String(install.auth_user_id),deploymentId);
  const state=String(ready?.readyState||ready?.state||"").toUpperCase();
  if(state!=="READY")fail("Engine Host update deployment did not become ready within the deployment window",504);
  const selectedState=await selectedEngineHostState(install);
  await rebindSelectedEngineVercelAlias(install,selectedState,deploymentId,connection.engineProjectId);
  const deploymentUrl=ready?.url?`https://${String(ready.url).replace(/^https?:\/\//,"")}`:connection.engineHostUrl;
  const hostUrl=connection.engineHostUrl||deploymentUrl;
  if(!hostUrl||!await sharedEngineHostHealthy(hostUrl))fail("Updated Shared Engine Host is not healthy",502,"ENGINE_HOST_UNHEALTHY",true);
  await recordSharedEngineDeploymentState(install,deploymentId,deploymentUrl);
  return {
    deploymentId,
    deploymentUrl,
    hostUrl,
    state:"ready",
    previousDeploymentId:connection.engineDeploymentId,
    componentVersions:engine.componentVersions||{},
    updatePlan:{executor:"orbitfs-updater-v2",components,projectId:connection.engineProjectId}
  };
}
async function rollbackEngineUpdatePayload(install:any,previousDeploymentId:string|null){
  const connection=await updaterConnection(install);
  if(!previousDeploymentId)fail("No previous Engine Host deployment is recorded for rollback",409,"ENGINE_ROLLBACK_TARGET_MISSING");
  const rollbackDeploymentId=String(previousDeploymentId);
  await vercelApi(String(install.auth_user_id),`/v9/projects/${encodeURIComponent(connection.engineProjectId)}/rollback/${encodeURIComponent(rollbackDeploymentId)}`,{method:"POST",body:JSON.stringify({})});
  await rebindSelectedEngineVercelAlias(install,await selectedEngineHostState(install),rollbackDeploymentId,connection.engineProjectId);
  await recordSharedEngineDeploymentState(install,rollbackDeploymentId,connection.engineHostUrl||null);
  return {deploymentId:rollbackDeploymentId,hostUrl:connection.engineHostUrl,state:"ready"};
}
async function previousDeployment(install:any):Promise<{vercel_deployment_id:string;deployment_url:string|null;release_version:string;release_id:string;created_at:string}>{const {data,error}=await licenseDb().from("orbitfs_installation_releases").select("vercel_deployment_id,deployment_url,release_version,release_id,created_at,action").eq("installation_id",install.id).eq("status","ready").neq("action","update").not("vercel_deployment_id","is",null).order("created_at",{ascending:false}).limit(5);if(error)throw error;const previous=(data||[]).find((r:any)=>String(r.release_id||"")!==String(install.release_id||""));if(!previous)throw Object.assign(new Error("No previous successful Base deployment is available for rollback"),{status:409});if(!previous.vercel_deployment_id||!previous.release_id||!previous.release_version)throw Object.assign(new Error("Previous Base deployment record is incomplete and cannot be rolled back"),{status:409});return {vercel_deployment_id:String(previous.vercel_deployment_id),deployment_url:previous.deployment_url?String(previous.deployment_url):null,release_version:String(previous.release_version),release_id:String(previous.release_id),created_at:String(previous.created_at||"")}}

async function runBaseUpdateDeployment(install:any,release:any,requestedChannel:string,authorityLicenseId:string,progress?:OperationProgress){
  const currentReleaseId=String(install.release_id||"").trim(),currentVersion=String(install.release_version||"").trim();
  const projectId=String(install.vercel_project_id||"").trim(),previousDeploymentId=String(install.vercel_deployment_id||"").trim();
  if(!currentReleaseId||!currentVersion)fail("Install OrbitFS Base before running a Base update",409,"BASE_INSTALLATION_REQUIRED");
  if(!projectId||!previousDeploymentId)fail("The existing Base Vercel project/deployment identity is missing. Base update will not create a replacement project.",409,"BASE_PROJECT_NOT_FOUND");
  const comparison=compareOrbitReleaseVersions(String(release.version||""),currentVersion);
  if(comparison===null)fail("Base versions could not be compared safely",409,"BASE_VERSION_COMPARISON_FAILED");
  const versionComparison=comparison as number;
  if(versionComparison===0)fail("This Base version is already installed. Use Redeploy current Base instead.",409,"BASE_ALREADY_INSTALLED");
  if(versionComparison<0)fail("Base update cannot downgrade an installation. Use the explicit Base rollback route.",409,"BASE_DOWNGRADE_REQUIRES_ROLLBACK");

  const currentRelease=await exactRelease(currentReleaseId);
  if(String(currentRelease.release_type||"").toLowerCase()!=="base")fail("Installed release identity is not a Base release",409,"BASE_RELEASE_IDENTITY_INVALID");
  const target=await readBasePackage(release);
  const targetSchemaVersion=String((target.pkg as any).databaseSchemaVersion||(target.pkg as any).releaseInfo?.databaseSchemaVersion||"").trim();
  if(!targetSchemaVersion)fail("Target Base release does not declare a customer database schema version",422,"ARTIFACT_INVALID");

  let createdDeploymentId="";
  let migrations:any=null;
  await licenseDb().from("orbitfs_installations").update({state:"updating",last_error:null,updated_at:new Date().toISOString()}).eq("id",install.id);
  await event(install,"base.update.started","info",`Updating OrbitFS Base ${currentVersion} → ${release.version}`,{fromReleaseId:currentReleaseId,toReleaseId:String(release.id),projectId});

  try{
    await progress?.("validated",{fromReleaseId:currentReleaseId,toReleaseId:String(release.id),projectId,fromVersion:currentVersion,toVersion:String(release.version)});
    await progress?.("migrating",{fromVersion:currentVersion,toVersion:String(release.version)});
    migrations=await applyBaseDatabaseMigrations(install,currentRelease,release,target.pkg,target.files);
    const deploymentInstall={...install,schema_version:targetSchemaVersion};
    await configureVercel(deploymentInstall,String(release.version),undefined,requestedChannel,String(release.id),target.artifactSha256,String(target.pkg.sourceCommit||expectedSource(release)));

    const uploadedFiles=await uploadVercelDeploymentFiles(String(install.auth_user_id),baseVercelDeploymentFiles(target.files));
    const body:any={
      name:install.vercel_project_name||`orbitfs-${String(install.installation_id||"").slice(-8)}`.toLowerCase(),
      project:projectId,
      target:"production",
      files:uploadedFiles,
      projectSettings:{framework:"sveltekit",installCommand:"npm ci",buildCommand:"npm run build",...(target.pkg.projectSettings||{})},
      meta:{orbitfsReleaseId:String(release.id),orbitfsVersion:String(release.version),orbitfsAction:"base_update",orbitfsChannel:requestedChannel,orbitfsSourceCommit:String(target.pkg.sourceCommit||expectedSource(release)),orbitfsInstallationRoute:"billing_store"}
    };
    await progress?.("deploying",{projectId,fileCount:target.files.length,databaseMigrations:migrations});
    await event(install,"base.update.deploying","info",`Deploying Base ${release.version} to the existing Vercel project`,{projectId,fileCount:target.files.length,databaseMigrations:migrations});
    await ensureStandardPanelProtection(install);
    const created=await vercelApi(String(install.auth_user_id),"/v13/deployments",{method:"POST",body:JSON.stringify(body)});
    if(!created?.id&&!created?.uid)fail("Vercel did not return a Base update deployment id",502);
    createdDeploymentId=String(created.id||created.uid);
    await licenseDb().from("orbitfs_installations").update({vercel_deployment_id:createdDeploymentId,state:"updating",last_error:null,updated_at:new Date().toISOString()}).eq("id",install.id);
    await progress?.("verifying",{projectId,deploymentId:createdDeploymentId});

    const ready=await waitForReady(String(install.auth_user_id),createdDeploymentId);
    if(String(ready?.readyState||ready?.state||"").toUpperCase()!=="READY")fail("Base update deployment did not become ready within the deployment window",504,"VERCEL_DEPLOY_FAILED",true);
    const deploymentUrl=ready?.url?`https://${String(ready.url).replace(/^https?:\/\//,"")}`:String(install.deployment_url||"");
    if(!deploymentUrl)fail("Vercel Base update did not return a deployment URL",502,"VERCEL_DEPLOY_FAILED",true);

    const selectedBaseAlias=await ensureSelectedBaseVercelAliasOnDeployment(install,createdDeploymentId);
    const productionUrl=selectedBaseAlias?`https://${selectedBaseAlias}`:await resolveProductionUrl(install,ready);
    const settings=await billingOrbitfsConfig();
    if(productionUrl&&!await checkPublicPanelHealth(productionUrl,settings.health_path||"/api/health")){
      await event(install,"base.update.public_health","warning","Production domain is not publicly healthy; check Vercel protection and application health",{productionUrl});
    }

    await configureVercel(deploymentInstall,String(release.version),productionUrl||undefined,requestedChannel,String(release.id),target.artifactSha256,String(target.pkg.sourceCommit||expectedSource(release)));
    const completedAt=new Date().toISOString();
    const metadata={...(install.metadata&&typeof install.metadata==="object"?install.metadata:{}),lastBaseUpdate:{fromVersion:currentVersion,toVersion:String(release.version),fromReleaseId:currentReleaseId,toReleaseId:String(release.id),databaseMigrations:migrations,completedAt}};
    const patch:any={
      metadata,
      schema_version:targetSchemaVersion,
      release_channel:requestedChannel,
      vercel_deployment_id:createdDeploymentId,
      deployment_url:deploymentUrl,
      production_url:productionUrl,
      health_status:"unknown",
      release_version:String(release.version),
      release_id:String(release.id),
      release_sha256:target.artifactSha256,
      release_source_commit:String(target.pkg.sourceCommit||expectedSource(release)||"")||null,
      previous_release_version:currentVersion,
      last_deployment_at:completedAt,
      last_error:null,
      state:"ready"
    };
    const {data,error}=await licenseDb().from("orbitfs_installations").update(patch).eq("id",install.id).select().single();
    if(error)throw error;
    const history=await licenseDb().from("orbitfs_installation_releases").insert({
      installation_id:install.id,
      auth_user_id:install.auth_user_id,
      release_version:String(release.version),
      release_id:String(release.id),
      release_sha256:target.artifactSha256,
      source_commit:String(target.pkg.sourceCommit||expectedSource(release)||"")||null,
      vercel_deployment_id:createdDeploymentId,
      panel_deployment_id:createdDeploymentId,
      deployment_url:deploymentUrl,
      action:"base_update",
      release_type:"base",
      components:["base"],
      status:"ready",
      ready_at:completedAt
    });
    if(history.error)throw history.error;
    const customerResult=await licenseDb().from("customers").select("id,customer_number,name,email").eq("auth_user_id",install.auth_user_id).maybeSingle();
    const customer=customerResult.data||null;
    await masterExecuteDeployment({action:"base_update",phase:"completed",releaseId:String(release.id),installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel:requestedChannel,productVersion:String(release.version),previousVersion:currentVersion,deploymentId:createdDeploymentId,deploymentUrl,projectId,projectName:install.vercel_project_name,componentState:{base:{version:String(release.version),status:"installed"}},components:{base:{version:String(release.version),status:"installed"}},customerIdentity:{customerId:customer?.id||null,customerNumber:customer?.customer_number||null,customerName:customer?.name||null,customerEmail:customer?.email||null,installationId:install.installation_id}});
    await event(data,"base.update.completed","ok",`OrbitFS Base updated from ${currentVersion} to ${release.version}`,{releaseId:String(release.id),deploymentId:createdDeploymentId,projectId,databaseMigrations:migrations});
    return data;
  }catch(error:any){
    const message=errorMessage(error,"Base update failed");
    const recovery:any={databaseMigrations:migrations?"forward migrations retained":"not started",freshDeploymentRestore:false,environmentRestored:false};
    let restoredDeploymentId=previousDeploymentId;
    let restoredDeploymentUrl=String(install.production_url||install.deployment_url||"");
    try{
      const previousPackage=await readBasePackage(currentRelease);
      await configureVercel(install,currentVersion,restoredDeploymentUrl||undefined,requestedChannel,currentReleaseId,previousPackage.artifactSha256,String(previousPackage.pkg.sourceCommit||expectedSource(currentRelease)));
      recovery.environmentRestored=true;
      const recoveryDeploymentFiles=baseVercelDeploymentFiles(previousPackage.files);
      const uploadedFiles=await uploadVercelDeploymentFiles(String(install.auth_user_id),recoveryDeploymentFiles);
      const recoveryBody:any={
        name:install.vercel_project_name||`orbitfs-${String(install.installation_id||"").slice(-8)}`.toLowerCase(),
        project:projectId,
        target:"production",
        files:uploadedFiles,
        projectSettings:{framework:"sveltekit",installCommand:"npm ci",buildCommand:"npm run build",...(previousPackage.pkg.projectSettings||{})},
        meta:{orbitfsReleaseId:currentReleaseId,orbitfsVersion:currentVersion,orbitfsAction:"base_update_recovery",orbitfsChannel:requestedChannel,orbitfsSourceCommit:String(previousPackage.pkg.sourceCommit||expectedSource(currentRelease)),orbitfsInstallationRoute:"billing_store"}
      };
      const restored=await vercelApi(String(install.auth_user_id),"/v13/deployments",{method:"POST",body:JSON.stringify(recoveryBody)});
      if(!restored?.id&&!restored?.uid)fail("Vercel did not return a Base recovery deployment id",502);
      restoredDeploymentId=String(restored.id||restored.uid);
      const restoredReady=await waitForReady(String(install.auth_user_id),restoredDeploymentId);
      if(String(restoredReady?.readyState||restoredReady?.state||"").toUpperCase()!=="READY")fail("Base recovery deployment did not become ready",502);
      restoredDeploymentUrl=restoredReady?.url?`https://${String(restoredReady.url).replace(/^https?:\/\//,"")}`:restoredDeploymentUrl;
      await configureVercel(install,currentVersion,restoredDeploymentUrl||undefined,requestedChannel,currentReleaseId,previousPackage.artifactSha256,String(previousPackage.pkg.sourceCommit||expectedSource(currentRelease)));
      recovery.freshDeploymentRestore=true;
      recovery.restoredDeploymentId=restoredDeploymentId;
    }catch(restoreError:any){
      recovery.restoreError=errorMessage(restoreError,"Base recovery deployment failed");
    }
    const recoveryReady=recovery.freshDeploymentRestore===true;
    await Promise.allSettled([
      licenseDb().from("orbitfs_installations").update({vercel_deployment_id:restoredDeploymentId||null,deployment_url:restoredDeploymentUrl||install.deployment_url||null,state:recoveryReady?"ready":"failed",last_error:message,updated_at:new Date().toISOString()}).eq("id",install.id),
      masterExecuteDeployment({action:"base_update",phase:"failed",releaseId:String(release.id),installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel:requestedChannel,productVersion:String(release.version),previousVersion:currentVersion,projectId,projectName:install.vercel_project_name,error:message}),
      event(install,"base.update.failed",recoveryReady?"warning":"error",message,{fromVersion:currentVersion,toVersion:String(release.version),projectId,recovery})
    ]);
    throw Object.assign(error instanceof Error?error:new Error(message),{orbitfsFailureReported:true,recovery});
  }
}

async function reportDeploymentFailure(install:any,input:{action:DeployAction;releaseId:string;licenseId:string;channel:string;productVersion?:string},error:unknown){
  const message=errorMessage(error,"Deployment failed");
  await Promise.allSettled([
    masterExecuteDeployment({action:input.action,phase:"failed",releaseId:input.releaseId,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:input.licenseId,channel:input.channel,productVersion:input.productVersion,previousVersion:install.release_version||null,projectId:install.vercel_project_id||null,projectName:install.vercel_project_name||null,error:message}),
    // Update execution is separate from Base installation health. A rejected
    // or failed Update must never overwrite an otherwise valid Base install
    // as failed; Update state is reported through deployment authority + events.
    ...(input.action==="update"?[]:[
      licenseDb().from("orbitfs_installations").update({state:"failed",last_error:message}).eq("id",install.id)
    ]),
    event(install,input.action==="base_update"?"base.update.failed":input.action==="update"?"update.failed":input.action==="rollback"?"deployment.rollback.failed":"deployment.failed","error",message,{action:input.action,releaseId:input.releaseId})
  ]);
}

export async function rollbackCustomerUpdate(install:any,reason:string){
  const rollbackReason=String(reason||"").trim();
  if(!rollbackReason)fail("A rollback reason is required",400);
  await requireSystem("rollback");
  const applied=install?.metadata?.appliedUpdate&&typeof install.metadata.appliedUpdate==="object"?install.metadata.appliedUpdate:null;
  const releaseId=String(applied?.releaseId||"").trim(),releaseVersion=String(applied?.version||"").trim();
  if(!releaseId||!releaseVersion)fail("No applied Update release is available to roll back",409);
  const components:string[]=[...new Set<string>((Array.isArray(applied?.components)?applied.components:[]).map((value:any)=>String(value||"").trim().toLowerCase()).filter(Boolean))];
  if(!components.length)fail("Applied Update component history is incomplete",409);
  const channel=String(applied?.channel||install.release_channel||"stable").trim().toLowerCase();
  const bindingResult=await licenseDb().from("license_bindings").select("license_id").eq("id",String(install.license_binding_id||"")).eq("auth_user_id",String(install.auth_user_id||"")).is("archived_at",null).maybeSingle();
  if(bindingResult.error)throw bindingResult.error;
  const authorityLicenseId=String(bindingResult.data?.license_id||"").trim();
  if(!authorityLicenseId)fail("This installation is not linked to an authoritative Billing licence",409,"LICENSE_BINDING_REQUIRED");
  const wantsPanel=components.includes("base"),wantsEngine=components.some((component:string)=>component!=="base");
  await masterExecuteDeployment({action:"rollback",rollbackScope:"update",releaseId,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel,productVersion:String(install.release_version||""),previousVersion:releaseVersion,components});
  await event(install,"update.rollback.started","info",`Rolling back OrbitFS Update ${releaseVersion}`,{releaseId,components,reason:rollbackReason});
  let engineResult:any=null,panelResult:any=null;
  try{
    if(wantsEngine){
      const previousEngineDeploymentId=String(applied?.enginePreviousDeploymentId||"").trim()||null;
      engineResult=await rollbackEngineUpdatePayload(install,previousEngineDeploymentId);
    }
    if(wantsPanel){
      if(!install.vercel_project_id)fail("Customer Vercel project is unavailable for Base patch rollback",409);
      const previousDeploymentId=String(applied?.basePreviousDeploymentId||"").trim();
      if(!previousDeploymentId)fail("No previous Base deployment was recorded for this Update",409,"UPDATE_BASE_ROLLBACK_TARGET_MISSING");
      await vercelApi(install.auth_user_id,`/v9/projects/${encodeURIComponent(String(install.vercel_project_id))}/rollback/${encodeURIComponent(previousDeploymentId)}`,{method:"POST",body:JSON.stringify({})});
      panelResult={vercel_deployment_id:previousDeploymentId,deployment_url:install.deployment_url||null};
    }
    const completedAt=new Date().toISOString();
    const rolledBackUpdate={...applied,rolledBackAt:completedAt,rollbackReason,restoredEngineDeploymentId:engineResult?.deploymentId||null,restoredBaseDeploymentId:panelResult?.vercel_deployment_id||null,databaseMigrations:"retained-forward-compatible"};
    const metadata={
      ...(install.metadata&&typeof install.metadata==="object"?install.metadata:{}),
      appliedUpdate:null,
      rolledBackUpdate,
      ...(engineResult?{updaterConnection:{
        ...((install.metadata?.updaterConnection&&typeof install.metadata.updaterConnection==="object")?install.metadata.updaterConnection:{}),
        linked:true,
        engineDeploymentId:engineResult.deploymentId||null,
        engineHostUrl:engineResult.hostUrl||install.metadata?.updaterConnection?.engineHostUrl||null,
        updatedAt:completedAt
      }}:{})
    };
    const patch:any={metadata,last_deployment_at:completedAt,last_error:null,state:"ready"};
    if(panelResult){patch.vercel_deployment_id=panelResult.vercel_deployment_id;patch.deployment_url=panelResult.deployment_url||install.deployment_url;}
    const {data,error}=await licenseDb().from("orbitfs_installations").update(patch).eq("id",install.id).select().single();
    if(error)throw error;
    const history=await licenseDb().from("orbitfs_installation_releases").insert({installation_id:install.id,auth_user_id:install.auth_user_id,release_version:releaseVersion,release_id:releaseId,release_sha256:String(applied?.sha256||"")||null,source_commit:String(applied?.sourceCommit||"")||null,vercel_deployment_id:panelResult?.vercel_deployment_id||null,deployment_url:panelResult?.deployment_url||null,action:"rollback",status:"ready",ready_at:completedAt});
    if(history.error)throw history.error;
    const restoredEngineVersions=engineResult?.componentVersions&&typeof engineResult.componentVersions==="object"?engineResult.componentVersions:{};
    const restoredComponentState=Object.fromEntries(components.map((component:string)=>[component,{version:String(component==="base"?install.release_version:(restoredEngineVersions?.[component]||engineResult?.restoredVersion||"")),status:"installed"}]));
    await masterExecuteDeployment({action:"rollback",rollbackScope:"update",phase:"completed",releaseId,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel,productVersion:String(install.release_version||""),previousVersion:releaseVersion,deploymentId:panelResult?.vercel_deployment_id||engineResult?.deploymentId||null,deploymentUrl:panelResult?.deployment_url||engineResult?.hostUrl||null,projectId:install.vercel_project_id,projectName:install.vercel_project_name,componentState:restoredComponentState,components:restoredComponentState});
    await event(data,"update.rollback.completed","ok",`OrbitFS Update ${releaseVersion} rolled back`,{releaseId,components,reason:rollbackReason,engine:engineResult,panel:panelResult,databaseMigrations:"retained-forward-compatible"});
    return data;
  }catch(error){
    const message=error instanceof Error?error.message:String(error||"Update rollback failed");
    await Promise.allSettled([
      masterExecuteDeployment({action:"rollback",rollbackScope:"update",phase:"failed",releaseId,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel,productVersion:String(install.release_version||""),previousVersion:releaseVersion,components,error:message}),
      // A failed Update rollback must not overwrite the independently verified Base state.
      event(install,"update.rollback.failed","error",message,{releaseId,components,reason:rollbackReason,engine:engineResult,panel:panelResult})
    ]);
    throw error;
  }
}

type OperationProgress=(state:"validated"|"deploying"|"migrating"|"verifying"|"promoting",detail?:Record<string,unknown>)=>Promise<void>;

export async function runCustomerDeployer(install:any,action:DeployAction,version?:string,channel?:string,releaseId?:string,reason?:string,progress?:OperationProgress){
  const requestedChannel=String(channel||install.release_channel||"stable").trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(requestedChannel))fail("Invalid release channel",400);
  const allowedChannels=await customerReleaseChannels(String(install.auth_user_id),install.license_binding_id||null);
  if(!allowedChannels.includes(requestedChannel))fail(`Release channel "${requestedChannel}" is not available for this installation's licence`,403);
  await requireSystem(action==="rollback"?"rollback":action==="base_update"?"base_update":action==="update"?"update":"deploy");
  const bindingResult=await licenseDb().from("license_bindings").select("license_id").eq("id",String(install.license_binding_id||"")).eq("auth_user_id",String(install.auth_user_id||"")).is("archived_at",null).maybeSingle();
  if(bindingResult.error)throw bindingResult.error;
  const authorityLicenseId=String(bindingResult.data?.license_id||"").trim();
  if(!authorityLicenseId)fail("This installation is not linked to an authoritative Billing licence",409,"LICENSE_BINDING_REQUIRED");

  let rollbackTarget:any=null;
  let rollbackReason="";
  if(action==="rollback"){
    rollbackReason=String(reason||"").trim();
    if(!rollbackReason)fail("A rollback reason is required",400);
    const previous=await previousDeployment(install);
    const rolledBackReleaseId=String(install.release_id||"").trim();
    const rolledBackVersion=String(install.release_version||"").trim();
    if(!rolledBackReleaseId||!rolledBackVersion)fail("Current Base release metadata is incomplete and cannot be recorded as rolled back",409);
    if(install.release_channel&&String(install.release_channel)!==requestedChannel)fail("Installation release channel does not match the requested rollback channel",409);
    rollbackTarget=await exactRelease(previous.release_id);
    if(String(rollbackTarget.release_type||"").toLowerCase()!=="base")fail("Rollback target is not a Base release",409);
    if(String(rollbackTarget.review_status||"").toLowerCase()!=="approved"||!String(rollbackTarget.checksum||rollbackTarget.sha256||"").trim())fail("Previous Base release is not a verified rollback artifact",409);
    await event(install,"deployment.rollback.started","info",`Restoring Base ${previous.release_version} as a fresh deployment`,{reason:rollbackReason,targetReleaseId:previous.release_id,previousDeploymentId:previous.vercel_deployment_id});
  }

  // Redeploy always resolves the currently published Base for the selected channel.
  // Rollback is the only Base action allowed to restore an approved historical artifact.
  const effectiveReleaseId=action==="redeploy"?undefined:releaseId;
  const effectiveVersion=action==="redeploy"?undefined:version;
  const release=rollbackTarget||await publishedRelease(effectiveVersion,action,requestedChannel,effectiveReleaseId);
  // Authorization must succeed before touching the customer's deployment.
  // Persist the authoritative rejection code so a refresh explains the failed
  // preflight instead of leaving an ambiguous, apparently running Update.
  let deploymentAuthorization:MasterDeploymentResult|null=null;
  try{
    deploymentAuthorization=await masterExecuteDeployment({action,releaseId:release.id,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel:requestedChannel,productVersion:String(release.version),previousVersion:install.release_version||null,projectId:install.vercel_project_id||null,projectName:install.vercel_project_name||null});
  }catch(error:any){
    const code=String(error?.code||"LICENSE_MANAGER_AUTHORIZATION_FAILED").trim();
    const message=errorMessage(error,"License Manager declined deployment authorization");
    const eventType=action==="update"?"update.authorization.failed":action==="base_update"?"base.update.authorization.failed":"deployment.authorization.failed";
    // An authorization rejection is not a failed deployment. Keep the
    // installed version and state intact and preserve the authority's code.
    try{
      await event(install,eventType,"error",`License Manager authorization rejected: ${message} [${code}]`,
        {action,releaseId:String(release.id),releaseVersion:String(release.version),code,httpStatus:Number(error?.status)||null});
    }catch(eventError){console.error("Could not record License Manager authorization rejection",eventError)}
    throw error;
  }
  if(action!=="base_update")await progress?.("validated",{releaseId:String(release.id),releaseVersion:String(release.version),projectId:install.vercel_project_id||null});
  try{
  if(action==="base_update")return await runBaseUpdateDeployment(install,release,requestedChannel,authorityLicenseId,progress);
  if(action==="update"){
    const parsed=await readArtifact(release);
    if((parsed.root as any).format!=="orbitfs-update-bundle-v3")fail("Published Update release is not an OrbitFS Update Bundle v3",422);
    const bundle=parsed.root as UpdateBundle;
    const allowedUpdateComponents=new Set(["base","apex","mcp","studio"]);
    const normalizeComponent=(value:unknown)=>{
      const component=String(value||"").trim().toLowerCase();
      return component==="orbitfs_base"||component==="core"?"base":component==="orbitfs_mcp"?"mcp":component==="orbitfs_apex"?"apex":component==="orbitfs_studio"?"studio":component;
    };
    const bundleComponents=[...new Set(bundle.components.map(normalizeComponent).filter(Boolean))];
    if(!bundleComponents.length||bundleComponents.some(value=>!allowedUpdateComponents.has(value)))fail("Update Bundle contains an unsupported deployment target",422,"UPDATE_SCOPE_INVALID");
    const legacyEngineOnlyScope=bundle.updateScope==="engine-components-only-v1";
    const updaterScope=bundle.updateScope==="deployed-system-v2"||bundle.updateScope==="deployed-system-v1"||legacyEngineOnlyScope;
    if(!updaterScope)fail("Update Bundle scope does not match its deployed-system targets",422,"UPDATE_SCOPE_INVALID");
    const legacyExecutor=bundle.executor==="orbitfs-base-inner-deployer-v1";
    if(bundle.executor!=="orbitfs-updater-v2"&&!legacyExecutor)fail("Update Bundle is not assigned to the OrbitFS Updater",422,"UPDATE_EXECUTOR_INVALID");
    if(!legacyExecutor){
      const requiredUpdaterProtocol=Number(bundle.minimumUpdaterProtocol||0);
      if(!Number.isInteger(requiredUpdaterProtocol)||requiredUpdaterProtocol<1)fail("Update Bundle is missing a valid minimum Updater protocol",422,"UPDATE_UPDATER_PROTOCOL_INVALID");
      if(requiredUpdaterProtocol>ORBITFS_UPDATER_PROTOCOL)fail(`Update ${release.version} requires Updater protocol ${requiredUpdaterProtocol}, but this Updater provides protocol ${ORBITFS_UPDATER_PROTOCOL}.`,409,"UPDATE_UPDATER_PROTOCOL_UNSUPPORTED");
    }
    if(bundle.baseBaseline!==undefined&&bundle.baseBaseline!==null)fail("Update Bundle contains unsupported Base baseline data",422,"UPDATE_SCOPE_INVALID");

    const releaseComponents=(Array.isArray(release?.manifest?.components)?release.manifest.components:[]).map(normalizeComponent).filter(Boolean).sort();
    if(releaseComponents.length&&(releaseComponents.some((value:string)=>!allowedUpdateComponents.has(value))||releaseComponents.join(",")!==bundleComponents.slice().sort().join(",")))fail("Update Bundle targets do not match License Manager targets",422,"UPDATE_SCOPE_INVALID");

    const authoritativeComponents:string[]=Array.isArray(deploymentAuthorization?.componentPlan?.executionComponents)
      ?deploymentAuthorization.componentPlan.executionComponents.map(normalizeComponent).filter(Boolean)
      :[];
    if(authoritativeComponents.some(value=>!allowedUpdateComponents.has(value)))fail("License Manager returned an unsupported Update target",502,"UPDATE_AUTHORITY_SCOPE_INVALID");
    const components:string[]=[...new Set<string>(authoritativeComponents.filter(value=>bundleComponents.includes(value)))];
    const skippedComponents=bundleComponents.filter(component=>!components.includes(component));
    if(deploymentAuthorization?.notApplicable===true||!components.length){
      await event(install,"update.skipped","ok",`OrbitFS Update ${release.version} has no applicable targets for this installation`,{releaseId:release.id,releaseComponents:bundleComponents,skippedComponents,componentPlan:deploymentAuthorization?.componentPlan||null});
      return {...install,updateSkipped:true,updateVersion:String(release.version),skippedComponents};
    }

    const installedBase=String(install.release_version||"").trim();
    if(!installedBase)fail("Deploy OrbitFS Base before applying an Update release",409,"BASE_INSTALLATION_REQUIRED");
    if(!install.vercel_project_id)fail("The existing OrbitFS Base Vercel project is unavailable for this Update",409,"BASE_PROJECT_NOT_FOUND");
    const requiredBase=String(bundle.minimumBaseVersion||"").trim();
    const baseComparison=requiredBase?compareOrbitReleaseVersions(installedBase,requiredBase):0;
    if(requiredBase&&(baseComparison===null||baseComparison<0))fail(`Update ${release.version} requires Base ${requiredBase} or newer; this installation is Base ${installedBase}.`,409,"BASE_VERSION_TOO_OLD");

    const panel=bundle.payloads?.panel??null;
    const engine=bundle.payloads?.engine??null;
    const appliesBase=components.includes("base");
    const engineComponents=components.filter(component=>component!=="base");
    const appliesEngine=engineComponents.length>0;
    if(appliesBase&&!panel)fail("Update targets Base files but has no Base patch payload",422,"UPDATE_BASE_PAYLOAD_REQUIRED");
    if(!appliesBase&&panel)fail("Update contains a Base patch without Base authorization",422,"UPDATE_SCOPE_INVALID");
    if(appliesEngine&&!engine)fail("Update targets Engine/addons but has no Engine payload",422,"UPDATE_ENGINE_PAYLOAD_REQUIRED");
    if(!appliesEngine&&engine)fail("Update contains an Engine payload without an Engine/addon target",422,"UPDATE_SCOPE_INVALID");
    if(engine)validateFiles((engine as Package).files,"Engine update payload");

    const declaredMigrations=validateDatabaseContract(bundle);
    const applicableMigrations=declaredMigrations.filter(migration=>String(migration.component||"shared")==="shared"||components.includes(String(migration.component||"").toLowerCase()));
    await event(install,"update.started","info",`Applying OrbitFS Update ${release.version} to the existing deployment`,{releaseId:release.id,components,checksum:parsed.artifactSha256,databaseMigrationCount:applicableMigrations.length,skippedComponents});

    let basePatchResult:any=null;
    let basePatchAttempted=false;
    let engineResult:any=null;
    let engineAttempted=false;
    let databaseResult:any=null;
    try{
      databaseResult=await applyCustomerDatabaseMigrations(install,release,bundle,components);
      await event(install,"update.database.completed","ok","Update database migration check completed",{releaseId:release.id,releaseVersion:release.version,databaseMigrations:databaseResult});

      if(panel){
        await event(install,"update.base.started","info","Updater is applying the authorized Base file patch to the existing Base project",{releaseId:release.id,releaseVersion:release.version});
        basePatchAttempted=true;
        basePatchResult=await applyBaseUpdatePatch(install,release,bundle,panel,requestedChannel);
        await event(install,"update.base.completed","ok","Base file patch deployment completed",{releaseId:release.id,releaseVersion:release.version,deploymentId:basePatchResult.deploymentId,patchFileCount:basePatchResult.patchFileCount,deleteCount:basePatchResult.deleteCount});
      }

      if(engine){
        await event(install,"update.engine.preflight","ok","Updater connection is verified from the Inner-Deployer-created Shared Engine Host",{releaseId:release.id,releaseVersion:release.version,components:engineComponents,executor:"orbitfs-updater-v2"});
        await event(install,"update.engine.started","info","Updater is applying the Shared Engine Host/addon payload directly",{releaseId:release.id,releaseVersion:release.version,components:engineComponents});
        engineAttempted=true;
        engineResult=await applyEngineUpdatePayload(install,release,bundle,engine,requestedChannel,engineComponents);
        await event(install,"update.engine.completed","ok","Shared Engine Host/addon update completed",{releaseId:release.id,releaseVersion:release.version,engineDeploymentId:engineResult?.deploymentId||null});
      }

      await event(install,"update.recording","info","Recording successful deployed-system Update and reporting to License Manager",{releaseId:release.id,releaseVersion:release.version});
      const appliedAt=new Date().toISOString();
      const declaredComponentVersions=bundle.componentVersions&&typeof bundle.componentVersions==="object"&&!Array.isArray(bundle.componentVersions)?bundle.componentVersions:{};
      const componentVersions=Object.fromEntries(components.map(component=>[component,String(declaredComponentVersions?.[component]||release.version||"")]));
      const componentState=Object.fromEntries(components.map((component:string)=>[component,{version:String(componentVersions?.[component]||""),status:"installed"}]));
      const updateState={
        version:String(release.version),releaseId:String(release.id),sha256:parsed.artifactSha256,
        sourceCommit:String(bundle.sourceCommit||expectedSource(release)||""),channel:requestedChannel,
        components,releaseComponents:bundleComponents,skippedComponents,componentVersions,
        componentPlan:deploymentAuthorization?.componentPlan||null,appliedAt,
        basePatchDeploymentId:basePatchResult?.deploymentId||null,basePreviousDeploymentId:basePatchResult?.previousDeploymentId||null,
        engineDeploymentId:engineResult?.deploymentId||null,enginePreviousDeploymentId:engineResult?.previousDeploymentId||null,databaseMigrations:databaseResult,
        executor:"orbitfs-updater-v2"
      };
      const patch:any={
        release_channel:requestedChannel,
        ...(basePatchResult?{vercel_deployment_id:basePatchResult.deploymentId,deployment_url:basePatchResult.deploymentUrl}:{}),
        last_deployment_at:appliedAt,
        last_error:null,
        state:"ready",
        metadata:{
          ...(install.metadata&&typeof install.metadata==="object"?install.metadata:{}),
          appliedUpdate:updateState,
          ...(engineResult?{updaterConnection:{
            ...((install.metadata?.updaterConnection&&typeof install.metadata.updaterConnection==="object")?install.metadata.updaterConnection:{}),
            linked:true,
            engineDeploymentId:engineResult.deploymentId||null,
            engineHostUrl:engineResult.hostUrl||install.metadata?.updaterConnection?.engineHostUrl||null,
            updatedAt:appliedAt
          }}:{})
        }
      };
      const {data,error}=await licenseDb().from("orbitfs_installations").update(patch).eq("id",install.id).select().single();
      if(error)throw error;
      const historyDeploymentId=basePatchResult?.deploymentId||engineResult?.deploymentId||null;
      const historyDeploymentUrl=basePatchResult?.deploymentUrl||engineResult?.hostUrl||null;
      const history=await licenseDb().from("orbitfs_installation_releases").insert({installation_id:install.id,auth_user_id:install.auth_user_id,release_version:String(release.version),release_id:String(release.id),release_sha256:parsed.artifactSha256,source_commit:bundle.sourceCommit||expectedSource(release)||null,vercel_deployment_id:historyDeploymentId,deployment_url:historyDeploymentUrl,action:"update",release_type:"update",components,status:"ready",ready_at:appliedAt});
      if(history.error)throw history.error;
      const customerResult=await licenseDb().from("customers").select("id,customer_number,name,email").eq("auth_user_id",install.auth_user_id).maybeSingle();
      const customer=customerResult.data||null;
      await masterExecuteDeployment({action:"update",phase:"completed",releaseId:release.id,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel:requestedChannel,baseVersion:String(install.release_version||""),productVersion:String(install.release_version||""),previousVersion:install.release_version||null,deploymentId:historyDeploymentId,deploymentUrl:historyDeploymentUrl,projectId:install.vercel_project_id,projectName:install.vercel_project_name,componentState,components:componentState,customerIdentity:{customerId:customer?.id||null,customerNumber:customer?.customer_number||null,customerName:customer?.name||null,customerEmail:customer?.email||null,installationId:install.installation_id}});
      await event(data,"update.completed","ok",`OrbitFS Update ${release.version} applied to the existing deployment`,updateState);
      return data;
    }catch(updateError){
      const recovery:any={databaseMigrations:"forward-only",base:null,engine:null};
      if(basePatchAttempted&&basePatchResult?.previousDeploymentId&&install.vercel_project_id){
        try{
          await vercelApi(String(install.auth_user_id),`/v9/projects/${encodeURIComponent(String(install.vercel_project_id))}/rollback/${encodeURIComponent(String(basePatchResult.previousDeploymentId))}`,{method:"POST",body:JSON.stringify({})});
          recovery.base={ok:true,restoredDeploymentId:basePatchResult.previousDeploymentId};
        }catch(recoveryError){recovery.base={ok:false,error:errorMessage(recoveryError,"Base patch recovery failed")}}
      }
      if(engineAttempted){
        try{
          const previousEngineDeploymentId=String(engineResult?.previousDeploymentId||install.metadata?.updaterConnection?.engineDeploymentId||"").trim()||null;
          const rolledBack=await rollbackEngineUpdatePayload(install,previousEngineDeploymentId);
          recovery.engine={ok:true,restoredDeploymentId:rolledBack.deploymentId||null};
        }catch(recoveryError){recovery.engine={ok:false,error:errorMessage(recoveryError,"Engine recovery failed")}}
      }
      const recoveryFailed=recovery.base?.ok===false||recovery.engine?.ok===false;
      await event(install,"update.recovery",recoveryFailed?"warning":"ok","Update failed; recovery was attempted",{releaseId:release.id,components,recovery,error:errorMessage(updateError,"Update failed")});
      throw Object.assign(updateError instanceof Error?updateError:new Error(errorMessage(updateError,"Update failed")),{updateRecovery:recovery});
    }
  }
  if(action==="deploy"&&!install.vercel_project_id)install=await ensureVercelProject(install);
  if(!install.vercel_project_id)fail("Customer Vercel project is unavailable for this deployment action",409,"BASE_PROJECT_NOT_FOUND");
  await ensureStandardPanelProtection(install);
  const parsed=await readBasePackage(release);
  const packageDatabaseSchema=String((parsed.pkg as any).databaseSchemaVersion||(parsed.pkg as any).releaseInfo?.databaseSchemaVersion||release.manifest?.databaseSchemaVersion||"").trim();
  let redeployMigrations:any=null;
  if(action==="redeploy"&&install.database_initialized_at){
    let installedRelease:any=null;
    const installedReleaseId=String(install.release_id||"").trim();
    if(installedReleaseId){
      try{installedRelease=await exactRelease(installedReleaseId)}catch{installedRelease=null}
    }
    await progress?.("migrating",{fromReleaseId:installedReleaseId||null,toReleaseId:String(release.id),fromVersion:String(install.release_version||""),toVersion:String(release.version||"")});
    redeployMigrations=await applyBaseDatabaseMigrations(install,installedRelease,release,parsed.pkg,parsed.files);
    await event(install,"base.redeploy.database.completed","ok","Existing Base database migration check completed before redeploy",{fromReleaseId:installedReleaseId||null,toReleaseId:String(release.id),databaseMigrations:redeployMigrations});
  }
  const deploymentInstall=action==="redeploy"&&packageDatabaseSchema?{...install,schema_version:packageDatabaseSchema}:install;
  await configureVercel(deploymentInstall,String(release.version),undefined,requestedChannel,String(release.id),String(release.sha256||release.checksum||""),String(release.source_sha||release.source_commit||release.manifest?.sourceCommit||""));
  const installedDatabaseSchema=String(deploymentInstall.schema_version||"").trim();
  const requireExactDatabaseSchema=release?.manifest?.compatibility?.databaseSchema?.required===true||release?.manifest?.requireDatabaseSchemaMatch===true;
  if(requireExactDatabaseSchema&&packageDatabaseSchema&&installedDatabaseSchema&&packageDatabaseSchema!==installedDatabaseSchema)fail(`Base release ${release.version} explicitly requires database schema ${packageDatabaseSchema}, but this installation is initialized with schema ${installedDatabaseSchema}.`,409);
  const projectSettings={framework:"sveltekit",installCommand:"npm ci",buildCommand:"npm run build",...(parsed.pkg.projectSettings||{})};
  const deploymentFiles=baseVercelDeploymentFiles(parsed.files);
  await progress?.("deploying",{action,releaseId:String(release.id),projectId:install.vercel_project_id,fileCount:deploymentFiles.length,artifactFileCount:parsed.files.length});
  await event(install,"deployment.uploading","info",`Uploading ${deploymentFiles.length} verified Base application files to Vercel`,{action,releaseId:release.id,fileCount:deploymentFiles.length,artifactFileCount:parsed.files.length,databaseAssetsExcluded:parsed.files.length-deploymentFiles.length});
  const uploadedFiles=await uploadVercelDeploymentFiles(String(install.auth_user_id),deploymentFiles);
  const body:any={name:install.vercel_project_name||`orbitfs-${install.installation_id.slice(-8)}`.toLowerCase(),project:install.vercel_project_id,target:"production",files:uploadedFiles,projectSettings,meta:{orbitfsReleaseId:String(release.id),orbitfsVersion:String(release.version),orbitfsAction:action,orbitfsChannel:requestedChannel,orbitfsSourceCommit:String(parsed.pkg.sourceCommit||release.sourceCommit||""),orbitfsInstallationRoute:"billing_store"}};
  await event(install,"deployment.started","info",`Deploying ${release.version}`,{action,releaseId:release.id,fileCount:parsed.files.length,checksum:parsed.artifactSha256});
  const created=await vercelApi(install.auth_user_id,"/v13/deployments",{method:"POST",body:JSON.stringify(body)});if(!created?.id&&!created?.uid)fail("Vercel did not return a deployment id",502);
  const deploymentId=String(created.id||created.uid);
  await licenseDb().from("orbitfs_installations").update({vercel_deployment_id:deploymentId,state:"deploying",last_error:null,updated_at:new Date().toISOString()}).eq("id",install.id);
  await event(install,"deployment.created","info",`Vercel deployment ${deploymentId} created`,{action,releaseId:release.id,deploymentId,projectId:install.vercel_project_id});
  await progress?.("verifying",{action,releaseId:String(release.id),projectId:install.vercel_project_id,deploymentId});
  const ready=await waitForReady(install.auth_user_id,deploymentId),state=String(ready?.readyState||ready?.state||"");if(state!=="READY")fail("Vercel deployment did not become ready within the deployment window",504);
  const previousVersion=install.release_version||null,deploymentUrl=ready?.url?`https://${String(ready.url).replace(/^https?:\/\//,"")}`:install.deployment_url;
  const selectedBaseAlias=await ensureSelectedBaseVercelAliasOnDeployment(install,deploymentId);
  const productionUrl=selectedBaseAlias?`https://${selectedBaseAlias}`:await resolveProductionUrl(install,ready);
  // Register the deployed Base as Billing-managed before the customer opens its
  // first-time installer. Licence activation itself happens later inside Base.
  await registerInstalledBaseRoute(productionUrl||deploymentUrl,install,deploymentId);
  // Do not publish an individual protected deployment URL as the customer-facing address.
  await configureVercel(deploymentInstall,String(release.version),productionUrl||undefined,requestedChannel,String(release.id),parsed.artifactSha256,String(parsed.pkg.sourceCommit||release.sourceCommit||""));
  // Billing Store owns deployment coordination only. Base owns first-time bootstrap:
  // storage preparation, licence activation, Owner creation, workspace creation and
  // runtime installation registration all happen inside the installed Base setup flow.
  const completedAt=new Date().toISOString();
  const patch={release_channel:requestedChannel,vercel_deployment_id:deploymentId,deployment_url:deploymentUrl,production_url:productionUrl,health_status:"unknown",release_version:String(release.version),release_id:String(release.id),release_sha256:parsed.artifactSha256,release_source_commit:parsed.pkg.sourceCommit||release.sourceCommit||null,previous_release_version:previousVersion,last_deployment_at:completedAt,last_error:null,state:"ready",...(action==="redeploy"&&packageDatabaseSchema?{schema_version:packageDatabaseSchema}: {})};
  const {data,error}=await licenseDb().from("orbitfs_installations").update(patch).eq("id",install.id).select().single();if(error)throw error;
  const history=await licenseDb().from("orbitfs_installation_releases").insert({installation_id:install.id,auth_user_id:install.auth_user_id,release_version:String(release.version),release_id:String(release.id),release_sha256:parsed.artifactSha256,source_commit:parsed.pkg.sourceCommit||release.sourceCommit||null,vercel_deployment_id:deploymentId,deployment_url:deploymentUrl,action,status:"ready",ready_at:completedAt});
  if(history.error)throw history.error;
  const customerResult=await licenseDb().from("customers").select("id,customer_number,name,email").eq("auth_user_id",install.auth_user_id).maybeSingle();
  const customer=customerResult.data||null;
  await masterExecuteDeployment({action,phase:"completed",releaseId:release.id,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel:requestedChannel,productVersion:String(release.version),previousVersion:previousVersion,deploymentId,deploymentUrl,projectId:install.vercel_project_id,projectName:install.vercel_project_name,customerIdentity:{customerId:customer?.id||null,customerNumber:customer?.customer_number||null,customerName:customer?.name||null,customerEmail:customer?.email||null,installationId:install.installation_id}});
  await event(data,action==="rollback"?"deployment.rollback.completed":"deployment.completed","ok",action==="rollback"?`Base rollback restored ${release.version} as fresh deployment ${deploymentId}`:`Vercel deployment ${deploymentId} is ready`,{action,releaseId:release.id,version:release.version,deploymentId,reason:rollbackReason||undefined,databaseMigrations:redeployMigrations});return data;
  }catch(error:any){
    if(error?.orbitfsFailureReported===true)throw error;
    await reportDeploymentFailure(install,{action,releaseId:String(release.id),licenseId:authorityLicenseId,channel:requestedChannel,productVersion:String(release.version)},error);
    throw error;
  }
}
