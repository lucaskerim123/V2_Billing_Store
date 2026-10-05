import {licenseDb} from "@/lib/license-api";
import {masterInstallationControl,masterInstallations} from "@/lib/master-api";
import {httpError,requireOrbitAdmin,requireOrbitAdminManage} from "@/lib/orbitfs-deployment";

const clean=(value:any)=>String(value??"").trim();

function normalizeUrl(value:any){
  const raw=clean(value);
  if(!raw)return null;
  return /^https?:\/\//i.test(raw)?raw:`https://${raw}`;
}

export async function GET(req:Request){
  try{
    await requireOrbitAdmin(req);
    const db=licenseDb();
    const [localRows,customerRows,authority]=await Promise.all([
      db.from("orbitfs_installations")
        .select("id,auth_user_id,installation_id,component_key,state,supabase_project_ref,supabase_project_name,supabase_region,schema_version,vercel_team_id,vercel_project_id,vercel_project_name,vercel_deployment_id,deployment_url,production_url,release_version,release_id,health_status,last_health_at,last_error,metadata,created_at,updated_at")
        .neq("state","uninstalled")
        .order("updated_at",{ascending:false}),
      db.from("customers")
        .select("id,auth_user_id,user_id,customer_number,name,email,status"),
      masterInstallations(100,true),
    ]);
    if(localRows.error)throw localRows.error;
    if(customerRows.error)throw customerRows.error;

    const customers=customerRows.data||[];
    const customerByUser=new Map<string,any>();
    const customerByReference=new Map<string,any>();
    for(const customer of customers){
      const auth=clean(customer.auth_user_id||customer.user_id);
      if(auth)customerByUser.set(auth,customer);
      for(const ref of [customer.customer_number,customer.id,customer.auth_user_id,customer.user_id]){
        const key=clean(ref).toLowerCase();
        if(key)customerByReference.set(key,customer);
      }
    }

    const localByInstallation=new Map<string,any>();
    for(const install of localRows.data||[]){
      const id=clean(install.installation_id);
      if(id)localByInstallation.set(id,install);
    }

    const authorityRows=(Array.isArray(authority?.installations)?authority.installations:[]).filter((row:any)=>String(row?.status||"").toLowerCase()==="active");
    const seen=new Set<string>();
    const merged:any[]=[];

    for(const remote of authorityRows){
      const installationId=clean(remote.installation_id);
      if(!installationId)continue;
      seen.add(installationId);
      const local=localByInstallation.get(installationId)||null;
      const authorityCustomer=customerByReference.get(clean(remote.customer_external_id).toLowerCase())||null;
      const customer=local?(customerByUser.get(clean(local.auth_user_id))||authorityCustomer):authorityCustomer;
      const metadata=local?.metadata&&typeof local.metadata==="object"?local.metadata:{};
      const updater=metadata?.updaterConnection&&typeof metadata.updaterConnection==="object"?metadata.updaterConnection:{};
      const engineUrl=normalizeUrl(updater.engineHostUrl||updater.hostUrl);
      const panelUrl=normalizeUrl(local?.production_url||remote?.current_base?.deployment_url||local?.deployment_url||remote?.last_deployment_url);
      merged.push({
        id:local?.id||remote.id||installationId,
        local_id:local?.id||null,
        installation_id:installationId,
        license_id:remote.license_id||null,
        customer:{
          id:customer?.id||null,
          auth_user_id:local?.auth_user_id||customer?.auth_user_id||customer?.user_id||null,
          customer_number:customer?.customer_number||remote.customer_external_id||null,
          name:customer?.name||null,
          email:customer?.email||null,
          status:customer?.status||null,
        },
        network:{
          ip:remote.last_ip||null,
          hostname:remote.last_hostname||null,
          panel_url:panelUrl,
          engine_url:engineUrl,
          region:remote.last_region||local?.supabase_region||null,
          provider:remote.last_provider||null,
        },
        versions:{
          running:remote.product_version||local?.release_version||null,
          base:remote.current_base?.release_version||remote.current_base?.product_version||local?.release_version||null,
          update:remote.current_update?.release_version||remote.current_update?.product_version||null,
          base_release_id:remote.current_base?.release_id||local?.release_id||null,
          update_release_id:remote.current_update?.release_id||null,
          channel:remote.current_base?.release_channel||remote.current_update?.release_channel||null,
        },
        runtime:{
          state:remote.last_deployment_status||local?.state||remote.status||"unknown",
          health:local?.health_status||"unknown",
          last_seen_at:remote.last_seen_at||null,
          last_health_at:local?.last_health_at||null,
          last_operation:remote.last_operation||null,
          deployment_count:remote.deployment_count??null,
          last_error:local?.last_error||null,
          schema_version:local?.schema_version||null,
        },
        projects:{
          panel_project_id:local?.vercel_project_id||remote.current_base?.project_id||null,
          panel_project_name:local?.vercel_project_name||remote.current_base?.project_name||null,
          panel_deployment_id:local?.vercel_deployment_id||remote.current_base?.deployment_id||remote.last_deployment_id||null,
          engine_project_id:updater.engineProjectId||null,
          engine_project_name:updater.engineProjectName||null,
          engine_deployment_id:updater.engineDeploymentId||null,
          supabase_project_ref:local?.supabase_project_ref||null,
          supabase_project_name:local?.supabase_project_name||null,
        },
        deployment_lock:{
          locked:remote.deployment_locked===true,
          reason:remote.deployment_lock_reason||null,
          changed_at:remote.deployment_lock_changed_at||null,
          changed_by:remote.deployment_lock_changed_by||null,
          authority:"orbitfs-license-master-v2",
        },
        authority:"orbitfs-license-master-v2",
        authority_only:!local,
        deployment_source:local?"deployer":"external",
      });
    }

    for(const local of localRows.data||[]){
      const installationId=clean(local.installation_id);
      if(!installationId||seen.has(installationId))continue;
      const customer=customerByUser.get(clean(local.auth_user_id))||null;
      const metadata=local?.metadata&&typeof local.metadata==="object"?local.metadata:{};
      const updater=metadata?.updaterConnection&&typeof metadata.updaterConnection==="object"?metadata.updaterConnection:{};
      merged.push({
        id:local.id,
        local_id:local.id,
        installation_id:installationId,
        license_id:null,
        customer:{
          id:customer?.id||null,
          auth_user_id:local.auth_user_id||null,
          customer_number:customer?.customer_number||null,
          name:customer?.name||null,
          email:customer?.email||null,
          status:customer?.status||null,
        },
        network:{
          ip:null,
          hostname:null,
          panel_url:normalizeUrl(local.production_url||local.deployment_url),
          engine_url:normalizeUrl(updater.engineHostUrl||updater.hostUrl),
          region:local.supabase_region||null,
          provider:null,
        },
        versions:{
          running:local.release_version||null,
          base:local.release_version||null,
          update:null,
          base_release_id:local.release_id||null,
          update_release_id:null,
          channel:null,
        },
        runtime:{
          state:local.state||"unknown",
          health:local.health_status||"unknown",
          last_seen_at:null,
          last_health_at:local.last_health_at||null,
          last_operation:null,
          deployment_count:null,
          last_error:local.last_error||null,
          schema_version:local.schema_version||null,
        },
        projects:{
          panel_project_id:local.vercel_project_id||null,
          panel_project_name:local.vercel_project_name||null,
          panel_deployment_id:local.vercel_deployment_id||null,
          engine_project_id:updater.engineProjectId||null,
          engine_project_name:updater.engineProjectName||null,
          engine_deployment_id:updater.engineDeploymentId||null,
          supabase_project_ref:local.supabase_project_ref||null,
          supabase_project_name:local.supabase_project_name||null,
        },
        deployment_lock:{locked:false,reason:null,changed_at:null,changed_by:null,authority:"orbitfs-license-master-v2"},
        authority:"orbitfs-license-master-v2",
        authority_error:"Current Billing installation is not currently returned as an active License Manager binding.",
        authority_only:false,
        deployment_source:"deployer",
      });
    }

    return Response.json({
      ok:true,
      authority:"orbitfs-license-master-v2",
      fetched_at:new Date().toISOString(),
      installations:merged,
      scope:"current",
    },{headers:{"cache-control":"no-store"}});
  }catch(error){return httpError(error)}
}

export async function POST(req:Request){
  try{
    await requireOrbitAdminManage(req);
    const body=await req.json().catch(()=>({}));
    const action=clean(body.action).toLowerCase();
    const installationId=clean(body.installation_id||body.installationId);
    const licenseId=clean(body.license_id||body.licenseId);
    const reason=clean(body.reason);

    if(!["lock","unlock"].includes(action))throw Object.assign(new Error("Unsupported installation control action"),{status:400,code:"INSTALLATION_CONTROL_UNSUPPORTED"});
    if(!installationId)throw Object.assign(new Error("installation_id is required"),{status:400,code:"INSTALLATION_ID_REQUIRED"});
    if(action==="lock"&&!reason)throw Object.assign(new Error("A lock reason is required"),{status:400,code:"INSTALLATION_LOCK_REASON_REQUIRED"});

    const result=await masterInstallationControl({
      action,
      installation_id:installationId,
      license_id:licenseId||undefined,
      reason:action==="lock"?reason:undefined,
    });

    return Response.json({
      ok:true,
      authority:"orbitfs-license-master-v2",
      result,
    },{headers:{"cache-control":"no-store"}});
  }catch(error){return httpError(error)}
}
