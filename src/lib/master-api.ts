import {getMasterApiUrl} from "@/lib/license-master-config";
import {errorMessage} from "@/lib/error-message";

async function configuredMasterApiBase(){return getMasterApiUrl();}

const timeoutMs=()=>Math.max(1000,Number(process.env.MASTER_API_TIMEOUT_MS||10000));
const getCacheSeconds=()=>Math.min(300,Math.max(0,Number(process.env.MASTER_API_CACHE_SECONDS||30)));
type MasterRole="billing"|"deployer";
const token=(role:MasterRole="billing")=>String(role==="deployer"?process.env.DEPLOYER_API_TOKEN||"":process.env.BILLING_API_TOKEN||"").trim();
function requireConfig(role:MasterRole="billing"){const value=token(role);const variable=role==="deployer"?"DEPLOYER_API_TOKEN":"BILLING_API_TOKEN";if(!value)throw new Error(`License Master API token is not configured (set ${variable})`);return {value};}
function masterPath(path:string){const clean=path.startsWith("/")?path:`/${path}`;return clean.startsWith("/api/v1/")?clean.slice(7):clean.startsWith("/api/")?clean.slice(4):clean;}
async function fetchWithTimeout(url:string,init:RequestInit,role:MasterRole="billing"){const cfg=requireConfig(role);const headers=new Headers(init.headers);headers.set("authorization",`Bearer ${cfg.value}`);const controller=init.signal?null:new AbortController();const timer=controller?setTimeout(()=>controller.abort(),timeoutMs()):null;try{return await fetch(url,{...init,headers,signal:init.signal||controller?.signal});}catch(error){if(error instanceof Error&&error.name==="AbortError")throw new Error(`License Master request timed out after ${timeoutMs()}ms`);throw new Error(`License Master connection failed: ${error instanceof Error?error.message:String(error)}`);}finally{if(timer)clearTimeout(timer);}}
export async function masterRequest(path:string,init:RequestInit={},role:MasterRole="billing"){const headers=new Headers(init.headers);if(!headers.has("content-type")&&init.body)headers.set("content-type","application/json");const method=String(init.method||"GET").toUpperCase();const fetchInit:RequestInit={...init,headers};if(method==="GET"&&getCacheSeconds()>0&&fetchInit.cache!=="no-store")(fetchInit as any).next={revalidate:getCacheSeconds()};else fetchInit.cache="no-store";const base=await configuredMasterApiBase();const response=await fetchWithTimeout(`${base}${masterPath(path)}`,fetchInit,role);const text=await response.text();let data:any={};try{data=text?JSON.parse(text):{};}catch{data={error:text||"License Master returned an invalid response"};}if(!response.ok){const code=String(data?.code||"").trim(),message=errorMessage(data?.error??data?.message??data?.detail??code,`License Master request failed (${response.status})`);throw Object.assign(new Error(code&&message!==code?`${message} (${code})`:message),{status:response.status,code:code||undefined});}return data;}

export async function masterProducts(role:MasterRole="billing"){
  return masterRequest("/api/v1/products",{method:"GET"},role);
}
export async function masterLicenses(role:MasterRole="billing",customerExternalId?:string){
  const qs=new URLSearchParams();
  const customer=String(customerExternalId||"").trim();
  if(customer)qs.set("customer_external_id",customer);
  const query=qs.toString();
  return masterRequest("/api/v1/license"+(query?"?"+query:""),{method:"GET",cache:"no-store"},role);
}
export async function masterReleases(product="orbitfs_base",channel="all",releaseType="all",role:MasterRole="billing",fresh=false,includeArchived=false){
  const qs=new URLSearchParams();
  const p=String(product||"").trim().toLowerCase();
  const c=String(channel||"").trim().toLowerCase();
  const t=String(releaseType||"").trim().toLowerCase();
  if(p&&p!=="all")qs.set("product",p);
  if(c&&c!=="all")qs.set("channel",c);
  if(t&&t!=="all")qs.set("type",t);
  if(includeArchived)qs.set("include_archived","true");
  const query=qs.toString();
  return masterRequest("/api/v1/releases"+(query?"?"+query:""),{method:"GET",...(fresh?{cache:"no-store" as RequestCache}:{})},role);
}

