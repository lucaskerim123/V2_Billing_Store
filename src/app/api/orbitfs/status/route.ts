import {getLicenseMasterAvailability} from "@/lib/license-master-availability";
import {createClient} from "@supabase/supabase-js";
import {masterLicenses,masterReleases} from "@/lib/master-api";
import {customerReleaseChannels} from "@/lib/orbitfs-release-channels";

export const dynamic="force-dynamic";
const url=()=>String(process.env.NEXT_PUBLIC_SUPABASE_URL||"");
const key=()=>String(process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"");
function versionParts(value:unknown){const m=String(value||"").trim().match(/^(\d+)\.(\d+)\.(\d+)/);return m?[Number(m[1]),Number(m[2]),Number(m[3])]:null}
function compareVersions(a:unknown,b:unknown){const av=versionParts(a),bv=versionParts(b);if(!av||!bv)return null;return av[0]-bv[0]||av[1]-bv[1]||av[2]-bv[2]}

async function currentUser(req:Request){const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token||!url()||!key())throw Object.assign(new Error("Authentication is unavailable"),{status:401});const sb=createClient(url(),key(),{auth:{persistSession:false,autoRefreshToken:false}});const result=await sb.auth.getUser(token);if(result.error||!result.data?.user)throw Object.assign(new Error("Unauthorized"),{status:401});return {user:result.data.user,token}}
export async function GET(req:Request){
 try{
  const auth=await currentUser(req),user=auth.user,db=createClient(url(),key(),{auth:{persistSession:false,autoRefreshToken:false}}),q=(p:any)=>Promise.resolve(p).catch((error:any)=>({data:[],error:{message:error?.message||String(error)}}));
  const [customerResult,bindings,connections,installations,settings,masterLicenseResult,channelAccess,masterAvailability]=await Promise.all([
   q(db.from("customers").select("id,customer_number,name,email").eq("auth_user_id",user.id).maybeSingle()),
   q(db.from("license_bindings").select("*").eq("auth_user_id",user.id).is("archived_at",null).order("created_at",{ascending:false})),
   q(db.from("orbitfs_provider_connections").select("id,provider,status,provider_account_id,provider_account_name,team_id,scopes,token_expires_at,connected_at,refreshed_at,last_error,metadata").eq("auth_user_id",user.id).order("updated_at",{ascending:false})),
   q(db.from("orbitfs_installations").select("*").eq("auth_user_id",user.id).order("created_at",{ascending:false})),
   q(db.from("orbitfs_release_system_settings").select("*").eq("id","primary").maybeSingle()),
   masterLicenses().catch(()=>({licenses:[]})),
   Promise.resolve(["stable"]),
   getLicenseMasterAvailability()
  ]);
  for(const [label,result] of [["customer",customerResult],["license bindings",bindings],["provider connections",connections],["installations",installations],["release settings",settings]] as const){
    if((result as any)?.error)throw Object.assign(new Error(`Could not load ${label}: ${(result as any).error.message||"database error"}`),{status:500});
  }
  const customer=customerResult.data||null;
  const installationRows=installations.data||[],bindingRows=bindings.data||[],masterLicensesRows=masterLicenseResult?.licenses||[];
  const preferredInstall=installationRows.find((x:any)=>String(x.component_key||"")==="orbitfs_base")||installationRows[0]||null;
  const allowedChannels=[...new Set((await customerReleaseChannels(user.id,preferredInstall?.license_binding_id||null).catch(()=>channelAccess||["stable"])).map((x:any)=>String(x)))];
  if(!allowedChannels.length)allowedChannels.push("stable");
  const releaseTypes=preferredInstall?.release_version?["base","update"]:["base"];
  const remoteReleaseResults=await Promise.all(allowedChannels.flatMap((channel:string)=>releaseTypes.map((type:string)=>masterReleases("orbitfs_base",channel,type).then((value:any)=>({ok:true,value})).catch((error:any)=>({ok:false,value:{releases:[]},error:String(error?.message||error)})))));
  const releaseDiscoveryAvailable=remoteReleaseResults.every((x:any)=>x.ok===true)&&masterAvailability.reachable===true&&masterAvailability.releaseAuthorityAvailable===true;
  const masterReleaseRows=remoteReleaseResults.flatMap((x:any)=>x?.value?.releases||[]);
  const customerNumber=String(customer?.customer_number||"").trim();
  const customerMasterLicenses=customerNumber?masterLicensesRows.filter((x:any)=>String(x.customer_external_id||"").trim()===customerNumber).filter((x:any)=>!["revoked","expired"].includes(String(x.status||"").toLowerCase())):[];
  let connectionRows=(connections.data||[]).map((x:any)=>({...x,metadata:{...(x.metadata||{})}}));
  const enrichedBindings=bindingRows.flatMap((b:any)=>{
    const remote=customerMasterLicenses.find((x:any)=>String(x.id)===String(b.license_id));
    if(!remote)return [];
    const product=String(b.license_product_key||remote.product||remote.product_code||"").toLowerCase();
    return [{
      id:b.id,
      license_id:remote.id,
      license_product_key:product,
      label:b.label||remote.product_name||product,
      license_key_last4:remote.license_key_last4||b.license_key_last4||null,
      authoritative_status:String(remote.status||"unknown"),
      authoritative_expires_at:remote.expires_at||null,
      status:String(remote.status||"unknown"),
      expires_at:remote.expires_at||null,
      components:remote.components||{},
      activations:Array.isArray(remote.activations)?remote.activations:[],
      api_source:"license_master",
      linked_order_id:b.order_id||null,
      linked_order_item_id:b.order_item_id||null
    }];
  });
  for(const remote of customerMasterLicenses){
    if(!enrichedBindings.some((b:any)=>String(b.license_id)===String(remote.id))){
      const product=String(remote.product||remote.product_code||"").toLowerCase();
      enrichedBindings.push({
        id:`master-${remote.id}`,
        license_id:remote.id,
        license_product_key:product,
        label:remote.product_name||product,
        license_key_last4:remote.license_key_last4||null,
        authoritative_status:String(remote.status||"unknown"),
        authoritative_expires_at:remote.expires_at||null,
        status:String(remote.status||"unknown"),
        expires_at:remote.expires_at||null,
        components:remote.components||{},
        activations:Array.isArray(remote.activations)?remote.activations:[],
        api_source:"license_master"
      });
    }
  }
  const base=enrichedBindings.find((b:any)=>b?.license_product_key==="orbitfs_base"||b?.components?.orbitfs_base||b?.components?.orbitfs_panel)||enrichedBindings[0]||null,install=base?installationRows.find((x:any)=>x.license_binding_id===base.id):null;
  if(install?.vercel_project_id)connectionRows=connectionRows.map((x:any)=>x.provider==="vercel"?{...x,team_id:install.vercel_team_id||x.team_id,metadata:{...(x.metadata||{}),team_id:install.vercel_team_id||x.metadata?.team_id||null,team_locked:true}}:x);
  const [eventRows,installReleaseRows,lifecycleRows,operationRows]=install?await Promise.all([
    q(db.from("orbitfs_deployment_events").select("*").eq("installation_id",install.id).order("created_at",{ascending:false}).limit(40)),
    q(db.from("orbitfs_installation_releases").select("*").eq("installation_id",install.id).order("created_at",{ascending:false}).limit(40)),
    q(db.from("orbitfs_lifecycle_jobs").select("*").eq("installation_id",install.id).order("created_at",{ascending:false}).limit(20)),
    q(db.from("orbitfs_deployment_operations").select("*").eq("installation_id",install.id).order("created_at",{ascending:false}).limit(10))
  ]):[{data:[],error:null},{data:[],error:null},{data:[],error:null},{data:[],error:null}];
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
  const baseIds=masterReleaseRows.filter((r:any)=>String(r.release_type||"")==="base").map((r:any)=>String(r.id));
  let presentationOverrides:any[]=[];
  if(baseIds.length){const result=await q(db.from("orbitfs_release_presentation_overrides").select("*").in("release_id",baseIds));presentationOverrides=result.data||[];}
  const presentationMap=new Map(presentationOverrides.map((o:any)=>[String(o.release_id),o]));
  const publishedMaster=[...masterReleaseRows].filter((r:any)=>String(r.status||"")==="published").map((r:any)=>{const m=r.manifest&&typeof r.manifest==="object"?r.manifest:{},o=String(r.release_type||"")==="base"?presentationMap.get(String(r.id)):null;return {...r,title:o?.title??m.title??`OrbitFS ${r.release_type==="base"?"Base":"Update"} ${r.version}`,description:o?.description??m.description??null,changelog:o?.changelog??r.notes??null,customer_notes:o?.customer_notes??m.customer_notes??m.customerNotes??"",severity:m.severity||"normal",required:m.required===true,rollout:m.rollout||"public",minimum_version:m.minimum_version||m.minimumVersion||null,rollback_version:m.rollback_version||m.rollbackVersion||null,components:Array.isArray(m.components)?m.components:[]}});
  const selectedChannel=String(install?.release_channel||allowedChannels[0]||"stable");
  const latestMaster=(type:string)=>publishedMaster.filter((r:any)=>String(r.release_type||"")===type&&String(r.channel||"stable")===selectedChannel).sort((a:any,b:any)=>String(b.published_at||b.publishedAt||"").localeCompare(String(a.published_at||a.publishedAt||""))||String(b.version).localeCompare(String(a.version),undefined,{numeric:true}))[0]||null;
  const latestBase=latestMaster("base"),latestUpdate=latestMaster("update");
  const baseComparison=install?.release_version&&latestBase?.version?compareVersions(latestBase.version,install.release_version):null;
  const baseUpdateAvailable=Boolean(releaseDiscoveryAvailable&&install?.vercel_project_id&&install?.release_id&&latestBase?.id&&String(latestBase.id)!==String(install.release_id)&&baseComparison!==null&&baseComparison>0);
  const baseUpdateStatus=!releaseDiscoveryAvailable?"authority_unavailable":!install?.release_version?"not_installed":!latestBase?"no_published_release":baseUpdateAvailable?"update_available":"current";
  const activeOperation=(operationRows.data||[]).find((row:any)=>["requested","authorising","validated","deploying","migrating","verifying","promoting"].includes(String(row.state||"")))||null;
  const settingsChannels=allowedChannels;
  const s=settings.data||{},authority=masterAvailability.authority||{};
  const billingEnabled=s.enabled!==false,billingMaintenance=s.maintenance_mode===true;
  const maintenanceMode=billingMaintenance||authority.maintenance_mode===true;
  const maintenanceMessage=billingMaintenance?String(s.maintenance_message||"OrbitFS deployment maintenance is active."):String(masterAvailability.notice||"");
  return Response.json({lastCheckedAt:new Date().toISOString(),customer:{id:customer?.id||null,customer_id:customer?.customer_number||null,customer_number:customer?.customer_number||null,name:customer?.name||null,email:customer?.email||null},settings:{enabled:billingEnabled&&masterAvailability.reachable===true&&authority.system_enabled!==false,maintenance_mode:maintenanceMode,maintenance_message:maintenanceMessage,license_authority_available:masterAvailability.reachable===true&&masterAvailability.restricted!==true,release_authority_available:masterAvailability.releaseAuthorityAvailable===true,deployment_authority_available:masterAvailability.deploymentAuthorityAvailable===true,license_authority_reason:String(masterAvailability.reason||"unknown"),license_authority_notice:String(masterAvailability.notice||""),customer_deploy_enabled:billingEnabled&&!billingMaintenance&&s.customer_deploy_enabled!==false&&masterAvailability.baseDeploymentAvailable===true,customer_base_updates_enabled:billingEnabled&&!billingMaintenance&&s.customer_deploy_enabled!==false&&s.customer_updates_enabled!==false&&masterAvailability.baseDeploymentAvailable===true,customer_updates_enabled:billingEnabled&&!billingMaintenance&&s.customer_updates_enabled!==false&&masterAvailability.updateDeploymentAvailable===true,customer_rollbacks_enabled:billingEnabled&&!billingMaintenance&&s.customer_rollbacks_enabled!==false&&masterAvailability.rollbackAvailable===true,customer_self_unlock_enabled:masterLicenseResult?.customer_self_unlock_enabled!==false,supabase_oauth_enabled:s.supabase_oauth_enabled!==false,vercel_oauth_enabled:s.vercel_oauth_enabled!==false,allow_existing_supabase_project:s.allow_existing_supabase_project!==false,allow_create_supabase_project:s.allow_create_supabase_project!==false,schema_version:s.schema_version||"1",release_channel:settingsChannels[0]||"stable",release_channels:settingsChannels,authority_source:"license_manager+billing_store"},bindings:enrichedBindings,connections:connectionRows,installations:installationRows.map((row:any)=>install&&row.id===install.id?install:row),events:eventRows.data||[],lifecycleJobs:lifecycleRows.data||[],releases:installHistory,publishedReleases:publishedMaster,latestRelease:latestUpdate||latestBase,latestBase,latestUpdate,baseUpdateAvailable,baseUpdateStatus,base:{installed:install?{id:install.release_id||null,version:install.release_version||null,sourceSha:install.release_source_commit||null,projectId:install.vercel_project_id||null,deploymentId:install.vercel_deployment_id||null}:null,latest:latestBase,updateAvailable:baseUpdateAvailable,status:baseUpdateStatus},normalUpdate:{latest:latestUpdate,applied:install?.metadata?.appliedUpdate||null},activeOperation,operations:operationRows.data||[],releaseDiscoveryAvailable,master:{licenses:masterLicensesRows,releases:masterReleaseRows}},{headers:{"cache-control":"no-store"}});
 }catch(e:any){return Response.json({error:e?.message||"Could not load OrbitFS status"},{status:Number(e?.status)||500,headers:{"cache-control":"no-store"}})}
}
