import {disconnectProviderConnection,event,httpError,loadInstallation,requireOrbitUser} from "@/lib/orbitfs-deployment";
import {licenseDb} from "@/lib/license-api";

const now=()=>new Date().toISOString();

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {user}=await requireOrbitUser(req),{id}=await params;
    const install=await loadInstallation(id,user.id);

    if(install.vercel_project_id||install.vercel_deployment_id||install.production_url){
      throw Object.assign(new Error("Undeploy OrbitFS before resetting setup to Stage 1. Reset never deletes a live Vercel deployment implicitly."),{status:409,code:"UNDEPLOY_REQUIRED"});
    }

    const disconnectResults=await Promise.allSettled([
      disconnectProviderConnection(user.id,"supabase"),
      disconnectProviderConnection(user.id,"vercel"),
    ]);
    const failures=disconnectResults
      .map((result,index)=>result.status==="rejected"?`${index===0?"Supabase":"Vercel"}: ${String(result.reason?.message||result.reason)}`:null)
      .filter(Boolean);
    if(failures.length){
      throw Object.assign(new Error(`Could not fully reset provider connections. ${failures.join(" | ")}`),{status:502,code:"PROVIDER_RESET_FAILED"});
    }

    const metadata=install.metadata&&typeof install.metadata==="object"?install.metadata:{};
    const preservedMetadata=metadata.licenseRegistration
      ? {licenseRegistration:metadata.licenseRegistration,setupResetAt:now()}
      : {setupResetAt:now()};

    const patch={
      state:"awaiting_supabase",
      supabase_project_ref:null,
      supabase_organization_id:null,
      supabase_project_name:null,
      supabase_region:null,
      database_initialized_at:null,
      schema_version:null,
      vercel_team_id:null,
      vercel_project_id:null,
      vercel_project_name:null,
      vercel_deployment_id:null,
      deployment_url:null,
      production_url:null,
      release_id:null,
      release_version:null,
      release_sha256:null,
      release_source_commit:null,
      previous_release_version:null,
      latest_available_release:null,
      applied_update_version:null,
      applied_update_id:null,
      applied_update_sha256:null,
      applied_update_source_commit:null,
      health_status:"unknown",
      last_health_at:null,
      last_deployment_at:null,
      last_error:null,
      metadata:preservedMetadata,
      updated_at:now(),
    };

    const {data,error}=await licenseDb().from("orbitfs_installations").update(patch).eq("id",install.id).eq("auth_user_id",user.id).select().single();
    if(error)throw error;

    await event(data,"setup.reset_to_stage_1","warning","OrbitFS setup reset to Stage 1. Provider connections and installer selections were cleared; customer cloud projects, data, installation ID and licence binding were preserved.",{
      preservedInstallationId:String(install.installation_id||""),
      preservedLicenseRegistration:Boolean(metadata.licenseRegistration),
      supabaseProjectDeleted:false,
      vercelProjectDeleted:false,
    });

    return Response.json({
      ok:true,
      installation:data,
      reset:{
        stage:1,
        providers:["supabase","vercel"],
        preserved:["installation_id","license_binding","customer_supabase_project","customer_vercel_account_resources"],
      },
    });
  }catch(e){return httpError(e)}
}
