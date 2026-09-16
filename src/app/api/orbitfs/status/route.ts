import {createClient} from "@supabase/supabase-js";
import {masterLicenses,masterReleases} from "@/lib/master-api";

export const dynamic="force-dynamic";

const url=()=>String(process.env.NEXT_PUBLIC_SUPABASE_URL||"");
const key=()=>String(process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"");

async function currentUser(req:Request){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token||!url()||!key())throw Object.assign(new Error("Authentication is unavailable"),{status:401});
  const sb=createClient(url(),key(),{auth:{persistSession:false,autoRefreshToken:false}});
  const result=await sb.auth.getUser(token);
  if(result.error||!result.data?.user)throw Object.assign(new Error("Unauthorized"),{status:401});
  return result.data.user;
}

export async function GET(req:Request){
  try{
    const user=await currentUser(req);
    const db=createClient(url(),key(),{auth:{persistSession:false,autoRefreshToken:false}});
    const q=(p:any)=>Promise.resolve(p).catch(()=>({data:[],error:null}));
    const [bindings,connections,installations,settings,bundles,masterLicenseResult,masterReleaseResult]=await Promise.all([
      q(db.from("license_bindings").select("*").eq("auth_user_id",user.id).is("archived_at",null).order("created_at",{ascending:false})),
      q(db.from("orbitfs_provider_connections").select("id,provider,status,provider_account_id,provider_account_name,team_id,scopes,token_expires_at,connected_at,refreshed_at,last_error,metadata").eq("auth_user_id",user.id).order("created_at",{ascending:false})),
      q(db.from("orbitfs_installations").select("*").eq("auth_user_id",user.id).order("created_at",{ascending:false})),
      q(db.from("orbitfs_release_system_settings").select("*").eq("id","primary").maybeSingle()),
      q(db.from("orbitfs_release_bundles").select("id,version,channel,status,title,description,changelog,customer_notes,severity,required,rollout,minimum_version,rollback_version,schema_version,checkpoint_required,components,published_at,updated_at").eq("status","published").order("published_at",{ascending:false}).limit(50)),
      masterLicenses().catch(()=>({licenses:[]})),
      masterReleases().catch(()=>({releases:[]}))
    ]);
    const installationRows=installations.data||[],bindingRows=bindings.data||[];
    let connectionRows=(connections.data||[]).map((x:any)=>({...x,metadata:{...(x.metadata||{})}}));
    const masterLicensesRows=masterLicenseResult?.licenses||[],masterReleaseRows=masterReleaseResult?.releases||[];
    const enrichedBindings=bindingRows.map((b:any)=>{
      const remote=masterLicensesRows.find((x:any)=>String(x.id)===String(b.license_id));
      return remote?{...b,remote_state:remote.status||b.remote_state,remote_expires_at:remote.expires_at||b.remote_expires_at,master_license_id:remote.id}:{...b};
    });
    const base=enrichedBindings.find((b:any)=>b?.license_product_key==="orbitfs_base"||b?.components?.orbitfs_base||b?.components?.orbitfs_panel)||enrichedBindings[0]||null;
    const install=base?installationRows.find((x:any)=>x.license_binding_id===base.id):null;
    if(install?.vercel_project_id)connectionRows=connectionRows.map((x:any)=>x.provider==="vercel"?{...x,team_id:install.vercel_team_id||x.team_id,metadata:{...(x.metadata||{}),team_id:install.vercel_team_id||x.metadata?.team_id||null,team_locked:true}}:x);
    const [eventRows,installReleaseRows]=install?await Promise.all([
      q(db.from("orbitfs_deployment_events").select("*").eq("installation_id",install.id).order("created_at",{ascending:false}).limit(40)),
      q(db.from("orbitfs_installation_releases").select("*").eq("installation_id",install.id).order("created_at",{ascending:false}).limit(40))
    ]):[{data:[],error:null},{data:[],error:null}];
    const localBundles=bundles.data||[],latestBase=localBundles.find((r:any)=>r.channel==="base")||masterReleaseRows.find((r:any)=>String(r.release_type||"")==="base"&&String(r.status||"")==="published")||null,latestUpdate=localBundles.find((r:any)=>r.channel==="update")||masterReleaseRows.find((r:any)=>String(r.release_type||"")==="update"&&String(r.status||"")==="published")||null;
    const s=settings.data||{};
    return Response.json({
      settings:{enabled:s.enabled!==false,customer_deploy_enabled:s.customer_deploy_enabled!==false,customer_updates_enabled:s.customer_updates_enabled!==false,customer_rollbacks_enabled:s.customer_rollbacks_enabled!==false,supabase_oauth_enabled:s.supabase_oauth_enabled!==false,vercel_oauth_enabled:s.vercel_oauth_enabled!==false,allow_existing_supabase_project:s.allow_existing_supabase_project!==false,allow_create_supabase_project:s.allow_create_supabase_project!==false,schema_version:s.schema_version||"1",release_channel:s.release_channel||"stable"},
      bindings:enrichedBindings,connections:connectionRows,installations:installationRows,events:eventRows.data||[],releases:installReleaseRows.data||[],latestRelease:latestUpdate||latestBase,latestBase,latestUpdate,
      master:{licenses:masterLicensesRows,releases:masterReleaseRows}
    },{headers:{"cache-control":"no-store"}});
  }catch(e:any){return Response.json({error:e?.message||"Could not load OrbitFS status"},{status:Number(e?.status)||500,headers:{"cache-control":"no-store"}})}
}
