import {requireOrbitAdmin,httpError} from "@/lib/orbitfs-deployment";
import {getLicenseMasterAvailability} from "@/lib/license-master-availability";

export async function GET(req:Request){
  try{
    await requireOrbitAdmin(req);
    const state=await getLicenseMasterAvailability();
    return Response.json({
      authority:{
        reachable:state.reachable,
        restricted:state.restricted,
        reason:state.reason,
        release_enabled:state.releaseAuthorityAvailable,
        deployment_enabled:state.deploymentAuthorityAvailable,
        base_deployment_enabled:state.baseDeploymentAvailable,
        update_deployment_enabled:state.updateDeploymentAvailable,
        rollback_enabled:state.rollbackAvailable,
        pulse_revision:state.pulseRevision,
        raw:state.authority||null
      },
      readOnly:true,
      owner:"license_manager"
    },{headers:{"cache-control":"no-store"}});
  }catch(error){return httpError(error)}
}

export async function PATCH(req:Request){
  try{
    await requireOrbitAdmin(req);
    return Response.json({
      error:"Deployment authorization controls are owned by License Manager. Change them in the License Manager API Control Center.",
      code:"LICENSE_MANAGER_AUTHORITY"
    },{status:410,headers:{"cache-control":"no-store"}});
  }catch(error){return httpError(error)}
}
