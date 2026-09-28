import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {licenseDb} from "@/lib/license-api";
import {masterDownloadReleaseArtifact,masterExecuteDeployment,masterReleases,masterRequest} from "@/lib/master-api";
import {billingOrbitfsConfig,configureVercel,configureVercelUpdateIdentity,customerInstallationDbSecret,customerVercelCredentials,ensureVercelProject,event,requireSystem,supabaseApi,vercelApi,type DeployAction} from "@/lib/orbitfs-deployment";
import {customerReleaseChannels} from "@/lib/orbitfs-release-channels";
import {reportDevPanelReleaseEvent} from "@/lib/dev-panel-events";

const MAX_FILES=5000,MAX_FILE_BYTES=25*1024*1024,MAX_TOTAL_BYTES=70*1024*1024;
const SAFE_PATH=/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*(?:^|\/)(?:\.git|\.vercel|node_modules)(?:\/|$))[A-Za-z0-9._@+\-\/\[\]()=]+$/;
type ReleaseFile={file:string;data:string;encoding?:string;sha256?:string;size?:number;component?:string};
type Package={format?:string;schemaVersion?:number;version:string;releaseId?:string;sourceCommit?:string;components?:string[];projectSettings?:Record<string,unknown>;files:ReleaseFile[];[key:string]:any};
type UpdateBundle={format:"orbitfs-update-bundle-v3";schemaVersion:number;version:string;sourceCommit?:string;components:string[];minimumBaseVersion?:string;minimumEngineDeployerProtocol?:number;checkpointRequired?:boolean;payloads:{panel:Package|null;engine:Package|null};[key:string]:any};
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
function validateDeployableBaseFiles(files:Array<{file:string;data:string;sha256:string;size:number}>){
  const byPath=new Map(files.map(file=>[file.file,file]));
  for(const required of ["package.json","package-lock.json","svelte.config.js","vite.config.ts"]){
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
  const rows=await masterReleases("orbitfs_base",channel,releaseType(action),"deployer");
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
async function readBasePackage(release:any):Promise<{pkg:Package;files:Array<{file:string;data:string;sha256:string;size:number}>;artifactSha256:string}>{
  const parsed=await readArtifact(release);
  if((parsed.root as any).format==="orbitfs-update-bundle-v3")fail("Base deployment cannot use an Update Bundle artifact",422);
  const pkg=parsed.root as Package;
  const releaseComponents=[...(Array.isArray(release?.manifest?.components)?release.manifest.components:[])].map((x:any)=>String(x||"").trim().toLowerCase()).filter(Boolean).sort();
  const packageComponents=[...(Array.isArray(pkg.components)?pkg.components:[])].map(x=>String(x||"").trim().toLowerCase()).filter(Boolean).sort();
  if(releaseComponents.length&&packageComponents.length&&releaseComponents.join(",")!==packageComponents.join(","))fail("Release package components do not match License Manager",422);

  const manifest=release?.manifest&&typeof release.manifest==="object"?release.manifest:{};
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
  const files=validateFiles(pkg.files,"Installed Base package");
  validateDeployableBaseFiles(files);
  return {pkg,files,artifactSha256:parsed.artifactSha256};
}
type DatabaseMigration={id:string;file:string;component?:string;encoding:"base64";data:string;size:number;sha256:string};
function sqlLiteral(value:unknown){return "'"+String(value??"").replaceAll("'","''")+"'";}
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
    return {id,file,component:String(migration.component||"shared").trim().toLowerCase()||"shared",encoding:"base64" as const,data:migration.data,size:sql.byteLength,sha256:sha};
  });
  const engine=(bundle as any)?.payloads?.engine;
  if(engine&&JSON.stringify(engine.database||null)!==JSON.stringify(database))fail("Update Bundle database contract does not match its Engine payload",422);
  if((bundle as any)?.releaseAnalysis?.flags?.schemaChanged===true&&!normalized.length)fail("Update contains database/schema changes but no customer database migration",422);
  return normalized;
}
async function applyCustomerDatabaseMigrations(install:any,release:any,bundle:UpdateBundle){
  const migrations=validateDatabaseContract(bundle);
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
  if(!migrations.length)return {required:0,applied:0,skipped:0,ids:[] as string[]};
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
  return {required:migrations.length,applied,skipped,ids};
}

