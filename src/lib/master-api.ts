import {licenseDb} from "@/lib/license-api";

const DEFAULT_MASTER_API_BASE = "https://incendiarynetworks.cc/api";

function assertMasterApiUrl(value: string) {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.search || u.hash || u.pathname.replace(/\/+$/, "") !== "/api") {
    throw new Error("License Master API URL must be an HTTPS /api endpoint");
  }
  if (u.hostname.toLowerCase() !== "incendiarynetworks.cc") {
    throw new Error("Only the canonical License Master API host is supported");
  }
}

async function configuredMasterApiBase() {
  try {
    const {data} = await licenseDb().from("license_master_connection")
      .select("master_url,enabled").order("updated_at",{ascending:false}).limit(1).maybeSingle();
    if (data?.enabled !== false && data?.master_url) {
      const value=String(data.master_url).trim().replace(/\/+$/,"");
      assertMasterApiUrl(value);
      return value;
    }
  } catch {}
  assertMasterApiUrl(DEFAULT_MASTER_API_BASE);
  return DEFAULT_MASTER_API_BASE;
}

const timeoutMs=()=>Math.max(1000,Number(process.env.MASTER_API_TIMEOUT_MS||10000));
const getCacheSeconds=()=>Math.min(300,Math.max(0,Number(process.env.MASTER_API_CACHE_SECONDS||30)));
type MasterRole="billing"|"deployer";
const token=(role:MasterRole="billing")=>String(role==="deployer"?process.env.DEPLOYER_API_TOKEN||"":process.env.BILLING_API_TOKEN||"").trim();
function requireConfig(role:MasterRole="billing"){const value=token(role);const variable=role==="deployer"?"DEPLOYER_API_TOKEN":"BILLING_API_TOKEN";if(!value)throw new Error(`License Master API token is not configured (set ${variable})`);return {value};}
function masterPath(path:string){const clean=path.startsWith("/")?path:`/${path}`;return clean.startsWith("/api/")?clean.slice(4):`/v1${clean}`;}
async function fetchWithTimeout(url:string,init:RequestInit,role:MasterRole="billing"){const cfg=requireConfig(role);const headers=new Headers(init.headers);headers.set("authorization",`Bearer ${cfg.value}`);const controller=init.signal?null:new AbortController();const timer=controller?setTimeout(()=>controller.abort(),timeoutMs()):null;try{return await fetch(url,{...init,headers,signal:init.signal||controller?.signal});}catch(error){if(error instanceof Error&&error.name==="AbortError")throw new Error(`License Master request timed out after ${timeoutMs()}ms`);throw new Error(`License Master connection failed: ${error instanceof Error?error.message:String(error)}`);}finally{if(timer)clearTimeout(timer);}}
export async function masterRequest(path:string,init:RequestInit={},role:MasterRole="billing"){const headers=new Headers(init.headers);if(!headers.has("content-type")&&init.body)headers.set("content-type","application/json");const method=String(init.method||"GET").toUpperCase();const fetchInit:RequestInit={...init,headers};if(method==="GET"&&getCacheSeconds()>0&&fetchInit.cache!=="no-store")(fetchInit as any).next={revalidate:getCacheSeconds()};else fetchInit.cache="no-store";const base=await configuredMasterApiBase();const response=await fetchWithTimeout(`${base}${masterPath(path)}`,fetchInit,role);const text=await response.text();let data:any={};try{data=text?JSON.parse(text):{};}catch{data={error:text||"License Master returned an invalid response"};}if(!response.ok)throw Object.assign(new Error(data?.error||`License Master request failed (${response.status})`),{status:response.status,code:data?.code});return data;}
export const masterProducts=()=>masterRequest("/api/v1/products",{method:"GET"});
export const masterLicenses=()=>masterRequest("/api/v1/license",{method:"GET",cache:"no-store"});
export const masterReleases=(product="orbitfs_base",channel="stable",type="base",role:MasterRole="billing")=>masterRequest(`/api/v1/releases?product=${encodeURIComponent(product)}&channel=${encodeURIComponent(channel)}&type=${encodeURIComponent(type)}`,{method:"GET"},role);
const ALLOWED_PRODUCTS=new Set(["orbitfs_base","orbitfs_mcp","orbitfs_apex","orbitfs_studio"]);
export async function masterLicenseValidate(input:any){const product=String(input.product||input.product_code||"orbitfs_base").trim().toLowerCase();const licenseKey=String(input.licenseKey||input.license_key||"").trim();if(!ALLOWED_PRODUCTS.has(product))throw Object.assign(new Error("Unsupported OrbitFS license product"),{status:400,code:"UNSUPPORTED_PRODUCT"});if(!licenseKey)throw Object.assign(new Error("License key is required"),{status:400,code:"LICENSE_KEY_REQUIRED"});const base="https://incendiarynetworks.cc/api/v1/license";const response=await fetch(base+"/validate",{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},cache:"no-store",body:JSON.stringify({license_key:licenseKey,installation_id:input.installationId||input.installation_id,product,component:product,product_version:input.productVersion||input.product_version||input.appVersion||undefined,metadata:input.metadata&&typeof input.metadata==="object"?input.metadata:{}})});const data=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(data?.error||data?.code||"License validation failed"),{status:response.status,code:data?.code});return data;}
export const masterValidate=masterLicenseValidate;
export async function masterIssue(input:any){return masterRequest("/api/v1/license",{method:"POST",headers:{"x-orbitfs-order-ref":String(input.external_reference||input.orderRef||"")},body:JSON.stringify({product:input.product||input.product_code||input.productCode||"orbitfs_base",customer_external_id:input.customer_external_id||input.customerRef||null,external_reference:input.external_reference||input.orderRef||null,expires_at:input.expires_at||input.expiresAt||null,components:input.components||null,max_installations:input.max_installations||input.maxInstallations||null,metadata:input.metadata&&typeof input.metadata==="object"?input.metadata:{}})},"billing");}
export async function masterControl(id:string,input:any){const action=String(input?.action||"").toLowerCase();return masterRequest(`/api/v1/license/${encodeURIComponent(id)}/control`,{method:"POST",body:JSON.stringify({...input,action,actorRef:input?.actorRef||"billing_store"})},"billing");}
export async function masterCreateRelease(input:any){return masterRequest("/api/v1/releases",{method:"POST",body:JSON.stringify({...input,product:input.product||input.product_code||"orbitfs_base",release_type:input.release_type||"base"})},"billing");}
export async function masterUpdateRelease(id:string,input:any){return masterRequest(`/api/v1/releases/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify(input)},"billing");}
export async function masterPublishRelease(id:string){return masterRequest(`/api/v1/releases/${encodeURIComponent(id)}`,{method:"POST",body:JSON.stringify({action:"publish"})},"billing");}
export async function masterPromoteRelease(id:string,targetChannel:string){return masterRequest(`/api/v1/releases/${encodeURIComponent(id)}`,{method:"POST",body:JSON.stringify({action:"promote",target_channel:String(targetChannel).trim().toLowerCase()})},"billing");}
export async function masterValidateRelease(id:string){return masterRequest(`/api/v1/releases/${encodeURIComponent(id)}/validate`,{method:"POST"},"billing");}
export async function masterControlRelease(id:string,status:string){const action=status==="paused"?"disable":status==="withdrawn"?"withdraw":status;return masterRequest(`/api/v1/releases/${encodeURIComponent(id)}`,{method:"POST",body:JSON.stringify({action})},"billing");}
export async function masterDownloadReleaseArtifact(id:string){const base=await configuredMasterApiBase();const response=await fetchWithTimeout(`${base}${masterPath(`/api/v1/releases/${encodeURIComponent(id)}/artifact`)}`,{method:"GET",cache:"no-store"},"deployer");if(!response.ok){const text=await response.text();let data:any={};try{data=text?JSON.parse(text):{};}catch{}throw Object.assign(new Error(data?.error||`License Master artifact download failed (${response.status})`),{status:response.status,code:data?.code});}return{bytes:Buffer.from(await response.arrayBuffer()),contentType:response.headers.get("content-type")||"application/octet-stream",contentDisposition:response.headers.get("content-disposition")||null};}
export async function masterExecuteDeployment(input:any){return masterRequest("/api/v1/deployer",{method:"POST",body:JSON.stringify({...input,phase:input.phase||"authorize"})},"deployer");}
export async function masterSyncDeployment(input:any){return masterRequest("/api/v1/deployer",{method:"POST",body:JSON.stringify({...input,phase:"sync"})},"deployer");}
export const licensingAuthority="orbitfs-license-master-v2";
