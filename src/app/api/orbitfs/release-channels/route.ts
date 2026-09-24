import {licenseDb} from "@/lib/license-api";
import {masterRequest} from "@/lib/master-api";
import {httpError,requireOrbitUser} from "@/lib/orbitfs-deployment";

export async function GET(req:Request){
  try{
    const {user}=await requireOrbitUser(req);
    const db=licenseDb();
    const [channelResult,bindings,requests]=await Promise.all([
      masterRequest("/api/v1/release-channels?include_disabled=false",{method:"GET"},"billing"),
      db.from("license_bindings").select("license_id,license_product_key").eq("auth_user_id",user.id).eq("license_product_key","orbitfs_base").is("archived_at",null).order("created_at",{ascending:false}).limit(1).maybeSingle(),
      Promise.resolve(null),
    ]);
    if(bindings.error)throw bindings.error;
    const licenseId=String(bindings.data?.license_id||"");
    let remote:any={requests:[]};
    if(licenseId){
      try{remote=await masterRequest("/api/v1/release-channels/access",{method:"POST",body:JSON.stringify({action:"list_requests",license_id:licenseId})},"billing")}catch{}
    }
    const channels=Array.isArray(channelResult?.channels)?channelResult.channels.filter((x:any)=>x.enabled!==false&&x.customer_visible!==false):[];
    return Response.json({channels,requests:Array.isArray(remote?.requests)?remote.requests:[]},{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}

export async function POST(req:Request){
  try{
    const {user}=await requireOrbitUser(req);
    const body=await req.json().catch(()=>({}));
    const action=String(body.action||"").trim().toLowerCase();
    const channel=String(body.channel||"").trim().toLowerCase();
    if(!channel)throw Object.assign(new Error("Release channel is required"),{status:400});
    const db=licenseDb();
    const binding=await db.from("license_bindings").select("license_id").eq("auth_user_id",user.id).eq("license_product_key","orbitfs_base").is("archived_at",null).order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(binding.error)throw binding.error;
    const licenseId=String(binding.data?.license_id||"");
    if(!licenseId)throw Object.assign(new Error("An active OrbitFS Base license is required"),{status:403});
    if(!["request","join","leave"].includes(action))throw Object.assign(new Error("Unsupported channel access action"),{status:400});
    const result=await masterRequest("/api/v1/release-channels/access",{
      method:"POST",
      body:JSON.stringify({action:action==="leave"?"revoke":action,license_id:licenseId,channel,external_reference:user.id})
    },"billing");
    // License Manager is authoritative for channel access. Billing Store does not persist a competing access record.
    return Response.json(result,{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}