type BaseMigration={id:string;file:string;size:number;sha256:string;data:string};
function validateBaseMigrationChain(pkg:Package,files:Array<{file:string;data:string;sha256:string;size:number}>):BaseMigration[]{
  const declaredRaw=Array.isArray((pkg as any).databaseMigrations)?(pkg as any).databaseMigrations:Array.isArray((pkg as any).releaseInfo?.databaseMigrations)?(pkg as any).releaseInfo.databaseMigrations:[];
  const count=Number((pkg as any).databaseMigrationCount??(pkg as any).releaseInfo?.databaseMigrationCount??0);
  const latest=String((pkg as any).databaseLatestMigration||(pkg as any).releaseInfo?.databaseLatestMigration||"").trim();
  if(!Number.isInteger(count)||count<1||!/^[0-9]{14}$/.test(latest))fail("Base release database migration chain is incomplete",422);

  const packagedMigrations=files
    .map(file=>{
      const match=file.file.match(/^supabase\/migrations\/([0-9]{14})_[A-Za-z0-9._-]+\.sql$/);
      return match?{id:match[1],file:file.file,size:file.size,sha256:file.sha256,data:file.data}:null;
    })
    .filter((entry):entry is BaseMigration=>Boolean(entry))
    .sort((a,b)=>a.id.localeCompare(b.id));

  if(packagedMigrations.length!==count||packagedMigrations.at(-1)?.id!==latest)fail("Base release database migration chain is incomplete",422);
  const packagedIds=new Set(packagedMigrations.map(entry=>entry.id));
  if(packagedIds.size!==packagedMigrations.length)fail("Base release contains duplicate migration ids",422);
  for(let index=1;index<packagedMigrations.length;index++){
    if(packagedMigrations[index].id<=packagedMigrations[index-1].id)fail("Base migration ids must be strictly increasing",422);
  }

  if(!declaredRaw.length)return packagedMigrations;
  if(declaredRaw.length!==count)fail("Base release database migration chain is incomplete",422);

  const byPath=new Map(files.map(file=>[file.file,file]));
  const seen=new Set<string>();
  const normalized:BaseMigration[]=declaredRaw.map((migration:any,index:number)=>{
    const id=String(migration?.id||"").trim(),file=String(migration?.file||"").replaceAll("\\","/");
    if(!/^[0-9]{14}$/.test(id)||seen.has(id))fail("Base release contains an invalid or duplicate migration id",422);
    seen.add(id);
    const match=file.match(/^supabase\/migrations\/([0-9]{14})_[A-Za-z0-9._-]+\.sql$/);
    if(!match||match[1]!==id)fail(`Base migration path does not match its id: ${file||id}`,422);
    const packaged=byPath.get(file);
    if(!packaged)fail(`Base migration is missing from the deployment package: ${file}`,422);
    const packagedFile=packaged as {file:string;data:string;sha256:string;size:number};
    const sha=String(migration?.sha256||"").trim().toLowerCase();
    if(!/^[a-f0-9]{64}$/.test(sha)||sha!==packagedFile.sha256||Number(migration?.size)!==packagedFile.size)fail(`Base migration checksum mismatch: ${file}`,422);
    if(index>0&&id<=String(declaredRaw[index-1]?.id||""))fail("Base migration ids must be strictly increasing",422);
    return {id,file,size:packagedFile.size,sha256:sha,data:packagedFile.data};
  });
  if(normalized.at(-1)?.id!==latest)fail("Base release latest migration does not match its migration chain",422);
  const declaredPaths=new Set(normalized.map(entry=>entry.file));
  if(declaredPaths.size!==packagedMigrations.length||packagedMigrations.some(entry=>!declaredPaths.has(entry.file)))fail("Base release database migration chain does not match the packaged migrations",422);
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
  if(!Number.isInteger(count)||count<1||!/^[0-9]{14}$/.test(latest)){
    const parsed=await readArtifact(currentRelease);
    if((parsed.root as any).format==="orbitfs-update-bundle-v3")fail("Installed Base release points to an Update Bundle",409);
    const pkg=parsed.root as any;
    count=Number(pkg.databaseMigrationCount??pkg.releaseInfo?.databaseMigrationCount??0);
    latest=String(pkg.databaseLatestMigration||pkg.releaseInfo?.databaseLatestMigration||"").trim();
    declared=Array.isArray(pkg.databaseMigrations)?pkg.databaseMigrations:[];
  }
  if(!Number.isInteger(count)||count<1||count>target.length||!/^[0-9]{14}$/.test(latest))fail("Installed Base release does not contain enough migration baseline metadata for an automatic Base update",409);
  if(target[count-1]?.id!==latest)fail("Target Base release does not extend the installed Base migration history",409);
  if(declared.length){
    if(declared.length<count)fail("Installed Base migration metadata is incomplete",409);
    for(let index=0;index<count;index++){
      const before=declared[index],after=target[index];
      if(String(before?.id||"")!==after.id||String(before?.file||"").replaceAll("\\","/")!==after.file||String(before?.sha256||"").toLowerCase()!==after.sha256){
        fail(`Base migration history diverged at ${after.id}. Published migrations are immutable.`,409);
      }
    }
  }
  return {count,latest};
}
async function applyBaseDatabaseMigrations(install:any,currentRelease:any,targetRelease:any,pkg:Package,files:Array<{file:string;data:string;sha256:string;size:number}>){
  if(!install.supabase_project_ref)fail("Customer Supabase project is not configured for Base migrations",409);
  const currentSchemaHash=baseDatabaseSnapshotHash(currentRelease);
  const targetSchemaHash=baseDatabaseSnapshotHash(targetRelease);
  if(/^[a-f0-9]{64}$/.test(currentSchemaHash)&&currentSchemaHash===targetSchemaHash){
    await event(install,"base.database.migration.skipped","ok","Base database schema snapshot is unchanged; no forward migration is required.",{fromReleaseId:String(currentRelease.id),toReleaseId:String(targetRelease.id),databaseSchemaSha256:targetSchemaHash});
    return {baseline:null,target:null,required:0,seeded:0,applied:0,skipped:0,ids:[] as string[],mode:"schema_unchanged"};
  }
  const chain=validateBaseMigrationChain(pkg,files);
  const baseline=await currentBaseMigrationBaseline(currentRelease,chain);
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
values (${sqlLiteral(migration.id)},${sqlLiteral(migration.sha256)},'base',${sqlLiteral(migration.file)},${sqlLiteral(currentRelease.id)},${sqlLiteral(currentRelease.version)},coalesce(${sqlLiteral(install.database_initialized_at||new Date().toISOString())}::timestamptz,now()))
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
values (${sqlLiteral(migration.id)},${sqlLiteral(migration.sha256)},'base',${sqlLiteral(migration.file)},${sqlLiteral(targetRelease.id)},${sqlLiteral(targetRelease.version)},now());
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
function versionParts(value:unknown){const m=String(value||"").trim().match(/^(\d+)\.(\d+)\.(\d+)/);return m?[Number(m[1]),Number(m[2]),Number(m[3])]:null}
function compareVersions(a:unknown,b:unknown){const av=versionParts(a),bv=versionParts(b);if(!av||!bv)return null;return av[0]-bv[0]||av[1]-bv[1]||av[2]-bv[2]}
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
    await new Promise(r=>setTimeout(r,3000));
  }
  return last;
}
async function deployPanelUpdatePayload(install:any,release:any,bundle:UpdateBundle,panel:Package,artifactSha256:string,channel:string){
  const installedBase=String(install.release_version||"").trim();
  const baseline=String((panel as any).baseVersion||bundle.minimumBaseVersion||"").trim();
  if(!installedBase)fail("Deploy OrbitFS Base before applying a Panel update",409);
  if(!baseline||installedBase!==baseline)fail(`Panel update ${release.version} was built on Base ${baseline||"unknown"}, but this installation is Base ${installedBase}. Use a matching update or publish a newer Base deployment.`,409);
  const files=validateFiles(panel.files,"Panel update payload");
  const uploadedFiles=await uploadVercelDeploymentFiles(String(install.auth_user_id),files);
  await configureVercelUpdateIdentity(install,{version:String(release.version),releaseId:String(release.id),sha256:artifactSha256,sourceCommit:bundle.sourceCommit||expectedSource(release),channel,components:bundle.components});
  const body:any={
    name:install.vercel_project_name||`orbitfs-${String(install.installation_id||"").slice(-8)}`.toLowerCase(),
    project:install.vercel_project_id,
    target:"production",
    files:uploadedFiles,
    projectSettings:{framework:"sveltekit",installCommand:"npm ci",buildCommand:"npm run build",...(panel.projectSettings||{})},
    meta:{orbitfsReleaseId:String(release.id),orbitfsVersion:String(release.version),orbitfsAction:"update",orbitfsChannel:channel,orbitfsSourceCommit:String(bundle.sourceCommit||expectedSource(release)),orbitfsInstallationRoute:"billing_store",orbitfsUpdateTargets:bundle.components.join(",")}
  };
  const created=await vercelApi(install.auth_user_id,"/v13/deployments",{method:"POST",body:JSON.stringify(body)});
  if(!created?.id&&!created?.uid)fail("Vercel did not return a Panel update deployment id",502);
  const deploymentId=String(created.id||created.uid);
  const ready=await waitForReady(install.auth_user_id,deploymentId);
  const state=String(ready?.readyState||ready?.state||"");
  if(state!=="READY")fail("Panel update deployment did not become ready within the deployment window",504);
  const deploymentUrl=ready?.url?`https://${String(ready.url).replace(/^https?:\/\//,"")}`:install.deployment_url;
  return {deploymentId,deploymentUrl,fileCount:files.length};
}
async function engineUpdateRequest(baseUrl:string,install:any,release:any,channel:string,mode:"plan"|"apply"|"refresh"|"rollback"){
  const [secret,vercel]=await Promise.all([
    customerInstallationDbSecret(String(install.id)),
    customerVercelCredentials(String(install.auth_user_id))
  ]);
  const response=await fetch(`${baseUrl.replace(/\/$/,"")}/api/store/update-engine`,{
    method:"POST",
    headers:{"content-type":"application/json","x-orbitfs-db-secret":secret,"x-orbitfs-installation-id":String(install.installation_id||"")},
    body:JSON.stringify({mode,releaseId:String(release.id),releaseChannel:channel,vercelToken:String(vercel?.token||""),teamId:String(vercel?.teamId||install.vercel_team_id||"")}),
    cache:"no-store",
    signal:AbortSignal.timeout(mode==='plan'||mode==='refresh'?30000:180000)
  });
  const body:any=await response.json().catch(()=>({}));
  if(!response.ok&&response.status!==202)fail(String(body?.error||`Installed Base Engine updater returned ${response.status}`),response.status<500?response.status:502);
  return {status:response.status,body};
}
async function applyEngineUpdatePayload(install:any,release:any,channel:string,baseUrl:string){
  let result=await engineUpdateRequest(baseUrl,install,release,channel,"apply");
  const deadline=Date.now()+120000;
  while((result.status===202||result.body?.waiting===true)&&Date.now()<deadline){
    await new Promise(resolve=>setTimeout(resolve,3000));
    result=await engineUpdateRequest(baseUrl,install,release,channel,"refresh");
  }
  if(result.status===202||result.body?.waiting===true)fail("Engine Host update did not become ready within the deployment window",504);
  return {deploymentId:String(result.body?.host?.deploymentId||""),hostUrl:String(result.body?.host?.hostUrl||""),state:String(result.body?.host?.state||"ready")};
}
async function rollbackEngineUpdatePayload(install:any,release:any,channel:string,baseUrl:string){
  let result=await engineUpdateRequest(baseUrl,install,release,channel,"rollback");
  const checkpointId=String(result.body?.checkpointId||"")||null;
  const restoredVersion=String(result.body?.restoredVersion||"")||null;
  const componentVersions=result.body?.componentVersions&&typeof result.body.componentVersions==="object"?result.body.componentVersions:{};
  const deadline=Date.now()+120000;
  while((result.status===202||result.body?.waiting===true)&&Date.now()<deadline){
    await new Promise(resolve=>setTimeout(resolve,3000));
    result=await engineUpdateRequest(baseUrl,install,release,channel,"refresh");
  }
  if(result.status===202||result.body?.waiting===true)fail("Engine Host rollback did not become ready within the deployment window",504);
  return {...(result.body||{}),checkpointId,restoredVersion:restoredVersion||String(result.body?.host?.releaseVersion||""),componentVersions};
}
async function previousDeployment(install:any):Promise<{vercel_deployment_id:string;deployment_url:string|null;release_version:string;release_id:string;created_at:string}>{const {data,error}=await licenseDb().from("orbitfs_installation_releases").select("vercel_deployment_id,deployment_url,release_version,release_id,created_at,action").eq("installation_id",install.id).eq("status","ready").neq("action","update").not("vercel_deployment_id","is",null).order("created_at",{ascending:false}).limit(5);if(error)throw error;const previous=(data||[]).find((r:any)=>r.vercel_deployment_id!==install.vercel_deployment_id);if(!previous)throw Object.assign(new Error("No previous successful Base deployment is available for rollback"),{status:409});if(!previous.vercel_deployment_id||!previous.release_id||!previous.release_version)throw Object.assign(new Error("Previous Base deployment record is incomplete and cannot be rolled back"),{status:409});return {vercel_deployment_id:String(previous.vercel_deployment_id),deployment_url:previous.deployment_url?String(previous.deployment_url):null,release_version:String(previous.release_version),release_id:String(previous.release_id),created_at:String(previous.created_at||"")}}

