import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {licenseDb} from "@/lib/license-api";
import {masterDownloadReleaseArtifact,masterExecuteDeployment,masterReleases} from "@/lib/master-api";
import {configureVercel,configureVercelUpdateIdentity,customerInstallationDbSecret,customerVercelCredentials,event,requireSystem,vercelApi,type DeployAction} from "@/lib/orbitfs-deployment";
import {customerReleaseChannels} from "@/lib/orbitfs-release-channels";

const MAX_FILES=5000,MAX_FILE_BYTES=25*1024*1024,MAX_TOTAL_BYTES=70*1024*1024;
const SAFE_PATH=/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*(?:^|\/)(?:\.git|\.vercel|node_modules)(?:\/|$))[A-Za-z0-9._@+\-\/]+$/;
type ReleaseFile={file:string;data:string;encoding?:string;sha256?:string;size?:number;component?:string};
type Package={format?:string;schemaVersion?:number;version:string;releaseId?:string;sourceCommit?:string;components?:string[];projectSettings?:Record<string,unknown>;files:ReleaseFile[];[key:string]:any};
type UpdateBundle={format:"orbitfs-update-bundle-v3";schemaVersion:number;version:string;sourceCommit?:string;components:string[];minimumBaseVersion?:string;minimumEngineDeployerProtocol?:number;checkpointRequired?:boolean;payloads:{panel:Package|null;engine:Package|null};[key:string]:any};
type ParsedArtifact={root:Package|UpdateBundle;artifactSha256:string};
const fail=(message:string,status=400):never=>{throw Object.assign(new Error(message),{status})};
const checksum=(buf:Buffer)=>createHash("sha256").update(buf).digest("hex");
const releaseType=(action:DeployAction)=>action==="update"?"update":"base";

