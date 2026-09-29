import {getMasterApiConnection,getMasterApiUrl} from "@/lib/license-master-config";

async function configuredMasterApiBase(){return getMasterApiUrl();}

const timeoutMs=()=>Math.max(1000,Number(process.env.MASTER_API_TIMEOUT_MS||10000));
const getCacheSeconds=()=>Math.min(300,Math.max(0,Number(process.env.MASTER_API_CACHE_SECONDS||30)));
type MasterRole="billing"|"deployer";
const token=(role:MasterRole="billing")=>String(role==="deployer"?process.env.DEPLOYER_API_TOKEN||"":process.env.BILLING_API_TOKEN||"").trim();
function requireConfig(role:MasterRole="billing"){const value=token(role);const variable=role==="deployer"?"DEPLOYER_API_TOKEN":"BILLING_API_TOKEN";if(!value)throw new Error(`License Master API token is not configured (set ${variable})`);return {value};}
function masterPath(path:string){const clean=path.startsWith("/")?path:`/${path}`;return clean.startsWith("/api/v1/")?clean.slice(7):clean.startsWith("/api/")?clean.slice(4):clean;}
function isInfrastructureStatus(status:number){return [500,502,503,504].includes(status);}
function fallbackEligible(method:string){return method==="GET"||method==="HEAD";}
function fallbackBody(value:any){return value?.fallback===true&&String(value?.mode||"").toLowerCase()==="limp"&&value?.restricted===true;}
async function fetchWithTimeout(url:string,init:RequestInit,role:MasterRole="billing"){
  const cfg=requireConfig(role);
  const headers=new Headers(init.headers);
  headers.set("authorization",`Bearer ${cfg.value}`);
  const controller=init.signal?null:new AbortController();
  const timer=controller?setTimeout(()=>controller.abort(),timeoutMs()):null;
  try{return await fetch(url,{...init,headers,signal:init.signal||controller?.signal});}
  catch(error){
    if(error instanceof Error&&error.name==="AbortError")throw Object.assign(new Error(`License Master request timed out after ${timeoutMs()}ms`),{status:503,code:"LICENSE_MASTER_TIMEOUT",transport:true});
    throw Object.assign(new Error(`License Master connection failed: ${error instanceof Error?error.message:String(error)}`),{status:503,code:"LICENSE_MASTER_TRANSPORT_ERROR",transport:true});
  }finally{if(timer)clearTimeout(timer);}
}
async function decodeResponse(response:Response){
  const text=await response.text();
  let data:any={};
  try{data=text?JSON.parse(text):{};}catch{data={error:text||"License Master returned an invalid response"};}
  return {data,text};
}
function responseError(response:Response,data:any){
  const code=String(data?.code||"").trim();
  const message=String(data?.error||data?.message||code||`License Master request failed (${response.status})`);
  return Object.assign(new Error(code&&message!==code?`${message} (${code})`:message),{status:response.status,code:code||undefined});
}

