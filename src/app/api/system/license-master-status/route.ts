import {getLicenseMasterAvailability} from "@/lib/license-master-availability";
export const dynamic="force-dynamic";
export async function GET(){
  const state=await getLicenseMasterAvailability();
  return Response.json({
    reachable:state.reachable,
    primary_reachable:Boolean((state as any).primaryReachable??state.reachable),
    fallback_reachable:Boolean((state as any).fallbackReachable),
    fallback:Boolean((state as any).fallback),
    mode:String((state as any).mode||"primary"),
    restricted:state.restricted,
    reason:state.reason,
    authority:state.authority,
    fulfillment_mode:state.effectiveMode,
    notice:state.notice,
    pulse_revision:state.pulseRevision,
    store_maintenance:Boolean((state as any).storeMaintenance),
    transport:(state as any).transport||null
  },{headers:{"cache-control":"no-store"}});
}
