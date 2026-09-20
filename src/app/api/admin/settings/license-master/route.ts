import {masterHealth,masterProducts} from "@/lib/master-api";
import {licenseDb} from "@/lib/license-api";
import {requireOrbitDeploymentAdmin} from "@/lib/orbitfs-deployment-auth";

const MASTER_URL="https://incendiarynetworks.cc/api";
function validateUrl(value:any){const raw=String(value||"").trim();try{const u=new URL(raw);if(u.protocol!=="https:"||u.pathname!=="/api"||u.search||u.hash||["localhost","127.0.0.1","::1","api.incendiarynetworks.cc"].includes(u.hostname))throw new Error("Use an HTTPS /api License Master endpoint. api.incendiarynetworks.cc is retired.");return u.toString().replace(/\/$/,"")}catch(e:any){throw new Error(e?.message||"Invalid License Master URL")}}
const canonicalProducts=["orbitfs_base","orbitfs_mcp","orbitfs_apex","orbitfs_studio"];
const cleanError=(e:any)=>String(e?.message||"License Master connection test failed").slice(0,1000);

async function localMappings(){
  const db=licenseDb();
  const {data,error}=await db.from("products").select("id,name,slug,license_product_key,license_api_url,license_api_mode,license_api_enabled,active").in("license_product_key",canonicalProducts).order("license_product_key");
  if(error)throw error;
  return data||[];
}

export async function GET(req:Request){
  try{
    await requireOrbitDeploymentAdmin(req);
    const {data,error}=await licenseDb().from("license_master_connection").select("id,master_url,enabled,last_tested_at,last_success_at,last_error,updated_at").order("updated_at",{ascending:false}).limit(1).maybeSingle();
    if(error)throw error;
    const products=await masterProducts();
    const local=await localMappings();
    const masterRows=Array.isArray(products?.products)?products.products:[];
    const masterBySlug=new Map(masterRows.map((p:any)=>[String(p.code||p.slug||"").toLowerCase(),p]));
    const connections=canonicalProducts.map(code=>({code,master:masterBySlug.get(code)||null,local:local.find((p:any)=>String(p.license_product_key||"").toLowerCase()===code)||null,connected:Boolean(masterBySlug.get(code)&&local.find((p:any)=>String(p.license_product_key||"").toLowerCase()===code&&p.license_api_mode==="master"&&p.license_api_enabled!==false))}));
    return Response.json({connection:data||null,configuredUrl:data?.master_url||MASTER_URL,masterPanelUrl:"https://panel.incendiarynetworks.cc",connections,masterProducts:masterRows},{headers:{"cache-control":"no-store"}});
  }catch(e:any){return Response.json({error:cleanError(e)},{status:Number(e?.status)||502,headers:{"cache-control":"no-store"}})}
}

export async function POST(req:Request){
  try{
    await requireOrbitDeploymentAdmin(req);
    const body=await req.json().catch(()=>({}));
    const requestedUrl=body?.action==="save"||body?.url?validateUrl(body?.url):null;
    const db=licenseDb();
    const started=Date.now();
    if(requestedUrl){
      const {data:row}=await db.from("license_master_connection").select("id").order("updated_at",{ascending:false}).limit(1).maybeSingle();
      const patch={master_url:requestedUrl,enabled:true,updated_at:new Date().toISOString()};
      const write=row?await db.from("license_master_connection").update(patch).eq("id",row.id):await db.from("license_master_connection").insert({...patch});
      if(write.error)throw write.error;
    }
    const [health,products]=await Promise.all([masterHealth(),masterProducts()]);
    const masterRows=Array.isArray(products?.products)?products.products:[];
    const now=new Date().toISOString();
    const {data:row}=await db.from("license_master_connection").select("id").order("updated_at",{ascending:false}).limit(1).maybeSingle();
    const configuredUrl=requestedUrl||validateUrl((await db.from("license_master_connection").select("master_url").order("updated_at",{ascending:false}).limit(1).maybeSingle()).data?.master_url||MASTER_URL);
if(row)await db.from("license_master_connection").update({master_url:configuredUrl,enabled:true,last_tested_at:now,last_success_at:now,last_error:null,updated_at:now}).eq("id",row.id);else await db.from("license_master_connection").insert({master_url:configuredUrl,enabled:true,last_tested_at:now,last_success_at:now,last_error:null});

    return Response.json({ok:true,configuredUrl,latencyMs:Date.now()-started,health,productCount:masterRows.length,products:masterRows},{headers:{"cache-control":"no-store"}});
  }catch(e:any){
    const message=cleanError(e);
    try{const db=licenseDb();const now=new Date().toISOString();const {data:row}=await db.from("license_master_connection").select("id").order("updated_at",{ascending:false}).limit(1).maybeSingle();if(row)await db.from("license_master_connection").update({last_tested_at:now,last_error:message,updated_at:now}).eq("id",row.id);}catch{}
    return Response.json({ok:false,error:message},{status:Number(e?.status)||502,headers:{"cache-control":"no-store"}});
  }
}