async function publishedRelease(version:string|undefined,action:DeployAction,channel="stable",releaseId?:string):Promise<any>{const rows=await masterReleases("orbitfs_base",channel,releaseType(action),"deployer");const releases=(Array.isArray(rows?.releases)?rows.releases:Array.isArray(rows)?rows:[]).filter((r:any)=>String(r.status||"").toLowerCase()==="published"&&String(r.review_status||"").toLowerCase()==="approved");const wanted=releaseId?releases.find((r:any)=>String(r.id)===String(releaseId)):version?releases.find((r:any)=>String(r.version)===version):releases[0];if(!wanted?.id)fail(releaseId?`Selected published ${releaseType(action)} release is no longer available in License Master`:version?`Published ${releaseType(action)} release ${version} was not found in License Master`:`No approved published ${releaseType(action)} release is available`,404);if(String(wanted.channel||channel)!==channel)fail("Selected release channel does not match the installation channel",409);return wanted}

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
  if(releaseComponents.length&&packageComponents.length&&releaseComponents.join(",")!==packageComponents.join(","))fail("Release package components do not match License Master",422);
  return {pkg,files:validateFiles(pkg.files,"Base package"),artifactSha256:parsed.artifactSha256};
}
function versionParts(value:unknown){const m=String(value||"").trim().match(/^(\d+)\.(\d+)\.(\d+)/);return m?[Number(m[1]),Number(m[2]),Number(m[3])]:null}
function compareVersions(a:unknown,b:unknown){const av=versionParts(a),bv=versionParts(b);if(!av||!bv)return null;return av[0]-bv[0]||av[1]-bv[1]||av[2]-bv[2]}
async function registerBaseInstallation(install:any,deploymentUrl:string,deploymentId:string){
  const baseUrl=String(deploymentUrl||'').replace(/\/$/,'');
  if(!baseUrl)fail("Base deployment did not return a public URL",502);
  const response=await fetch(`${baseUrl}/api/setup/bootstrap`,{
    method:"POST",
    headers:{"content-type":"application/json","x-orbitfs-installation-id":String(install.installation_id||"")},
    body:JSON.stringify({
      installationRoute:"billing_store",
      registeredBy:String(install.auth_user_id||"billing-store"),
      deploymentId,
      projectId:String(install.vercel_project_id||"")
    }),
    signal:AbortSignal.timeout(15000),
    cache:"no-store"
  });
  const body:any=await response.json().catch(()=>({}));
  if(!response.ok)fail(String(body?.error||"Base deployment completed but Base setup registration failed"),502);
  return body;
}
async function waitForReady(userId:string,id:string):Promise<any>{const deadline=Date.now()+120000;let last:any=null;while(Date.now()<deadline){last=await vercelApi(userId,`/v13/deployments/${encodeURIComponent(id)}`,{method:"GET"});const state=String(last?.readyState||last?.state||"");if(state==="READY")return last;if(["ERROR","CANCELED"].includes(state))fail(`Vercel deployment failed (${state})`,502);await new Promise(r=>setTimeout(r,3000))}return last}
async function deployPanelUpdatePayload(install:any,release:any,bundle:UpdateBundle,panel:Package,artifactSha256:string,channel:string){
  const installedBase=String(install.release_version||"").trim();
  const baseline=String((panel as any).baseVersion||bundle.minimumBaseVersion||"").trim();
  if(!installedBase)fail("Deploy OrbitFS Base before applying a Panel update",409);
  if(!baseline||installedBase!==baseline)fail(`Panel update ${release.version} was built on Base ${baseline||"unknown"}, but this installation is Base ${installedBase}. Use a matching update or publish a newer Base deployment.`,409);
  const files=validateFiles(panel.files,"Panel update payload");
  await configureVercelUpdateIdentity(install,{version:String(release.version),releaseId:String(release.id),sha256:artifactSha256,sourceCommit:bundle.sourceCommit||expectedSource(release),channel,components:bundle.components});
  const body:any={
    name:install.vercel_project_name||`orbitfs-${String(install.installation_id||"").slice(-8)}`.toLowerCase(),
    project:install.vercel_project_id,
    target:"production",
    files:files.map(file=>({file:file.file,data:file.data})),
    projectSettings:panel.projectSettings||{},
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
async function engineUpdateRequest(baseUrl:string,install:any,release:any,channel:string,mode:"apply"|"refresh"){
  const [secret,vercel]=await Promise.all([customerInstallationDbSecret(String(install.id)),customerVercelCredentials(String(install.auth_user_id))]);
  const response=await fetch(`${baseUrl.replace(/\/$/,"")}/api/store/update-engine`,{
    method:"POST",
    headers:{"content-type":"application/json","x-orbitfs-db-secret":secret,"x-orbitfs-installation-id":String(install.installation_id||"")},
    body:JSON.stringify({mode,releaseId:String(release.id),releaseChannel:channel,vercelToken:vercel.token,teamId:vercel.teamId||""}),
    cache:"no-store",
    signal:AbortSignal.timeout(30000)
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
async function previousDeployment(install:any):Promise<{vercel_deployment_id:string;release_version:string;release_id:string;created_at:string}>{const {data,error}=await licenseDb().from("orbitfs_installation_releases").select("vercel_deployment_id,release_version,release_id,created_at,action").eq("installation_id",install.id).eq("status","ready").neq("action","update").not("vercel_deployment_id","is",null).order("created_at",{ascending:false}).limit(5);if(error)throw error;const previous=(data||[]).find((r:any)=>r.vercel_deployment_id!==install.vercel_deployment_id);if(!previous)throw Object.assign(new Error("No previous successful Base deployment is available for rollback"),{status:409});if(!previous.vercel_deployment_id||!previous.release_id||!previous.release_version)throw Object.assign(new Error("Previous Base deployment record is incomplete and cannot be rolled back"),{status:409});return {vercel_deployment_id:String(previous.vercel_deployment_id),release_version:String(previous.release_version),release_id:String(previous.release_id),created_at:String(previous.created_at||"")}}

async function reportDeploymentFailure(install:any,input:{action:DeployAction;releaseId:string;licenseId:string;channel:string;productVersion?:string},error:unknown){
  const message=error instanceof Error?error.message:String(error||"Deployment failed");
  await Promise.allSettled([
    masterExecuteDeployment({action:input.action,phase:"failed",releaseId:input.releaseId,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:input.licenseId,channel:input.channel,productVersion:input.productVersion,previousVersion:install.release_version||null,error:message}),
    licenseDb().from("orbitfs_installations").update({state:"failed",last_error:message}).eq("id",install.id),
    event(install,input.action==="update"?"update.failed":input.action==="rollback"?"deployment.rollback.failed":"deployment.failed","error",message,{action:input.action,releaseId:input.releaseId})
  ]);
}

export async function runCustomerDeployer(install:any,action:DeployAction,version?:string,channel?:string,releaseId?:string){
  const requestedChannel=String(channel||install.release_channel||"stable").trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(requestedChannel))fail("Invalid release channel",400);
  const allowedChannels=await customerReleaseChannels(String(install.auth_user_id));
  if(!allowedChannels.includes(requestedChannel))fail(`Release channel "${requestedChannel}" is not available for this customer`,403);
  await requireSystem(action==="rollback"?"rollback":action==="update"?"update":"deploy");
  if(!install.vercel_project_id)fail("Connect and select a customer Vercel project before deploying",409);

  const binding=install.license_binding_id?await licenseDb().from("license_bindings").select("license_id").eq("id",install.license_binding_id).maybeSingle():{data:null};
  if((binding as any)?.error)throw (binding as any).error;
  const licenseId=(binding as any)?.data?.license_id?String((binding as any).data.license_id):null;
  if(!licenseId)fail("Installation is not linked to an active License Manager licence",409);
  const authorityLicenseId:string=licenseId;

  if(action==="rollback"){
    const previous=await previousDeployment(install);
    const previousDeploymentId=previous.vercel_deployment_id;
    const previousReleaseId=previous.release_id;
    if(install.release_channel&&String(install.release_channel)!==requestedChannel)fail("Installation release channel does not match the requested rollback channel",409);
    await masterExecuteDeployment({action:"rollback",releaseId:previousReleaseId,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel:requestedChannel,productVersion:previous.release_version,previousVersion:install.release_version||null});
    try{
      await event(install,"deployment.rollback.started","info",`Rolling back to ${previous.release_version}`,{deploymentId:previousDeploymentId});
      const result=await vercelApi(install.auth_user_id,`/v9/projects/${encodeURIComponent(install.vercel_project_id)}/rollback/${encodeURIComponent(previousDeploymentId)}`,{method:"POST",body:JSON.stringify({})});
      const completedAt=new Date().toISOString();
      const {data,error}=await licenseDb().from("orbitfs_installations").update({previous_release_version:install.release_version||null,release_version:previous.release_version,release_id:previousReleaseId,vercel_deployment_id:previousDeploymentId,last_deployment_at:completedAt,last_error:null,state:"ready"}).eq("id",install.id).select().single();
      if(error)throw error;
      await masterExecuteDeployment({action:"rollback",phase:"completed",releaseId:previousReleaseId,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel:requestedChannel,productVersion:previous.release_version,previousVersion:install.release_version||null,deploymentId:previousDeploymentId,projectId:install.vercel_project_id,projectName:install.vercel_project_name});
      await event(data,"deployment.rollback.completed","ok",`Rolled back to ${previous.release_version}`,{deploymentId:previousDeploymentId,result});return data;
    }catch(error){
      await reportDeploymentFailure(install,{action:"rollback",releaseId:previousReleaseId,licenseId:authorityLicenseId,channel:requestedChannel,productVersion:previous.release_version},error);
      throw error;
    }
  }

  const release=await publishedRelease(version,action,requestedChannel,releaseId);
  await masterExecuteDeployment({action,releaseId:release.id,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel:requestedChannel,productVersion:String(release.version),previousVersion:install.release_version||null});
  try{
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
    await event(install,"update.started","info",`Applying OrbitFS Update ${release.version}`,{releaseId:release.id,components,checksum:parsed.artifactSha256});
    const panelResult=panel?await deployPanelUpdatePayload(install,release,bundle,panel,parsed.artifactSha256,requestedChannel):null;
    const engineBaseUrl=String(panelResult?.deploymentUrl||install.production_url||install.deployment_url||"").trim();
    if(wantsEngine&&!engineBaseUrl)fail("Installed OrbitFS Base URL is unavailable for the Engine update",409);
    const engineResult=wantsEngine?await applyEngineUpdatePayload(install,release,requestedChannel,engineBaseUrl):null;
    const appliedAt=new Date().toISOString();
    const updateState={version:String(release.version),releaseId:String(release.id),sha256:parsed.artifactSha256,sourceCommit:String(bundle.sourceCommit||expectedSource(release)||""),channel:requestedChannel,components,appliedAt,panelDeploymentId:panelResult?.deploymentId||null,engineDeploymentId:engineResult?.deploymentId||null};
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
    await masterExecuteDeployment({action:"update",phase:"completed",releaseId:release.id,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel:requestedChannel,productVersion:String(release.version),previousVersion:install.release_version||null,deploymentId:panelResult?.deploymentId||engineResult?.deploymentId||null,deploymentUrl:panelResult?.deploymentUrl||engineResult?.hostUrl||null,projectId:install.vercel_project_id,projectName:install.vercel_project_name,components,customerIdentity:{customerId:customer?.id||null,customerNumber:customer?.customer_number||null,customerName:customer?.name||null,customerEmail:customer?.email||null,installationId:install.installation_id}});
    await event(data,"update.completed","ok",`OrbitFS Update ${release.version} applied`,updateState);
    return data;
  }
  await configureVercel(install,String(release.version),undefined,requestedChannel,String(release.id),String(release.sha256||release.checksum||""),String(release.source_sha||release.source_commit||release.manifest?.sourceCommit||""));
  const parsed=await readBasePackage(release);
  const body:any={name:install.vercel_project_name||`orbitfs-${install.installation_id.slice(-8)}`.toLowerCase(),project:install.vercel_project_id,target:"production",files:parsed.files.map(f=>({file:f.file,data:f.data})),projectSettings:parsed.pkg.projectSettings||{},meta:{orbitfsReleaseId:String(release.id),orbitfsVersion:String(release.version),orbitfsAction:action,orbitfsChannel:requestedChannel,orbitfsSourceCommit:String(parsed.pkg.sourceCommit||release.sourceCommit||""),orbitfsInstallationRoute:"billing_store"}};
  await event(install,"deployment.started","info",`Deploying ${release.version}`,{action,releaseId:release.id,fileCount:parsed.files.length,checksum:parsed.artifactSha256});
  const created=await vercelApi(install.auth_user_id,"/v13/deployments",{method:"POST",body:JSON.stringify(body)});if(!created?.id&&!created?.uid)fail("Vercel did not return a deployment id",502);
  const deploymentId=String(created.id||created.uid),ready=await waitForReady(install.auth_user_id,deploymentId),state=String(ready?.readyState||ready?.state||"");if(state!=="READY")fail("Vercel deployment did not become ready within the deployment window",504);
  const previousVersion=install.release_version||null,deploymentUrl=ready?.url?`https://${String(ready.url).replace(/^https?:\/\//,"")}`:install.deployment_url;
  await configureVercel(install,String(release.version),deploymentUrl||undefined,requestedChannel,String(release.id),parsed.artifactSha256,String(parsed.pkg.sourceCommit||release.sourceCommit||""));
  await registerBaseInstallation(install,deploymentUrl,deploymentId);
  const completedAt=new Date().toISOString();
  const patch={release_channel:requestedChannel,vercel_deployment_id:deploymentId,deployment_url:deploymentUrl,release_version:String(release.version),release_id:String(release.id),release_sha256:parsed.artifactSha256,release_source_commit:parsed.pkg.sourceCommit||release.sourceCommit||null,previous_release_version:previousVersion,last_deployment_at:completedAt,last_error:null,state:"ready"};
  const {data,error}=await licenseDb().from("orbitfs_installations").update(patch).eq("id",install.id).select().single();if(error)throw error;
  const history=await licenseDb().from("orbitfs_installation_releases").insert({installation_id:install.id,auth_user_id:install.auth_user_id,release_version:String(release.version),release_id:String(release.id),release_sha256:parsed.artifactSha256,source_commit:parsed.pkg.sourceCommit||release.sourceCommit||null,vercel_deployment_id:deploymentId,deployment_url:deploymentUrl,action,status:"ready",ready_at:completedAt});
  if(history.error)throw history.error;
  const customerResult=await licenseDb().from("customers").select("id,customer_number,name,email").eq("auth_user_id",install.auth_user_id).maybeSingle();
  const customer=customerResult.data||null;
  await masterExecuteDeployment({action,phase:"completed",releaseId:release.id,installationId:install.installation_id,userRef:install.auth_user_id,licenseId:authorityLicenseId,channel:requestedChannel,productVersion:String(release.version),previousVersion:previousVersion,deploymentId,deploymentUrl,projectId:install.vercel_project_id,projectName:install.vercel_project_name,customerIdentity:{customerId:customer?.id||null,customerNumber:customer?.customer_number||null,customerName:customer?.name||null,customerEmail:customer?.email||null,installationId:install.installation_id}});
  await event(data,"deployment.completed","ok",`Vercel deployment ${deploymentId} is ready`,{action,releaseId:release.id,version:release.version,deploymentId});return data;
  }catch(error){
    await reportDeploymentFailure(install,{action,releaseId:String(release.id),licenseId:authorityLicenseId,channel:requestedChannel,productVersion:String(release.version)},error);
    throw error;
  }
}
