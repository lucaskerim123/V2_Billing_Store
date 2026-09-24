import {createClient} from "@supabase/supabase-js";
import {masterLicenses,masterReleases} from "@/lib/master-api";
import {customerReleaseChannels} from "@/lib/orbitfs-release-channels";

export const dynamic="force-dynamic";
const url=()=>String(process.env.NEXT_PUBLIC_SUPABASE_URL||"");
const key=()=>String(process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"");
async function currentUser(req:Request){const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token||!url()||!key())throw Object.assign(new Error("Authentication is unavailable"),{status:401});const sb=createClient(url(),key(),{auth:{persistSession:false,autoRefreshToken:false}});const result=await sb.auth.getUser(token);if(result.error||!result.data?.user)throw Object.assign(new Error("Unauthorized"),{status:401});return result.data.user}
export async function GET(req:Request){
 try{
  const user=await currentUser(req),db=createClient(url(),key(),{auth:{persistSession:false,autoRefreshToken:false}}),q=(p:any)=>Promise.resolve(p).catch(()=>({data:[],error:null}));
  const [customerResult,bindings,connections,installations,settings,masterLicenseResult,channelAccess]=await Promise.all([
   q(db.from("customers").select("id,customer_number,name,email").eq("auth_user_id",user.id).maybeSingle()),
   q(db.from("license_bindings").select("*").eq("auth_user_id",user.id).is("archived_at",null).order("created_at",{ascending:false})),
   q(db.from("orbitfs_provider_connections").select("id,provider,status,provider_account_id,provider_account_name,team_id,scopes,token_expires_at,connected_at,refreshed_at,last_error,metadata").eq("auth_user_id",user.id).order("created_at",{ascending:false})),
   q(db.from("orbitfs_installations").select("*").eq("auth_user_id",user.id).order("created_at",{ascending:false})),
   q(db.from("orbitfs_release_system_settings").select("*").eq("id","primary").maybeSingle()),
   masterLicenses().catch(()=>({licenses:[]})),
   Promise.resolve(["stable"])
  ]);
  const customer=customerResult.data||null;
  const installationRows=installations.data||[],bindingRows=bindings.data||[],masterLicensesRows=masterLicenseResult?.licenses||[];
  const preferredInstall=installationRows.find((x:any)=>String(x.component_key||"")==="orbitfs_base")||installationRows[0]||null;
  const allowedChannels=[...new Set((await customerReleaseChannels(user.id,preferredInstall?.license_binding_id||null).catch(()=>channelAccess||["stable"])).map((x:any)=>String(x)))];
  if(!allowedChannels.length)allowedChannels.push("stable");
  const remoteReleaseResults=await Promise.all(allowedChannels.flatMap((channel:string)=>[masterReleases("orbitfs_base",channel,"base").catch(()=>({releases:[]})),masterReleases("orbitfs_base",channel,"update").catch(()=>({releases:[]}))]));
  const masterReleaseRows=remoteReleaseResults.flatMap((x:any)=>x?.releases||[]);
  const customerNumber=String(customer?.customer_number||"").trim();
  const customerMasterLicenses=customerNumber?masterLicensesRows.filter((x:any)=>String(x.customer_external_id||"").trim()===customerNumber).filter((x:any)=>!["revoked","expired"].includes(String(x.status||"").toLowerCase())):[];
  let connectionRows=(connections.data||[]).map((x:any)=>({...x,metadata:{...(x.metadata||{})}}));
  const enrichedBindings=bindingRows.flatMap((b:any)=>{const remote=customerMasterLicenses.find((x:any)=>String(x.id)===String(b.license_id));return remote?[{...b,remote_state:remote.status||b.remote_state,expires_at:remote.expires_at||b.expires_at,master_license_id:remote.id,license_product_key:b.license_product_key||remote.product||remote.product_code}]:[]});
  for(const remote of customerMasterLicenses){
    if(!enrichedBindings.some((b:any)=>String(b.license_id)===String(remote.id))){
      const product=String(remote.product||remote.product_code||"").toLowerCase();
      enrichedBindings.push({id:`master-${remote.id}`,license_id:remote.id,license_product_key:product,desired_state:remote.status,remote_state:remote.status,license_key_last4:remote.license_key_last4||null,expires_at:remote.expires_at||null,label:product,api_source:"license_master"});
    }
  }
  const base=enrichedBindings.find((b:any)=>b?.license_product_key==="orbitfs_base"||b?.components?.orbitfs_base||b?.components?.orbitfs_panel)||enrichedBindings[0]||null,install=base?installationRows.find((x:any)=>x.license_binding_id===base.id):null;
  if(install?.vercel_project_id)connectionRows=connectionRows.map((x:any)=>x.provider==="vercel"?{...x,team_id:install.vercel_team_id||x.team_id,metadata:{...(x.metadata||{}),team_id:install.vercel_team_id||x.metadata?.team_id||null,team_locked:true}}:x);
  const [eventRows,installReleaseRows]=install?await Promise.all([q(db.from("orbitfs_deployment_events").select("*").eq("installation_id",install.id).order("created_at",{ascending:false}).limit(40)),q(db.from("orbitfs_installation_releases").select("*").eq("installation_id",install.id).order("created_at",{ascending:false}).limit(40))]):[{data:[],error:null},{data:[],error:null}];
  const installHistory=installReleaseRows.data||[];
  if(install){
    const metadata=install.metadata&&typeof install.metadata==="object"?{...install.metadata}:{};
    if(!metadata.appliedUpdate){
      const applied=installHistory.find((row:any)=>String(row.action||"").toLowerCase()==="update"&&String(row.status||"").toLowerCase()==="ready");
      if(applied){
        metadata.appliedUpdate={
          version:String(applied.release_version||""),
          releaseId:String(applied.release_id||""),
          sha256:String(applied.release_sha256||""),
          sourceCommit:String(applied.source_commit||""),
          channel:String(install.release_channel||"stable"),
          components:Array.isArray(applied.components)?applied.components:[],
          appliedAt:String(applied.ready_at||applied.created_at||""),
          panelDeploymentId:String(applied.panel_deployment_id||applied.vercel_deployment_id||""),
          engineDeploymentId:String(applied.engine_deployment_id||"")
        };
      }
    }
    install.metadata=metadata;
  }
  const publishedMaster=[...masterReleaseRows].filter((r:any)=>String(r.status||"")==="published").map((r:any)=>{const m=r.manifest&&typeof r.manifest==="object"?r.manifest:{};return {...r,title:m.title||`OrbitFS ${r.release_type==="base"?"Base":"Update"} ${r.version}`,description:m.description||null,changelog:r.notes||null,customer_notes:m.customer_notes||m.customerNotes||"",severity:m.severity||"normal",required:m.required===true,rollout:m.rollout||"public",minimum_version:m.minimum_version||m.minimumVersion||null,rollback_version:m.rollback_version||m.rollbackVersion||null,components:Array.isArray(m.components)?m.components:[]}});
  const selectedChannel=String(install?.release_channel||allowedChannels[0]||"stable");
  const latestMaster=(type:string)=>publishedMaster.filter((r:any)=>String(r.release_type||"")===type&&String(r.channel||"stable")===selectedChannel).sort((a:any,b:any)=>String(b.published_at||b.publishedAt||"").localeCompare(String(a.published_at||a.publishedAt||""))||String(b.version).localeCompare(String(a.version),undefined,{numeric:true}))[0]||null;
  const latestBase=latestMaster("base"),latestUpdate=latestMaster("update");
  const settingsChannels=allowedChannels;
  const s=settings.data||{};
  return Response.json({customer:{id:customer?.id||null,customer_id:customer?.customer_number||null,customer_number:customer?.customer_number||null,name:customer?.name||null,email:customer?.email||null},settings:{enabled:s.enabled!==false,maintenance_mode:s.maintenance_mode===true,maintenance_message:String(s.maintenance_message||""),customer_deploy_enabled:s.customer_deploy_enabled!==false,customer_updates_enabled:s.customer_updates_enabled!==false,customer_rollbacks_enabled:s.customer_rollbacks_enabled!==false,supabase_oauth_enabled:s.supabase_oauth_enabled!==false,vercel_oauth_enabled:s.vercel_oauth_enabled!==false,allow_existing_supabase_project:s.allow_existing_supabase_project!==false,allow_create_supabase_project:s.allow_create_supabase_project!==false,schema_version:s.schema_version||"1",release_channel:settingsChannels[0]||"stable",release_channels:settingsChannels},bindings:enrichedBindings,connections:connectionRows,installations:installationRows.map((row:any)=>install&&row.id===install.id?install:row),events:eventRows.data||[],releases:installHistory,publishedReleases:publishedMaster,latestRelease:latestUpdate||latestBase,latestBase,latestUpdate,master:{licenses:masterLicensesRows,releases:masterReleaseRows}},{headers:{"cache-control":"no-store"}});
 }catch(e:any){return Response.json({error:e?.message||"Could not load OrbitFS status"},{status:Number(e?.status)||500,headers:{"cache-control":"no-store"}})}
}
