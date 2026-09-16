import {licenseDb} from "@/lib/license-api";
import {masterHealth,masterProducts} from "@/lib/master-api";
import {requireOrbitDeploymentAdmin} from "@/lib/orbitfs-deployment-auth";

const cleanError=(e:any)=>String(e?.message||"License Master connection test failed").slice(0,1000);

export async function GET(req:Request){
  try{
    await requireOrbitDeploymentAdmin(req);
    const {data,error}=await licenseDb().from("license_master_connection").select("id,master_url,enabled,last_tested_at,last_success_at,last_error,updated_at").order("updated_at",{ascending:false}).limit(1).maybeSingle();
    if(error)throw error;
    return Response.json({connection:data||null,configuredUrl:data?.master_url||process.env.MASTER_API_URL||"https://customlicensev1.vercel.app",healthPath:"/api/license/v1/health",licenseIssuePath:"/api/v1/licenses",licenseValidatePath:"/api/v1/licenses/validate",licenseControlPath:"/api/license/{id}/control"},{headers:{"cache-control":"no-store"}});
  }catch(e:any){return Response.json({error:cleanError(e)},{status:Number(e?.status)||502,headers:{"cache-control":"no-store"}})}
}

export async function POST(req:Request){
  try{
    await requireOrbitDeploymentAdmin(req);
    const db=licenseDb();
    const started=Date.now();
    try{
      const [health,products]=await Promise.all([masterHealth(),masterProducts()]);
      const now=new Date().toISOString();
      const {data:row}=await db.from("license_master_connection").select("id").order("updated_at",{ascending:false}).limit(1).maybeSingle();
      if(row)await db.from("license_master_connection").update({master_url:"https://customlicensev1.vercel.app",enabled:true,last_tested_at:now,last_success_at:now,last_error:null,updated_at:now}).eq("id",row.id);
      else await db.from("license_master_connection").insert({master_url:"https://customlicensev1.vercel.app",enabled:true,last_tested_at:now,last_success_at:now,last_error:null});
      return Response.json({ok:true,latencyMs:Date.now()-started,health,productCount:Array.isArray(products?.products)?products.products.length:0},{headers:{"cache-control":"no-store"}});
    }catch(e:any){
      const message=cleanError(e),now=new Date().toISOString();
      const {data:row}=await db.from("license_master_connection").select("id").order("updated_at",{ascending:false}).limit(1).maybeSingle();
      if(row)await db.from("license_master_connection").update({master_url:"https://customlicensev1.vercel.app",last_tested_at:now,last_error:message,updated_at:now}).eq("id",row.id);
      throw Object.assign(new Error(message),{status:502});
    }
  }catch(e:any){return Response.json({ok:false,error:cleanError(e)},{status:Number(e?.status)||502,headers:{"cache-control":"no-store"}})}
}