async function runBaseUpdateDeployment(install:any,release:any,requestedChannel:string,authorityLicenseId:string,progress?:OperationProgress){
  const currentReleaseId=String(install.release_id||"").trim(),currentVersion=String(install.release_version||"").trim();
  const projectId=String(install.vercel_project_id||"").trim(),previousDeploymentId=String(install.vercel_deployment_id||"").trim();
  if(!currentReleaseId||!currentVersion)fail("Install OrbitFS Base before running a Base update",409,"BASE_INSTALLATION_REQUIRED");
  if(!projectId||!previousDeploymentId)fail("The existing Base Vercel project/deployment identity is missing. Base update will not create a replacement project.",409,"BASE_PROJECT_NOT_FOUND");
  const comparison=compareVersions(String(release.version||""),currentVersion);
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

    const uploadedFiles=await uploadVercelDeploymentFiles(String(install.auth_user_id),target.files);
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
    const created=await vercelApi(String(install.auth_user_id),"/v13/deployments",{method:"POST",body:JSON.stringify(body)});
    if(!created?.id&&!created?.uid)fail("Vercel did not return a Base update deployment id",502);
    createdDeploymentId=String(created.id||created.uid);
    await licenseDb().from("orbitfs_installations").update({vercel_deployment_id:createdDeploymentId,state:"updating",last_error:null,updated_at:new Date().toISOString()}).eq("id",install.id);
    await progress?.("verifying",{projectId,deploymentId:createdDeploymentId});

    const ready=await waitForReady(String(install.auth_user_id),createdDeploymentId);
    if(String(ready?.readyState||ready?.state||"").toUpperCase()!=="READY")fail("Base update deployment did not become ready within the deployment window",504,"VERCEL_DEPLOY_FAILED",true);
    const deploymentUrl=ready?.url?`https://${String(ready.url).replace(/^https?:\/\//,"")}`:String(install.deployment_url||"");
    if(!deploymentUrl)fail("Vercel Base update did not return a deployment URL",502,"VERCEL_DEPLOY_FAILED",true);

    const settings=await billingOrbitfsConfig();
    try{
      const health=await fetch(new URL(settings.health_path||"/api/health",deploymentUrl),{redirect:"follow",cache:"no-store",signal:AbortSignal.timeout(15000)});
      if(health.status>=500)fail(`Updated Base health check failed with HTTP ${health.status}`,502);
    }catch(error:any){
      if(Number(error?.status))throw error;
      fail(`Updated Base health check could not be reached: ${error?.message||String(error)}`,502);
    }

    await configureVercel(deploymentInstall,String(release.version),deploymentUrl,requestedChannel,String(release.id),target.artifactSha256,String(target.pkg.sourceCommit||expectedSource(release)));
    const completedAt=new Date().toISOString();
    const metadata={...(install.metadata&&typeof install.metadata==="object"?install.metadata:{}),lastBaseUpdate:{fromVersion:currentVersion,toVersion:String(release.version),fromReleaseId:currentReleaseId,toReleaseId:String(release.id),databaseMigrations:migrations,completedAt}};
    const patch:any={
      metadata,
      schema_version:targetSchemaVersion,
      release_channel:requestedChannel,
      vercel_deployment_id:createdDeploymentId,
      deployment_url:deploymentUrl,
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
    const message=String(error?.message||"Base update failed");
    const recovery:any={databaseMigrations:migrations?"forward migrations retained":"not started",deploymentRollback:false,environmentRestored:false};
    if(createdDeploymentId&&previousDeploymentId){
      try{
        await vercelApi(String(install.auth_user_id),`/v9/projects/${encodeURIComponent(projectId)}/rollback/${encodeURIComponent(previousDeploymentId)}`,{method:"POST",body:JSON.stringify({})});
        recovery.deploymentRollback=true;
      }catch(rollbackError:any){recovery.deploymentRollbackError=String(rollbackError?.message||rollbackError)}
    }
    try{
      await configureVercel(install,currentVersion,String(install.production_url||install.deployment_url||""),requestedChannel,currentReleaseId,String(install.release_sha256||""),String(install.release_source_commit||""));
      recovery.environmentRestored=true;
    }catch(envError:any){recovery.environmentRestoreError=String(envError?.message||envError)}
    await Promise.allSettled([
      licenseDb().from("orbitfs_installations").update({vercel_deployment_id:previousDeploymentId,state:"ready",last_error:message,updated_at:new Date().toISOString()}).eq("id",install.id),
      masterExecuteDeployment({action:"base_update",phase:"failed",releaseId:String(release.id),installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel:requestedChannel,productVersion:String(release.version),previousVersion:currentVersion,projectId,projectName:install.vercel_project_name,error:message}),
      event(install,"base.update.failed","error",message,{fromVersion:currentVersion,toVersion:String(release.version),projectId,recovery})
    ]);
    throw Object.assign(error instanceof Error?error:new Error(message),{orbitfsFailureReported:true,recovery});
  }
}

