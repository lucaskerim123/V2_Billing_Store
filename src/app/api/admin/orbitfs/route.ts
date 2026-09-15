import {licenseDb} from "@/lib/license-api";
import {httpError,releaseSettings,requireOrbitAdmin} from "@/lib/orbitfs-deployment";

async function bounded<T>(promise:Promise<T>,fallback:T,ms=6000):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([promise,new Promise<T>(resolve=>{timer=setTimeout(()=>resolve(fallback),ms)})])}
  finally{if(timer)clearTimeout(timer)}
}

export async function GET(req:Request){
  try{
    await requireOrbitAdmin(req);
    const db=licenseDb();
    const [inst,profiles,settingsRow,bundles]=await Promise.all([
      bounded(db.from("orbitfs_installations").select("*").order("created_at",{ascending:false}),{data:[],error:null} as any),
      bounded(db.from("user_profiles").select("id,display_name,company_name,email,status"),{data:[],error:null} as any),
      bounded(db.from("orbitfs_release_system_settings").select("*").eq("id","primary").maybeSingle(),{data:null,error:null} as any),
      bounded(db.from("orbitfs_release_bundles").select("id,version,channel,status,title,description,changelog,base_source_commit,engine_source_commit,schema_version,published_at,rollout,components,updated_at").order("updated_at",{ascending:false}).limit(100),{data:[],error:null} as any)
    ]);
    const installations=inst.data||[],profileMap=new Map((profiles.data||[]).map((p:any)=>[p.id,p]));
    const allBundles=bundles.data||[];
    const published=allBundles.filter((r:any)=>r.status==="published");
    const latest=(channel:string)=>published.find((r:any)=>r.channel===channel)||null;
    const s=settingsRow.data||{};
    return Response.json({
      installations:installations.map((i:any)=>({...i,customer:profileMap.get(i.auth_user_id)||null})),
      releases:allBundles,
      latestBase:latest("base"),
      latestUpdate:latest("update"),
      settings:{
        enabled:s.enabled!==false,
        customer_deploy_enabled:s.customer_deploy_enabled!==false,
        customer_updates_enabled:s.customer_updates_enabled!==false,
        customer_rollbacks_enabled:s.customer_rollbacks_enabled!==false
      }
    },{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}
