import {getLicenseMasterAvailability} from "@/lib/license-master-availability";
export const dynamic="force-dynamic";
export async function GET(){
  const state=await getLicenseMasterAvailability();
  return Response.json({
    reachable:state.reachable,
    restricted:state.restricted,
    reason:state.reason,
    authority:state.authority,
    fulfillment_mode:state.effectiveMode,
    notice:state.notice,
    pulse_revision:state.pulseRevision,
    store_maintenance:Boolean((state as any).storeMaintenance)
  },{headers:{"cache-control":"no-store"}});
}
