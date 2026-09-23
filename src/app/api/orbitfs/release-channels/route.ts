import {licenseDb} from "@/lib/license-api";
import {masterRequest} from "@/lib/master-api";
import {httpError,requireOrbitUser} from "@/lib/orbitfs-deployment";

export async function GET(req:Request){
  try{
    const {user}=await requireOrbitUser(req);
    const db=licenseDb();
    const [channels,bindings,requests]=await Promise.all([
      db.from("orbitfs_release_channels").select("channel,label,description,enabled,customer_visible,access_mode,access_request_enabled,self_join_enabled").eq("enabled",true).eq("customer_visible",true).order("channel"),
      db.from("license_bindings").select("license_id,license_product_key").eq("auth_user_id",user.id).eq("license_product_key","orbitfs_base").is("archived_at",null).order("created_at",{ascending:false}).limit(1).maybeSingle(),
      Promise.resolve(null),
    ]);
    if(channels.error)throw channels.error;if(bindings.error)throw bindings.error;
    const licenseId=String(bindings.data?.license_id||"");
    let remote:any={requests:[]};
    if(licenseId){
      try{remote=await masterRequest("/api/v1/release-channels/access",{method:"POST",body:JSON.stringify({action:"list_requests",license_id:licenseId})},"billing")}catch{}
    }
    return Response.json({channels:channels.data||[],requests:Array.isArray(remote?.requests)?remote.requests:[]},{headers:{"cache-control":"no-store"}});
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
    if(action==="join"||action==="request"||action==="leave"){
      const ch=await db.from("orbitfs_release_channels").select("id").eq("channel",channel).maybeSingle();
      if(ch.data?.id&&action==="join"){
        await db.from("orbitfs_release_channel_access").upsert({channel_id:ch.data.id,user_id:user.id},{onConflict:"channel_id,user_id"});
      }
      if(ch.data?.id&&action==="leave"){
        await db.from("orbitfs_release_channel_access").delete().eq("channel_id",ch.data.id).eq("user_id",user.id);
      }
    }
    return Response.json(result,{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}
