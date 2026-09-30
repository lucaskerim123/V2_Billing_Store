import {httpError,loadInstallation,requireOrbitUser} from "@/lib/orbitfs-deployment";
import {licenseDb} from "@/lib/license-api";

/**
 * Customer-scoped progress telemetry for the existing synchronous Update executor.
 * Billing events are observations only. This endpoint never authorizes, publishes
 * or changes release/deployment state; License Manager remains authoritative.
 */
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {user}=await requireOrbitUser(req);
    const {id}=await params;
    const install=await loadInstallation(id,user.id);
    const {data,error}=await licenseDb().from("orbitfs_deployment_events")
      .select("id,event_type,status,message,detail,created_at")
      .eq("installation_id",install.id)
      .eq("auth_user_id",user.id)
      .like("event_type","update.%")
      .order("created_at",{ascending:false})
      .limit(50);
    if(error)throw error;
    const events=(data||[]).map((row:any)=>{
      const detail=row.detail&&typeof row.detail==="object"?row.detail:{};
      return {
        id:row.id,
        type:row.event_type,
        status:row.status,
        message:row.message,
        createdAt:row.created_at,
        releaseId:String(detail.releaseId||""),
        releaseVersion:String(detail.releaseVersion||detail.version||"")
      };
    });
    const applied=install.metadata?.appliedUpdate||null;
    return Response.json({
      installationId:install.id,
      installationState:install.state||null,
      lastError:install.last_error||null,
      installedBaseVersion:install.release_version||null,
      appliedUpdate:applied?{
        releaseId:String(applied.releaseId||""),
        version:String(applied.version||""),
        channel:String(applied.channel||""),
        components:Array.isArray(applied.components)?applied.components:[],
        appliedAt:applied.appliedAt||null
      }:null,
      events
    },{headers:{"cache-control":"no-store"}});
  }catch(error){return httpError(error)}
}
