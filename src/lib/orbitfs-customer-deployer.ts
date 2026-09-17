import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {licenseDb} from "@/lib/license-api";
import {masterDownloadReleaseArtifact,masterExecuteDeployment,masterReleases} from "@/lib/master-api";
import {event,requireSystem,vercelApi,type DeployAction} from "@/lib/orbitfs-deployment";

const MAX_FILES=5000,MAX_FILE_BYTES=25*1024*1024,MAX_TOTAL_BYTES=70*1024*1024;
const SAFE_PATH=/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*(?:^|\/)(?:\.git|\.vercel|node_modules)(?:\/|$))[A-Za-z0-9._@+\-\/]+$/;
type ReleaseFile={file:string;data:string;encoding?:string;sha256?:string};
type Package={version:string;releaseId?:string;sourceCommit?:string;components?:string[];projectSettings?:Record<string,unknown>;files:ReleaseFile[]};
const fail=(message:string,status=400):never=>{throw Object.assign(new Error(message),{status})};
const checksum=(buf:Buffer)=>createHash("sha256").update(buf).digest("hex");
const releaseType=(action:DeployAction)=>action==="update"?"update":"base";

async function publishedRelease(version:string|undefined,action:DeployAction){const rows=await masterReleases("orbitfs_base","stable",releaseType(action));const releases=(Array.isArray(rows?.releases)?rows.releases:Array.isArray(rows)?rows:[]).filter((r:any)=>String(r.status||"").toLowerCase()==="published"&&String(r.review_status||"").toLowerCase()==="approved");const wanted=version?releases.find((r:any)=>String(r.version)===version):releases[0];if(!wanted?.id)fail(version?`Published ${releaseType(action)} release ${version} was not found in License Master`:`No approved published ${releaseType(action)} release is available`,404);return wanted}

function gunzipArtifact(bytes:Buffer):Buffer{try{return gunzipSync(bytes)}catch{fail("Release artifact is not a valid OrbitFS gzip package",422);throw new Error("unreachable")}}
function parsePackage(raw:Buffer):Package{try{const value=JSON.parse(raw.toString("utf8")) as Package;if(!value||!Array.isArray(value.files)||!value.version)fail("Release package manifest is incomplete",422);return value}catch(error){if(error instanceof Error&&"status" in error)throw error;fail("Release package contains invalid JSON",422);throw new Error("unreachable")}}

async function readPackage(release:any){const artifact=await masterDownloadReleaseArtifact(String(release.id));if(artifact.bytes.byteLength>75*1024*1024)fail("Release artifact exceeds the customer deployer size limit",413);const raw=gunzipArtifact(artifact.bytes);if(raw.byteLength>MAX_TOTAL_BYTES)fail("Release package exceeds the customer deployer size limit",413);const pkg=parsePackage(raw);if(pkg.files.length<1||pkg.files.length>MAX_FILES)fail("Release package file count is invalid",422);let total=0;const files=pkg.files.map((entry:any)=>{const file=String(entry?.file||"").replaceAll("\\","/");if(!SAFE_PATH.test(file))fail(`Unsafe release path: ${file}`,422);if(entry.encoding!=="base64"||typeof entry.data!=="string")fail(`Release file ${file} is not base64 encoded`,422);const data=Buffer.from(entry.data,"base64");if(data.byteLength>MAX_FILE_BYTES)fail(`Release file ${file} exceeds the file size limit`,413);total+=data.byteLength;const actual=checksum(data);if(entry.sha256&&String(entry.sha256)!==actual)fail(`Release checksum mismatch for ${file}`,422);return {file,data:data.toString("base64"),sha256:actual,size:data.byteLength}});if(total>MAX_TOTAL_BYTES)fail("Release package exceeds the total file size limit",413);const expected=String(release.sha256||release.checksum||release.artifactSha256||"").trim();if(expected&&expected!==checksum(artifact.bytes))fail("Release artifact checksum does not match License Master metadata",422);if(String(pkg.version)!==String(release.version))fail("Release package version does not match License Master",422);return {pkg,files,artifactSha256:checksum(artifact.bytes)}}
async function waitForReady(userId:string,id:string){const deadline=Date.now()+120000;let last:any=null;while(Date.now()<deadline){last=await vercelApi(userId,`/v13/deployments/${encodeURIComponent(id)}`,{method:"GET"});const state=String(last?.readyState||last?.state||"");if(state==="READY")return last;if(["ERROR","CANCELED"].includes(state))fail(`Vercel deployment failed (${state})`,502);await new Promise(r=>setTimeout(r,3000))}return last}
async function previousDeployment(install:any){const {data,error}=await licenseDb().from("orbitfs_installation_releases").select("vercel_deployment_id,release_version,release_id,created_at").eq("installation_id",install.id).eq("status","ready").order("created_at",{ascending:false}).limit(2);if(error)throw error;const previous=(data||[]).find((r:any)=>r.vercel_deployment_id!==install.vercel_deployment_id);return previous??null}