async function reportDeploymentFailure(install:any,input:{action:DeployAction;releaseId:string;licenseId:string;channel:string;productVersion?:string},error:unknown){
  const message=error instanceof Error?error.message:String(error||"Deployment failed");
  await Promise.allSettled([
    masterExecuteDeployment({action:input.action,phase:"failed",releaseId:input.releaseId,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:input.licenseId,channel:input.channel,productVersion:input.productVersion,previousVersion:install.release_version||null,projectId:install.vercel_project_id||null,projectName:install.vercel_project_name||null,error:message}),
    licenseDb().from("orbitfs_installations").update({state:"failed",last_error:message}).eq("id",install.id),
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
  const registration=install?.metadata?.licenseRegistration&&typeof install.metadata.licenseRegistration==="object"?install.metadata.licenseRegistration:null;
  const authorityLicenseId=String(registration?.masterLicenseId||"").trim();
  if(registration?.valid!==true||!authorityLicenseId||String(registration?.installationId||"")!==String(install.installation_id||""))fail("Register an OrbitFS licence key for this installation before deployment",409);
  const wantsPanel=components.includes("base"),wantsEngine=components.some((component:string)=>component!=="base");
  const baseUrl=String(install.production_url||install.deployment_url||"").trim();
  const pseudoRelease={id:releaseId};
  await masterExecuteDeployment({action:"rollback",rollbackScope:"update",releaseId,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel,productVersion:String(install.release_version||""),previousVersion:releaseVersion,components});
  await event(install,"update.rollback.started","info",`Rolling back OrbitFS Update ${releaseVersion}`,{releaseId,components,reason:rollbackReason});
  let engineResult:any=null,panelResult:any=null;
  try{
    if(wantsEngine){
      if(!baseUrl)fail("Installed OrbitFS Base URL is unavailable for Engine rollback",409);
      engineResult=await rollbackEngineUpdatePayload(install,pseudoRelease,channel,baseUrl);
    }
    if(wantsPanel){
      if(!install.vercel_project_id)fail("Customer Vercel project is unavailable for Panel rollback",409);
      const previous=await previousDeployment(install);
      await vercelApi(install.auth_user_id,`/v9/projects/${encodeURIComponent(String(install.vercel_project_id))}/rollback/${encodeURIComponent(previous.vercel_deployment_id)}`,{method:"POST",body:JSON.stringify({})});
      panelResult=previous;
    }
    const completedAt=new Date().toISOString();
    const rolledBackUpdate={...applied,rolledBackAt:completedAt,rollbackReason,engineCheckpointId:engineResult?.checkpointId||null,restoredEngineVersion:engineResult?.restoredVersion||null,panelDeploymentId:panelResult?.vercel_deployment_id||null,databaseMigrations:"retained-forward-compatible"};
    const metadata={...(install.metadata&&typeof install.metadata==="object"?install.metadata:{}),appliedUpdate:null,rolledBackUpdate};
    const patch:any={metadata,last_deployment_at:completedAt,last_error:null,state:"ready"};
    if(panelResult){patch.vercel_deployment_id=panelResult.vercel_deployment_id;patch.deployment_url=panelResult.deployment_url||install.deployment_url;}
    const {data,error}=await licenseDb().from("orbitfs_installations").update(patch).eq("id",install.id).select().single();
    if(error)throw error;
    const history=await licenseDb().from("orbitfs_installation_releases").insert({installation_id:install.id,auth_user_id:install.auth_user_id,release_version:releaseVersion,release_id:releaseId,release_sha256:String(applied?.sha256||"")||null,source_commit:String(applied?.sourceCommit||"")||null,vercel_deployment_id:panelResult?.vercel_deployment_id||null,deployment_url:panelResult?.deployment_url||null,action:"rollback",status:"ready",ready_at:completedAt});
    if(history.error)throw history.error;
    const restoredEngineVersions=engineResult?.componentVersions&&typeof engineResult.componentVersions==="object"?engineResult.componentVersions:{};
    const restoredComponentState=Object.fromEntries(components.map((component:string)=>[component,{version:String(component==="base"?install.release_version:(restoredEngineVersions?.[component]||engineResult?.restoredVersion||"")),status:"installed"}]));
    await masterExecuteDeployment({action:"rollback",rollbackScope:"update",phase:"completed",releaseId,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel,productVersion:String(install.release_version||""),previousVersion:releaseVersion,deploymentId:panelResult?.vercel_deployment_id||engineResult?.host?.deploymentId||null,deploymentUrl:panelResult?.deployment_url||engineResult?.host?.hostUrl||null,projectId:install.vercel_project_id,projectName:install.vercel_project_name,componentState:restoredComponentState,components:restoredComponentState});
    await event(data,"update.rollback.completed","ok",`OrbitFS Update ${releaseVersion} rolled back`,{releaseId,components,reason:rollbackReason,engine:engineResult,panel:panelResult,databaseMigrations:"retained-forward-compatible"});
    return data;
  }catch(error){
    const message=error instanceof Error?error.message:String(error||"Update rollback failed");
    await Promise.allSettled([
      masterExecuteDeployment({action:"rollback",rollbackScope:"update",phase:"failed",releaseId,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel,productVersion:String(install.release_version||""),previousVersion:releaseVersion,components,error:message}),
      licenseDb().from("orbitfs_installations").update({state:"failed",last_error:message}).eq("id",install.id),
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
  const registration=install?.metadata?.licenseRegistration&&typeof install.metadata.licenseRegistration==="object"?install.metadata.licenseRegistration:null;
  const authorityLicenseId=String(registration?.masterLicenseId||"").trim();
  if(registration?.valid!==true||!authorityLicenseId||String(registration?.installationId||"")!==String(install.installation_id||""))fail("Register an OrbitFS licence key for this installation before deployment",409);

  if(action==="rollback"){
    const rollbackReason=String(reason||"").trim();
    if(!rollbackReason)fail("A rollback reason is required",400);
    const previous=await previousDeployment(install);
    const previousDeploymentId=previous.vercel_deployment_id;
    const previousReleaseId=previous.release_id;
    const rolledBackReleaseId=String(install.release_id||"").trim();
    const rolledBackVersion=String(install.release_version||"").trim();
    if(!rolledBackReleaseId||!rolledBackVersion)fail("Current Base release metadata is incomplete and cannot be recorded as rolled back",409);
    if(install.release_channel&&String(install.release_channel)!==requestedChannel)fail("Installation release channel does not match the requested rollback channel",409);
    await masterExecuteDeployment({action:"rollback",releaseId:previousReleaseId,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel:requestedChannel,productVersion:previous.release_version,previousVersion:rolledBackVersion});
    try{
      await event(install,"deployment.rollback.started","info",`Rolling back to ${previous.release_version}`,{deploymentId:previousDeploymentId,reason:rollbackReason});
      const result=await vercelApi(install.auth_user_id,`/v9/projects/${encodeURIComponent(install.vercel_project_id)}/rollback/${encodeURIComponent(previousDeploymentId)}`,{method:"POST",body:JSON.stringify({})});
      const completedAt=new Date().toISOString();
      const {data,error}=await licenseDb().from("orbitfs_installations").update({previous_release_version:rolledBackVersion,release_version:previous.release_version,release_id:previousReleaseId,vercel_deployment_id:previousDeploymentId,last_deployment_at:completedAt,last_error:null,state:"ready"}).eq("id",install.id).select().single();
      if(error)throw error;
      await masterExecuteDeployment({action:"rollback",phase:"completed",releaseId:previousReleaseId,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel:requestedChannel,productVersion:previous.release_version,previousVersion:rolledBackVersion,deploymentId:previousDeploymentId,projectId:install.vercel_project_id,projectName:install.vercel_project_name});
      await Promise.allSettled([
        reportDevPanelReleaseEvent({
          eventId:`base-rollback:${install.installation_id}:${rolledBackReleaseId}:${previousReleaseId}:${completedAt}`,
          eventType:"rolled_back",
          releaseId:rolledBackReleaseId,
          releaseVersion:rolledBackVersion,
          targetReleaseId:previousReleaseId,
          targetVersion:previous.release_version,
          releaseType:"base",
          channel:requestedChannel,
          installationId:install.installation_id,
          reason:rollbackReason,
          archived:false,
          status:"completed",
          occurredAt:completedAt,
          metadata:{deploymentId:previousDeploymentId,projectId:install.vercel_project_id,projectName:install.vercel_project_name}
        }),
        event(data,"deployment.rollback.completed","ok",`Rolled back from ${rolledBackVersion} to ${previous.release_version}`,{deploymentId:previousDeploymentId,result,reason:rollbackReason})
      ]);
      return data;
    }catch(error){
      const message=error instanceof Error?error.message:String(error||"Rollback failed");
      const failedAt=new Date().toISOString();
      await Promise.allSettled([
        reportDevPanelReleaseEvent({
          eventId:`base-rollback-failed:${install.installation_id}:${rolledBackReleaseId}:${failedAt}`,
          eventType:"rollback_failed",
          releaseId:rolledBackReleaseId,
          releaseVersion:rolledBackVersion,
          targetReleaseId:previousReleaseId,
          targetVersion:previous.release_version,
          releaseType:"base",
          channel:requestedChannel,
          installationId:install.installation_id,
          reason:rollbackReason+" — "+message,
          archived:false,
          status:"failed",
          occurredAt:failedAt
        }),
        licenseDb().from("orbitfs_installations").update({state:"failed",last_error:message}).eq("id",install.id),
        event(install,"deployment.rollback.failed","error",message,{reason:rollbackReason,releaseId:rolledBackReleaseId})
      ]);
      throw error;
    }
  }

  const pinInstalledBase=(action==="deploy"||action==="redeploy")&&!releaseId&&!version;
  const effectiveReleaseId=pinInstalledBase?String(install.release_id||"").trim()||undefined:releaseId;
  const effectiveVersion=pinInstalledBase&&!effectiveReleaseId?String(install.release_version||"").trim()||undefined:version;
  if(action==="redeploy"&&!effectiveReleaseId&&!effectiveVersion)fail("The installation does not have a Base release to redeploy",409);
  const release=await publishedRelease(effectiveVersion,action,requestedChannel,effectiveReleaseId);
  await masterExecuteDeployment({action,releaseId:release.id,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel:requestedChannel,productVersion:String(release.version),previousVersion:install.release_version||null,projectId:install.vercel_project_id||null,projectName:install.vercel_project_name||null});
  if(action!=="base_update")await progress?.("validated",{releaseId:String(release.id),releaseVersion:String(release.version),projectId:install.vercel_project_id||null});
  try{
  if(action==="base_update")return await runBaseUpdateDeployment(install,release,requestedChannel,authorityLicenseId,progress);
  if(action==="update"){
    const parsed=await readArtifact(release);
    if((parsed.root as any).format!=="orbitfs-update-bundle-v3")fail("Published Update release is not an OrbitFS Update Bundle v3",422);
    const bundle=parsed.root as UpdateBundle;
    const components=[...new Set(bundle.components.map(value=>String(value||"").trim().toLowerCase()).filter(Boolean))];
    if(!components.length||components.some(value=>!["base","apex","mcp","studio"].includes(value)))fail("Update Bundle targets are invalid",422);
    const releaseComponents=(Array.isArray(release?.manifest?.components)?release.manifest.components:[]).map((value:any)=>String(value||"").trim().toLowerCase()).filter(Boolean).sort();
    if(releaseComponents.length&&releaseComponents.join(",")!==components.slice().sort().join(","))fail("Update Bundle targets do not match License Master",422);
    const installedBase=String(install.release_version||"").trim();
    if(!installedBase)fail("Deploy OrbitFS Base before applying an Update release",409);
    const requiredBase=String(bundle.minimumBaseVersion||"").trim();
    const baseComparison=requiredBase?compareVersions(installedBase,requiredBase):0;
    if(requiredBase&&(baseComparison===null||baseComparison<0))fail(`Update ${release.version} requires Base ${requiredBase} or newer; this installation is Base ${installedBase}.`,409);
    const wantsPanel=components.includes("base"),wantsEngine=components.some(component=>component!=="base");
    const panel=bundle.payloads?.panel||null,engine=bundle.payloads?.engine||null;
    if(wantsPanel&&!panel)fail("Update Bundle targets Base but has no Panel payload",422);
    if(!wantsPanel&&panel)fail("Update Bundle contains a Panel payload without the Base target",422);
    if(wantsEngine&&!engine)fail("Update Bundle targets Engine components but has no Engine payload",422);
    if(!wantsEngine&&engine)fail("Update Bundle contains an Engine payload without Engine targets",422);
    if(engine)validateFiles(engine.files,"Engine update payload");
    const databaseMigrations=validateDatabaseContract(bundle);
    const currentBaseUrl=String(install.production_url||install.deployment_url||"").trim();
    let enginePreflight:any=null;
    if(wantsEngine){
      if(!currentBaseUrl)fail("Installed OrbitFS Base URL is unavailable for Engine update preflight",409);
      const planned=await engineUpdateRequest(currentBaseUrl,install,release,requestedChannel,"plan");
      enginePreflight=planned.body?.plan||null;
      if(planned.body?.release?.checkpointRequired!==true)fail("Installed Base rejected the Engine update checkpoint contract",409);
    }
    await event(install,"update.started","info",`Applying OrbitFS Update ${release.version}`,{releaseId:release.id,components,checksum:parsed.artifactSha256,databaseMigrationCount:databaseMigrations.length,enginePreflight});
    let panelResult:any=null;
    let engineResult:any=null;
    let engineAttempted=false;
    try{
      const databaseResult=await applyCustomerDatabaseMigrations(install,release,bundle);
      panelResult=panel?await deployPanelUpdatePayload(install,release,bundle,panel,parsed.artifactSha256,requestedChannel):null;
      const engineBaseUrl=String(panelResult?.deploymentUrl||install.production_url||install.deployment_url||"").trim();
      if(wantsEngine&&!engineBaseUrl)fail("Installed OrbitFS Base URL is unavailable for the Engine update",409);
      if(wantsEngine){
        engineAttempted=true;
        engineResult=await applyEngineUpdatePayload(install,release,requestedChannel,engineBaseUrl);
      }
      const appliedAt=new Date().toISOString();
      const componentVersions=bundle.componentVersions&&typeof bundle.componentVersions==="object"&&!Array.isArray(bundle.componentVersions)?bundle.componentVersions:{};
      const componentState=Object.fromEntries(components.map((component:string)=>[component,{version:String(componentVersions?.[component]||(component==="base"?install.release_version:release.version)||""),status:"installed"}]));
      const updateState={version:String(release.version),releaseId:String(release.id),sha256:parsed.artifactSha256,sourceCommit:String(bundle.sourceCommit||expectedSource(release)||""),channel:requestedChannel,components,componentVersions,appliedAt,panelDeploymentId:panelResult?.deploymentId||null,engineDeploymentId:engineResult?.deploymentId||null,databaseMigrations:databaseResult};
      const patch:any={
        release_channel:requestedChannel,
        vercel_deployment_id:panelResult?.deploymentId||install.vercel_deployment_id,
        deployment_url:panelResult?.deploymentUrl||install.deployment_url,
        last_deployment_at:appliedAt,
        last_error:null,
        state:"ready",
        metadata:{...(install.metadata&&typeof install.metadata==="object"?install.metadata:{}),appliedUpdate:updateState}
      };
      const {data,error}=await licenseDb().from("orbitfs_installations").update(patch).eq("id",install.id).select().single();
      if(error)throw error;
      const history=await licenseDb().from("orbitfs_installation_releases").insert({installation_id:install.id,auth_user_id:install.auth_user_id,release_version:String(release.version),release_id:String(release.id),release_sha256:parsed.artifactSha256,source_commit:bundle.sourceCommit||expectedSource(release)||null,vercel_deployment_id:panelResult?.deploymentId||null,deployment_url:panelResult?.deploymentUrl||null,action:"update",status:"ready",ready_at:appliedAt});
      if(history.error)throw history.error;
      const customerResult=await licenseDb().from("customers").select("id,customer_number,name,email").eq("auth_user_id",install.auth_user_id).maybeSingle();
      const customer=customerResult.data||null;
      await masterExecuteDeployment({action:"update",phase:"completed",releaseId:release.id,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel:requestedChannel,baseVersion:String(install.release_version||""),productVersion:String(install.release_version||""),previousVersion:install.release_version||null,deploymentId:panelResult?.deploymentId||engineResult?.deploymentId||null,deploymentUrl:panelResult?.deploymentUrl||engineResult?.hostUrl||null,projectId:install.vercel_project_id,projectName:install.vercel_project_name,componentState,components:componentState,customerIdentity:{customerId:customer?.id||null,customerNumber:customer?.customer_number||null,customerName:customer?.name||null,customerEmail:customer?.email||null,installationId:install.installation_id}});
      await event(data,"update.completed","ok",`OrbitFS Update ${release.version} applied`,updateState);
      return data;
    }catch(updateError){
      const recovery:any={databaseMigrations:"forward-compatible; not reversed",panel:null,engine:null};
      if(engineAttempted&&currentBaseUrl){
        try{
          const rolledBack=await rollbackEngineUpdatePayload(install,release,requestedChannel,currentBaseUrl);
          recovery.engine={ok:true,checkpointId:rolledBack.checkpointId||null,restoredVersion:rolledBack.restoredVersion||null};
        }catch(recoveryError){recovery.engine={ok:false,error:recoveryError instanceof Error?recoveryError.message:String(recoveryError)}}
      }
      if(panelResult?.deploymentId&&install.vercel_project_id&&install.vercel_deployment_id){
        try{
          await vercelApi(install.auth_user_id,`/v9/projects/${encodeURIComponent(String(install.vercel_project_id))}/rollback/${encodeURIComponent(String(install.vercel_deployment_id))}`,{method:"POST",body:JSON.stringify({})});
          recovery.panel={ok:true,deploymentId:String(install.vercel_deployment_id)};
        }catch(recoveryError){recovery.panel={ok:false,error:recoveryError instanceof Error?recoveryError.message:String(recoveryError)}}
      }
      await event(install,"update.recovery",recovery.panel?.ok===false||recovery.engine?.ok===false?"warning":"ok","Update failed; recovery attempted",{releaseId:release.id,components,recovery,error:updateError instanceof Error?updateError.message:String(updateError)});
      throw updateError;
    }
  }
  if(action==="deploy"&&!install.vercel_project_id)install=await ensureVercelProject(install);
  if(!install.vercel_project_id)fail("Customer Vercel project is unavailable for this deployment action",409,"BASE_PROJECT_NOT_FOUND");
  await configureVercel(install,String(release.version),undefined,requestedChannel,String(release.id),String(release.sha256||release.checksum||""),String(release.source_sha||release.source_commit||release.manifest?.sourceCommit||""));
  const parsed=action==="redeploy"?await readCurrentBasePackageForRedeploy(release):await readBasePackage(release);
  const packageDatabaseSchema=String((parsed.pkg as any).databaseSchemaVersion||(parsed.pkg as any).releaseInfo?.databaseSchemaVersion||release.manifest?.databaseSchemaVersion||"").trim();
  const installedDatabaseSchema=String(install.schema_version||"").trim();
  if(packageDatabaseSchema&&installedDatabaseSchema&&packageDatabaseSchema!==installedDatabaseSchema)fail(`Base release ${release.version} requires database schema ${packageDatabaseSchema}, but this installation is initialized with schema ${installedDatabaseSchema}.`,409);
  const projectSettings={framework:"sveltekit",installCommand:"npm ci",buildCommand:"npm run build",...(parsed.pkg.projectSettings||{})};
  await progress?.("deploying",{action,releaseId:String(release.id),projectId:install.vercel_project_id,fileCount:parsed.files.length});
  await event(install,"deployment.uploading","info",`Uploading ${parsed.files.length} verified Base files to Vercel`,{action,releaseId:release.id,fileCount:parsed.files.length});
  const uploadedFiles=await uploadVercelDeploymentFiles(String(install.auth_user_id),parsed.files);
  const body:any={name:install.vercel_project_name||`orbitfs-${install.installation_id.slice(-8)}`.toLowerCase(),project:install.vercel_project_id,target:"production",files:uploadedFiles,projectSettings,meta:{orbitfsReleaseId:String(release.id),orbitfsVersion:String(release.version),orbitfsAction:action,orbitfsChannel:requestedChannel,orbitfsSourceCommit:String(parsed.pkg.sourceCommit||release.sourceCommit||""),orbitfsInstallationRoute:"billing_store"}};
  await event(install,"deployment.started","info",`Deploying ${release.version}`,{action,releaseId:release.id,fileCount:parsed.files.length,checksum:parsed.artifactSha256});
  const created=await vercelApi(install.auth_user_id,"/v13/deployments",{method:"POST",body:JSON.stringify(body)});if(!created?.id&&!created?.uid)fail("Vercel did not return a deployment id",502);
  const deploymentId=String(created.id||created.uid);
  await licenseDb().from("orbitfs_installations").update({vercel_deployment_id:deploymentId,state:"deploying",last_error:null,updated_at:new Date().toISOString()}).eq("id",install.id);
  await event(install,"deployment.created","info",`Vercel deployment ${deploymentId} created`,{action,releaseId:release.id,deploymentId,projectId:install.vercel_project_id});
  await progress?.("verifying",{action,releaseId:String(release.id),projectId:install.vercel_project_id,deploymentId});
  const ready=await waitForReady(install.auth_user_id,deploymentId),state=String(ready?.readyState||ready?.state||"");if(state!=="READY")fail("Vercel deployment did not become ready within the deployment window",504);
  const previousVersion=install.release_version||null,deploymentUrl=ready?.url?`https://${String(ready.url).replace(/^https?:\/\//,"")}`:install.deployment_url;
  await configureVercel(install,String(release.version),deploymentUrl||undefined,requestedChannel,String(release.id),parsed.artifactSha256,String(parsed.pkg.sourceCommit||release.sourceCommit||""));
  // Billing Store owns deployment coordination only. Base owns first-time bootstrap:
  // storage preparation, licence activation, Owner creation, workspace creation and
  // runtime installation registration all happen inside the installed Base setup flow.
  const completedAt=new Date().toISOString();
  const patch={release_channel:requestedChannel,vercel_deployment_id:deploymentId,deployment_url:deploymentUrl,release_version:String(release.version),release_id:String(release.id),release_sha256:parsed.artifactSha256,release_source_commit:parsed.pkg.sourceCommit||release.sourceCommit||null,previous_release_version:previousVersion,last_deployment_at:completedAt,last_error:null,state:"ready"};
  const {data,error}=await licenseDb().from("orbitfs_installations").update(patch).eq("id",install.id).select().single();if(error)throw error;
  const history=await licenseDb().from("orbitfs_installation_releases").insert({installation_id:install.id,auth_user_id:install.auth_user_id,release_version:String(release.version),release_id:String(release.id),release_sha256:parsed.artifactSha256,source_commit:parsed.pkg.sourceCommit||release.sourceCommit||null,vercel_deployment_id:deploymentId,deployment_url:deploymentUrl,action,status:"ready",ready_at:completedAt});
  if(history.error)throw history.error;
  const customerResult=await licenseDb().from("customers").select("id,customer_number,name,email").eq("auth_user_id",install.auth_user_id).maybeSingle();
  const customer=customerResult.data||null;
  await masterExecuteDeployment({action,phase:"completed",releaseId:release.id,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel:requestedChannel,productVersion:String(release.version),previousVersion:previousVersion,deploymentId,deploymentUrl,projectId:install.vercel_project_id,projectName:install.vercel_project_name,customerIdentity:{customerId:customer?.id||null,customerNumber:customer?.customer_number||null,customerName:customer?.name||null,customerEmail:customer?.email||null,installationId:install.installation_id}});
  await event(data,"deployment.completed","ok",`Vercel deployment ${deploymentId} is ready`,{action,releaseId:release.id,version:release.version,deploymentId});return data;
  }catch(error:any){
    if(error?.orbitfsFailureReported===true)throw error;
    await reportDeploymentFailure(install,{action,releaseId:String(release.id),licenseId:authorityLicenseId,channel:requestedChannel,productVersion:String(release.version)},error);
    throw error;
  }
}
