import {masterProducts,masterRequest,masterPulse,masterPulseState} from "@/lib/master-api";
import {licenseDb} from "@/lib/license-api";
import {requireOrbitDeploymentAdmin} from "@/lib/orbitfs-deployment-auth";
import {getMasterApiUrl,normalizeMasterApiUrl} from "@/lib/license-master-config";
const canonicalProducts=["orbitfs_base","orbitfs_mcp","orbitfs_apex","orbitfs_studio"];
const cleanError=(e:any)=>String(e?.message||"License Master connection test failed").slice(0,1000);

async function localMappings(){const {data,error}=await licenseDb().from("products").select("id,name,slug,license_product_key,license_api_url,license_api_mode,license_api_enabled,active").in("license_product_key",canonicalProducts).order("license_product_key");if(error)throw error;return data||[];}
async function localRuntime(){const {data}=await licenseDb().from("license_api_settings").select("*").limit(1).maybeSingle();return data||null;}

export async function GET(req:Request){
 try{
  await requireOrbitDeploymentAdmin(req);
  const db=licenseDb();
  const [{data,error},products,local,pulse,runtime]=await Promise.all([
   db.from("license_master_connection").select("id,master_url,enabled,last_tested_at,last_success_at,last_error,updated_at").order("updated_at",{ascending:false}).limit(1).maybeSingle(),
   masterProducts(),localMappings(),masterPulseState(),localRuntime()
  ]);
  if(error)throw error;
  const rows=Array.isArray(products?.products)?products.products:[];
  const by=new Map(rows.map((p:any)=>[String(p.code||p.slug||"").toLowerCase(),p]));
  const connections=canonicalProducts.map(code=>({code,master:by.get(code)||null,local:local.find((p:any)=>String(p.license_product_key||"").toLowerCase()===code)||null,connected:Boolean(by.get(code)&&local.find((p:any)=>String(p.license_product_key||"").toLowerCase()===code&&p.license_api_mode==="master"&&p.license_api_enabled!==false))}));
  return Response.json({connection:data||null,configuredUrl:data?.master_url||await getMasterApiUrl(),masterPanelUrl:process.env.LICENSE_MASTER_ADMIN_URL||"",connections,masterProducts:rows,pulse,runtimeMirror:runtime},{headers:{"cache-control":"no-store"}});
 }catch(e:any){return Response.json({error:cleanError(e)},{status:Number(e?.status)||502,headers:{"cache-control":"no-store"}})}
}

export async function POST(req:Request){
 try{
  await requireOrbitDeploymentAdmin(req);
  const db=licenseDb(),body=await req.json().catch(()=>({})),action=String(body.action||"test").toLowerCase();
  if(action==="save"){
   const requested=String(body.masterUrl||"").trim(),masterUrl=normalizeMasterApiUrl(requested);
   if(!masterUrl||masterUrl!==requested.replace(/\/$/,""))return Response.json({error:"Invalid License Master API URL. Use an HTTPS /api/v1 endpoint and do not use localhost."},{status:400});
   const now=new Date().toISOString(),{data:row}=await db.from("license_master_connection").select("id").order("updated_at",{ascending:false}).limit(1).maybeSingle();
   if(row)await db.from("license_master_connection").update({master_url:masterUrl,enabled:true,updated_at:now,last_error:null}).eq("id",row.id);else await db.from("license_master_connection").insert({master_url:masterUrl,enabled:true,last_error:null});
   return Response.json({ok:true,configuredUrl:masterUrl},{headers:{"cache-control":"no-store"}});
  }
  if(action==="pulse"){
   const pulse=await masterPulse({action:"pulse",reason:String(body.reason||"billing-store-manual-pulse")});
   return Response.json({ok:true,pulse},{headers:{"cache-control":"no-store"}});
  }
  if(action==="configure"){
   const policy={
    validation_ttl_seconds:Number(body.validation_ttl_seconds),
    offline_grace_seconds:Number(body.offline_grace_seconds),
    pulse_poll_seconds:Number(body.pulse_poll_seconds),
    max_failed_validations:Number(body.max_failed_validations),
    allow_offline_grace:Boolean(body.allow_offline_grace),
   };
   const remote=await masterPulse({action:"configure",...policy});
   const mirror={entitlement_ttl_seconds:remote?.runtime_policy?.validation_ttl_seconds??policy.validation_ttl_seconds,grace_seconds:remote?.runtime_policy?.offline_grace_seconds??policy.offline_grace_seconds,max_failed_validations:remote?.runtime_policy?.max_failed_validations??policy.max_failed_validations,allow_offline_grace:remote?.runtime_policy?.allow_offline_grace??policy.allow_offline_grace,updated_at:new Date().toISOString()};
   const {data:existing}=await db.from("license_api_settings").select("id").limit(1).maybeSingle();
   if(existing?.id)await db.from("license_api_settings").update(mirror).eq("id",existing.id);
   return Response.json({ok:true,pulse:remote},{headers:{"cache-control":"no-store"}});
  }
  const started=Date.now();const configuredUrl=await getMasterApiUrl();const [health,products,pulse]=await Promise.all([masterRequest("/api/v1/license/health",{method:"GET",cache:"no-store"},"billing"),masterProducts(),masterPulseState()]);
  const rows=Array.isArray(products?.products)?products.products:[];if(!rows.some((p:any)=>canonicalProducts.includes(String(p.code||p.slug||"").toLowerCase())))throw new Error("License Master returned no canonical OrbitFS products.");
  const now=new Date().toISOString(),{data:row}=await db.from("license_master_connection").select("id").order("updated_at",{ascending:false}).limit(1).maybeSingle();
  if(row)await db.from("license_master_connection").update({master_url:configuredUrl,enabled:true,last_tested_at:now,last_success_at:now,last_error:null,updated_at:now}).eq("id",row.id);else await db.from("license_master_connection").insert({master_url:configuredUrl,enabled:true,last_tested_at:now,last_success_at:now,last_error:null});
  return Response.json({ok:true,latencyMs:Date.now()-started,health,pulse,productCount:rows.length,products:rows},{headers:{"cache-control":"no-store"}});
 }catch(e:any){const message=cleanError(e);return Response.json({ok:false,error:message},{status:Number(e?.status)||502,headers:{"cache-control":"no-store"}})}
}