const ALLOWED_PRODUCTS=new Set(["orbitfs_base","orbitfs_mcp","orbitfs_apex","orbitfs_studio"]);
export async function masterLicenseValidate(input:any){const product=String(input.product||input.product_code||"orbitfs_base").trim().toLowerCase();const licenseKey=String(input.licenseKey||input.license_key||"").trim();if(!ALLOWED_PRODUCTS.has(product))throw Object.assign(new Error("Unsupported OrbitFS license product"),{status:400,code:"UNSUPPORTED_PRODUCT"});if(!licenseKey)throw Object.assign(new Error("License key is required"),{status:400,code:"LICENSE_KEY_REQUIRED"});return masterRequest("/api/v1/license/validate",{method:"POST",body:JSON.stringify({action:String(input.action||((input.activate===true)?"activate":"validate")).trim().toLowerCase(),license_key:licenseKey,installation_id:input.installationId||input.installation_id,product,component:String(input.component||product).trim().toLowerCase(),product_version:input.productVersion||input.product_version||input.appVersion||undefined,metadata:input.metadata&&typeof input.metadata==="object"?input.metadata:{}})},"billing");}
export const masterValidate=masterLicenseValidate;
export async function masterIssue(input:any){return masterRequest("/api/v1/license",{method:"POST",headers:{"x-orbitfs-order-ref":String(input.external_reference||input.orderRef||"")},body:JSON.stringify({product:input.product||input.product_code||input.productCode||"orbitfs_base",customer_external_id:input.customer_external_id||input.customerRef||null,customer_override:Boolean(input.customer_override??input.customerOverride),external_reference:input.external_reference||input.orderRef||null,expires_at:input.expires_at||input.expiresAt||null,components:input.components||null,max_installations:input.max_installations||input.maxInstallations||null,metadata:input.metadata&&typeof input.metadata==="object"?input.metadata:{}})},"billing");}
export async function masterPulse(input:any={}){return masterRequest("/api/v1/license/pulse",{method:"POST",body:JSON.stringify(input)},"billing");}
export async function masterPulseState(){return masterRequest("/api/v1/license/pulse",{method:"GET",cache:"no-store"},"billing");}
export async function masterControl(id:string,input:any){const action=String(input?.action||"").toLowerCase();return masterRequest(`/api/v1/license/${encodeURIComponent(id)}/control`,{method:"POST",body:JSON.stringify({...input,action,actorRef:input?.actorRef||"billing_store"})},"billing");}
export async function masterCreateRelease(input:any){return masterRequest("/api/v1/releases",{method:"POST",body:JSON.stringify({...input,product:input.product||input.product_code||"orbitfs_base",release_type:input.release_type||"base"})},"billing");}
export async function masterUpdateRelease(id:string,input:any){return masterRequest(`/api/v1/releases/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify(input)},"billing");}
export async function masterPublishRelease(id:string){return masterRequest(`/api/v1/releases/${encodeURIComponent(id)}`,{method:"POST",body:JSON.stringify({action:"publish"})},"billing");}
export async function masterPromoteRelease(id:string,targetChannel:string){return masterRequest(`/api/v1/releases/${encodeURIComponent(id)}`,{method:"POST",body:JSON.stringify({action:"promote",target_channel:String(targetChannel).trim().toLowerCase()})},"billing");}
export async function masterValidateRelease(id:string){return masterRequest(`/api/v1/releases/${encodeURIComponent(id)}/validate`,{method:"POST"},"billing");}
export async function masterControlRelease(id:string,status:string){const action=status==="paused"?"disable":status==="withdrawn"?"withdraw":status;return masterRequest(`/api/v1/releases/${encodeURIComponent(id)}`,{method:"POST",body:JSON.stringify({action})},"billing");}
export async function masterDownloadReleaseArtifact(id:string){const base=await configuredMasterApiBase();const response=await fetchWithTimeout(`${base}${masterPath(`/api/v1/releases/${encodeURIComponent(id)}/artifact`)}`,{method:"GET",cache:"no-store"},"deployer");if(!response.ok){const text=await response.text();let data:any={};try{data=text?JSON.parse(text):{};}catch{}const code=String(data?.code||"ARTIFACT_DOWNLOAD_FAILED"),detail=errorMessage(data?.message??data?.detail??data?.error??text,"").trim();throw Object.assign(new Error(`License Master artifact download failed for release ${id} (${response.status}, ${code})${detail&&detail!==code?`: ${detail}`:""}`),{status:response.status,code});}return{bytes:Buffer.from(await response.arrayBuffer()),contentType:response.headers.get("content-type")||"application/octet-stream",contentDisposition:response.headers.get("content-disposition")||null};}
export type MasterDeploymentComponentPlan={
  releaseComponents:string[];
  entitledComponents:string[];
  executionComponents:string[];
  skippedComponents:string[];
};
export type MasterDeploymentResult={
  ok?:boolean;
  authorized?:boolean;
  recorded?:boolean;
  authority?:string;
  notApplicable?:boolean;
  code?:string;
  componentPlan?:MasterDeploymentComponentPlan;
  release?:{id?:string;version?:string;releaseType?:string;product?:string;artifactSha256?:string;sourceRepo?:string;sourceRef?:string};
  execution?:string;
};
export async function masterExecuteDeployment(input:any):Promise<MasterDeploymentResult>{
  return await masterRequest("/api/v1/deployer",{method:"POST",body:JSON.stringify({...input,phase:input.phase||"authorize"})},"deployer") as MasterDeploymentResult;
}
export async function masterInstallationDetails(installationId:string,licenseId?:string|null){const qs=new URLSearchParams({installation_id:String(installationId||"").trim()});if(licenseId)qs.set("license_id",String(licenseId).trim());return masterRequest(`/api/v1/deployer?${qs.toString()}`,{method:"GET",cache:"no-store"},"deployer");}
export async function masterInstallations(limit=250){const value=Math.min(500,Math.max(1,Number(limit)||250));return masterRequest(`/api/v1/installations?limit=${value}`,{method:"GET",cache:"no-store"},"deployer");}
export async function masterInstallationControl(input:any){return masterRequest("/api/v1/installations/control",{method:"POST",body:JSON.stringify(input)},"deployer");}
export async function masterInstallationLifecycle(input:any){return masterRequest("/api/v1/installations/lifecycle",{method:"POST",body:JSON.stringify(input)},"deployer");}
export const licensingAuthority="orbitfs-license-master-v2";
