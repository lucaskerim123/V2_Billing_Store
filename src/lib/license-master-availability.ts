import {licenseDb} from "@/lib/license-api";
import {masterPulseState} from "@/lib/master-api";

type FulfillmentMode="automatic"|"manual"|"paused";

function scalar(v:any){return v&&typeof v==="object"&&"value" in v?v.value:v}

export async function getLicenseMasterAvailability(){
  let settings:any={};
  try{
    const db=licenseDb();
    const {data:rows,error}=await db.from("app_settings").select("key,value").in("key",[
      "products.fulfillment_mode",
      "products.pause_fulfillment_when_master_restricted",
      "products.pause_fulfillment_when_master_unreachable",
      "general.master_restricted_notice",
      "general.maintenance_mode",
      "general.maintenance_message"
    ]);
    if(error)throw error;
    settings=Object.fromEntries((rows||[]).map((r:any)=>[r.key,scalar(r.value)]));
  }catch(error:any){
    return {reachable:false,restricted:true,reason:"billing_database_unavailable",authority:null,pulseRevision:0,configuredMode:"manual" as FulfillmentMode,effectiveMode:"manual" as FulfillmentMode,automaticFulfillmentAllowed:false,manualFulfillmentAllowed:false,notice:"OrbitFS order fulfilment is temporarily paused while the Billing Store database is unavailable.",error:String(error?.message||"Billing Store database unavailable")};
  }
  const configuredMode=String(settings["products.fulfillment_mode"]||"automatic") as FulfillmentMode;
  const pauseRestricted=settings["products.pause_fulfillment_when_master_restricted"]!==false;
  const pauseUnreachable=settings["products.pause_fulfillment_when_master_unreachable"]!==false;
  const notice=String(settings["general.master_restricted_notice"]||"OrbitFS licensing services are temporarily restricted. New licence fulfilment is paused until License Master is available.");
  const storeMaintenance=Boolean(settings["general.maintenance_mode"]);
  const storeMaintenanceMessage=String(settings["general.maintenance_message"]||"OrbitFS Store is temporarily under maintenance.");
  if(storeMaintenance){
    return {reachable:true,restricted:true,reason:"store_maintenance",authority:null,pulseRevision:0,configuredMode,effectiveMode:"manual" as FulfillmentMode,automaticFulfillmentAllowed:false,manualFulfillmentAllowed:false,notice:storeMaintenanceMessage,storeMaintenance:true};
  }
  try{
    const pulse=await masterPulseState();
    const authority=pulse?.authority||{};
    const restricted=!authority.system_enabled||!authority.licensing_enabled||Boolean(authority.maintenance_mode);
    const reason=Boolean(authority.maintenance_mode)?"maintenance":!authority.system_enabled?"api_disabled":!authority.licensing_enabled?"licensing_disabled":"online";
    const effectiveMode:FulfillmentMode=configuredMode==="paused"?"paused":configuredMode==="manual"?"manual":restricted&&pauseRestricted?"manual":"automatic";
    return {reachable:true,restricted,reason,authority,pulseRevision:Number(pulse?.pulse_revision||0),configuredMode,effectiveMode,automaticFulfillmentAllowed:!restricted&&effectiveMode==="automatic",manualFulfillmentAllowed:!restricted&&effectiveMode!=="paused",notice:restricted?notice:null};
  }catch(error:any){
    const effectiveMode:FulfillmentMode=configuredMode==="paused"?"paused":configuredMode==="manual"?"manual":pauseUnreachable?"manual":"automatic";
    return {reachable:false,restricted:true,reason:"unreachable",authority:null,pulseRevision:0,configuredMode,effectiveMode,automaticFulfillmentAllowed:false,manualFulfillmentAllowed:false,notice,error:String(error?.message||"License Master unavailable")};
  }
}


export async function requireLicenseMasterForMutation(){
  const state=await getLicenseMasterAvailability();
  if(!state.reachable||state.restricted){
    const reason=state.reason==="maintenance"
      ?"License Manager is in maintenance mode."
      :state.reason==="api_disabled"
        ?"License Manager API authority is disabled."
        :state.reason==="licensing_disabled"
          ?"License Manager licensing authority is disabled."
          :"License Manager is unavailable.";
    throw Object.assign(new Error(reason),{status:503,code:"LICENSE_AUTHORITY_UNAVAILABLE",authority:state.authority||null});
  }
  return state;
}