export async function runCustomerDeployer(install:any,action:DeployAction,version?:string){
  await requireSystem(action==="rollback"?"rollback":action==="update"?"update":"deploy");
  if(!install.vercel_project_id)fail("Connect and select a customer Vercel project before deploying",409);

  if(action==="rollback"){
    const previous=await previousDeployment(install);
    if(!previous)fail("No previous successful deployment is available for rollback",409);
    const previousRecord=previous;
    const previousDeploymentId=String(previousRecord.vercel_deployment_id||"");
    const previousReleaseId=String(previousRecord.release_id||"");
    if(!previousDeploymentId||!previousReleaseId)fail("Previous deployment record is incomplete and cannot be rolled back",409);
    await masterExecuteDeployment({action:"rollback",releaseId:previousReleaseId,installationId:install.id,userRef:install.auth_user_id});
    await event(install,"deployment.rollback.started","info",`Rolling back to ${previousRecord.release_version}`,{deploymentId:previousDeploymentId});
    const result=await vercelApi(install.auth_user_id,`/v9/projects/${encodeURIComponent(install.vercel_project_id)}/rollback/${encodeURIComponent(previousDeploymentId)}`,{method:"POST",body:JSON.stringify({})});
    const {data,error}=await licenseDb().from("orbitfs_installations").update({previous_release_version:install.release_version||null,release_version:previousRecord.release_version,release_id:previousReleaseId,vercel_deployment_id:previousDeploymentId,last_deployment_at:new Date().toISOString(),last_error:null,state:"deployed"}).eq("id",install.id).select().single();
    if(error)throw error;await event(data,"deployment.rollback.completed","ok",`Rolled back to ${previousRecord.release_version}`,{deploymentId:previousDeploymentId,result});return data;
  }

  const release=await publishedRelease(version,action),parsed=await readPackage(release);
  await masterExecuteDeployment({action,releaseId:release.id,installationId:install.id,userRef:install.auth_user_id});
  const body:any={name:install.vercel_project_name||`orbitfs-${install.installation_id.slice(-8)}`.toLowerCase(),project:install.vercel_project_id,target:"production",files:parsed.files.map(f=>({file:f.file,data:f.data})),projectSettings:parsed.pkg.projectSettings||{},meta:{orbitfsReleaseId:String(release.id),orbitfsVersion:String(release.version),orbitfsAction:action,orbitfsSourceCommit:String(parsed.pkg.sourceCommit||release.sourceCommit||"")}};
  await event(install,"deployment.started","info",`Deploying ${release.version}`,{action,releaseId:release.id,fileCount:parsed.files.length,checksum:parsed.artifactSha256});
  const created=await vercelApi(install.auth_user_id,"/v13/deployments",{method:"POST",body:JSON.stringify(body)});if(!created?.id&&!created?.uid)fail("Vercel did not return a deployment id",502);
  const deploymentId=String(created.id||created.uid),ready=await waitForReady(install.auth_user_id,deploymentId),state=String(ready?.readyState||ready?.state||"");if(state!=="READY")fail("Vercel deployment did not become ready within the deployment window",504);
  const previousVersion=install.release_version||null,deploymentUrl=ready?.url?`https://${String(ready.url).replace(/^https?:\/\//,"")}`:install.deployment_url,patch={vercel_deployment_id:deploymentId,deployment_url:deploymentUrl,release_version:String(release.version),release_id:String(release.id),release_sha256:parsed.artifactSha256,release_source_commit:parsed.pkg.sourceCommit||release.sourceCommit||null,previous_release_version:previousVersion,last_deployment_at:new Date().toISOString(),last_error:null,state:"deployed"};
  const {data,error}=await licenseDb().from("orbitfs_installations").update(patch).eq("id",install.id).select().single();if(error)throw error;
  await licenseDb().from("orbitfs_installation_releases").insert({installation_id:install.id,auth_user_id:install.auth_user_id,release_version:String(release.version),release_id:String(release.id),release_sha256:parsed.artifactSha256,source_commit:parsed.pkg.sourceCommit||release.sourceCommit||null,vercel_deployment_id:deploymentId,deployment_url:deploymentUrl,action,status:"ready",ready_at:new Date().toISOString()});
  await event(data,"deployment.completed","ok",`Vercel deployment ${deploymentId} is ready`,{action,releaseId:release.id,version:release.version,deploymentId});return data;
}