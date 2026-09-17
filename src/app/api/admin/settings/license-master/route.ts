import {masterHealth,masterProducts} from "@/lib/master-api";
import {licenseDb} from "@/lib/license-api";
import {requireOrbitDeploymentAdmin} from "@/lib/orbitfs-deployment-auth";

const MASTER_URL="https://panel.incendiarynetworks.cc/api";
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
    const db=licenseDb();
    const started=Date.now();
    const [health,products]=await Promise.all([masterHealth(),masterProducts()]);
    const masterRows=Array.isArray(products?.products)?products.products:[];
    const now=new Date().toISOString();
    const {data:row}=await db.from("license_master_connection").select("id").order("updated_at",{ascending:false}).limit(1).maybeSingle();
    if(row)await db.from("license_master_connection").update({master_url:MASTER_URL,enabled:true,last_tested_at:now,last_success_at:now,last_error:null,updated_at:now}).eq("id",row.id);else await db.from("license_master_connection").insert({master_url:MASTER_URL,enabled:true,last_tested_at:now,last_success_at:now,last_error:null});
    return Response.json({ok:true,latencyMs:Date.now()-started,health,productCount:masterRows.length,products:masterRows},{headers:{"cache-control":"no-store"}});
  }catch(e:any){
    const message=cleanError(e);
    try{const db=licenseDb();const now=new Date().toISOString();const {data:row}=await db.from("license_master_connection").select("id").order("updated_at",{ascending:false}).limit(1).maybeSingle();if(row)await db.from("license_master_connection").update({master_url:MASTER_URL,last_tested_at:now,last_error:message,updated_at:now}).eq("id",row.id);}catch{}
    return Response.json({ok:false,error:message},{status:Number(e?.status)||502,headers:{"cache-control":"no-store"}});
  }
}