export async function masterRequest(path:string,init:RequestInit={},role:MasterRole="billing"){
  const headers=new Headers(init.headers);
  if(!headers.has("content-type")&&init.body)headers.set("content-type","application/json");
  const method=String(init.method||"GET").toUpperCase();
  const fetchInit:RequestInit={...init,headers};
  if(method==="GET"&&getCacheSeconds()>0&&fetchInit.cache!=="no-store")(fetchInit as any).next={revalidate:getCacheSeconds()};
  else fetchInit.cache="no-store";

  const connection=await getMasterApiConnection();
  const suffix=masterPath(path);
  let primaryFailure:any=null;
  try{
    const response=await fetchWithTimeout(`${connection.primaryUrl}${suffix}`,fetchInit,role);
    const {data}=await decodeResponse(response);
    if(response.ok){
      if(fallbackBody(data))throw Object.assign(new Error("Primary License Manager returned fallback mode unexpectedly"),{status:503,code:"PRIMARY_AUTHORITY_INVALID",transport:true});
      return {...data,_authority_transport:{mode:"primary",primary_url:connection.primaryUrl}};
    }
    if(!isInfrastructureStatus(response.status))throw responseError(response,data);
    primaryFailure=responseError(response,data);
  }catch(error:any){
    if(Number(error?.status||0)>=400&&Number(error?.status||0)<500&&!error?.transport)throw error;
    primaryFailure=error;
  }

  if(!connection.failoverEnabled||!connection.fallbackUrl||!fallbackEligible(method)){
    throw Object.assign(new Error("License Manager authority is unavailable. This operation requires the primary authority."),{
      status:503,code:"LICENSE_AUTHORITY_UNAVAILABLE",primaryError:String(primaryFailure?.message||primaryFailure||"unavailable"),fallback:false
    });
  }

  try{
    const response=await fetchWithTimeout(`${connection.fallbackUrl}${suffix}`,{...fetchInit,cache:"no-store"},role);
    const {data}=await decodeResponse(response);
    if(fallbackBody(data)){
      return {...data,fallback:true,mode:"limp",restricted:true,_authority_transport:{
        mode:"fallback",primary_url:connection.primaryUrl,fallback_url:connection.fallbackUrl,
        primary_error:String(primaryFailure?.message||primaryFailure||"unavailable")
      }};
    }
    throw responseError(response,data);
  }catch(error:any){
    throw Object.assign(new Error("License Manager and the registered limp-mode fallback are unavailable."),{
      status:503,code:"LICENSE_AUTHORITY_UNAVAILABLE",primaryError:String(primaryFailure?.message||primaryFailure||"unavailable"),
      fallbackError:String(error?.message||error||"unavailable"),fallback:true
    });
  }
}

export async function masterProducts(role:MasterRole="billing"){
  return masterRequest("/api/v1/products",{method:"GET"},role);
}
export async function masterLicenses(role:MasterRole="billing"){
  return masterRequest("/api/v1/license",{method:"GET",cache:"no-store"},role);
}
export async function masterReleases(product="orbitfs_base",channel="all",releaseType="all",role:MasterRole="billing",fresh=false){
  const qs=new URLSearchParams();
  const p=String(product||"").trim().toLowerCase();
  const c=String(channel||"").trim().toLowerCase();
  const t=String(releaseType||"").trim().toLowerCase();
  if(p&&p!=="all")qs.set("product",p);
  if(c&&c!=="all")qs.set("channel",c);
  if(t&&t!=="all")qs.set("type",t);
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
export async function masterDownloadReleaseArtifact(id:string){const base=(await getMasterApiConnection()).primaryUrl;const response=await fetchWithTimeout(`${base}${masterPath(`/api/v1/releases/${encodeURIComponent(id)}/artifact`)}`,{method:"GET",cache:"no-store"},"deployer");if(!response.ok){const text=await response.text();let data:any={};try{data=text?JSON.parse(text):{};}catch{}const code=String(data?.code||data?.error||"ARTIFACT_DOWNLOAD_FAILED"),detail=String(data?.message||data?.detail||data?.error||text||"").trim();throw Object.assign(new Error(`License Master artifact download failed for release ${id} (${response.status}, ${code})${detail&&detail!==code?`: ${detail}`:""}`),{status:response.status,code});}return{bytes:Buffer.from(await response.arrayBuffer()),contentType:response.headers.get("content-type")||"application/octet-stream",contentDisposition:response.headers.get("content-disposition")||null};}
export async function masterExecuteDeployment(input:any){return masterRequest("/api/v1/deployer",{method:"POST",body:JSON.stringify({...input,phase:input.phase||"authorize"})},"deployer");}
export async function masterInstallationLifecycle(input:any){return masterRequest("/api/v1/installations/lifecycle",{method:"POST",body:JSON.stringify(input)},"deployer");}
export const licensingAuthority="orbitfs-license-master-v2";
