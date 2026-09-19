import {licenseDb} from "@/lib/license-api";
import {masterRequest} from "@/lib/master-api";
import {httpError,requireOrbitAdmin} from "@/lib/orbitfs-deployment";

async function syncFromMaster(){
  const remote=await masterRequest("/api/v1/release-channels?include_disabled=true",{method:"GET"},"billing");
  const rows=Array.isArray(remote?.channels)?remote.channels:[];
  const db=licenseDb();
  for(const c of rows){
    const result=await db.from("orbitfs_release_channels").upsert({
      channel:String(c.channel),label:String(c.label||c.channel),description:String(c.description||""),
      enabled:c.enabled!==false,customer_visible:c.customer_visible!==false,access_mode:String(c.access_mode||"closed")==="open"?"open":"closed",updated_at:new Date().toISOString()
    },{onConflict:"channel"});
    if(result.error)throw result.error;
  }
  return rows;
}

export async function GET(req:Request){
  try{
    await requireOrbitAdmin(req);
    try{await syncFromMaster()}catch(e){console.warn("Release-channel master sync failed; serving local mirror:",e)}
    const db=licenseDb();
    const [channels,access,profiles]=await Promise.all([
      db.from("orbitfs_release_channels").select("*").order("channel"),
      db.from("orbitfs_release_channel_access").select("id,channel_id,user_id,created_at").order("created_at",{ascending:false}),
      db.from("user_profiles").select("id,display_name,company_name,email,status,role").eq("role","user").order("display_name")
    ]);
    if(channels.error)throw channels.error;if(access.error)throw access.error;if(profiles.error)throw profiles.error;
    return Response.json({channels:channels.data||[],access:access.data||[],customers:profiles.data||[]},{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}

export async function POST(req:Request){
  try{
    const auth=await requireOrbitAdmin(req);
    const body=await req.json().catch(()=>({})),action=String(body.action||"").toLowerCase(),db=licenseDb();
    if(action==="sync"){const channels=await syncFromMaster();return Response.json({ok:true,channels});}
    if(action==="grant"){
      const channel=String(body.channel||"").trim().toLowerCase(),userId=String(body.userId||body.user_id||"").trim();
      if(!channel||!userId)throw Object.assign(new Error("Channel and customer are required"),{status:400});
      const c=await db.from("orbitfs_release_channels").select("id,enabled,customer_visible").eq("channel",channel).maybeSingle();
      if(c.error)throw c.error;if(!c.data)throw Object.assign(new Error("Release channel was not found"),{status:404});
      if(!c.data.enabled||!c.data.customer_visible)throw Object.assign(new Error("Release channel is not available to customers"),{status:400});
      const x=await db.from("orbitfs_release_channel_access").upsert({channel_id:c.data.id,user_id:userId},{onConflict:"channel_id,user_id"}).select().single();
      if(x.error)throw x.error;
      await db.from("orbitfs_release_channel_access_audit").insert({channel_id:c.data.id,user_id:userId,action:"grant",actor_user_id:auth.user.id,metadata:{source:"admin"}});
      return Response.json({access:x.data},{status:201});
    }
    if(action==="revoke"){
      const id=String(body.id||"").trim();if(!id)throw Object.assign(new Error("Access ID is required"),{status:400});
      const existing=await db.from("orbitfs_release_channel_access").select("channel_id,user_id").eq("id",id).maybeSingle();if(existing.error)throw existing.error;if(!existing.data)throw Object.assign(new Error("Channel access was not found"),{status:404});
      const x=await db.from("orbitfs_release_channel_access").delete().eq("id",id);if(x.error)throw x.error;
      await db.from("orbitfs_release_channel_access_audit").insert({channel_id:existing.data.channel_id,user_id:existing.data.user_id,action:"revoke",actor_user_id:auth.user.id,metadata:{source:"admin"}});return Response.json({ok:true});
    }
    if(action==="channel")throw Object.assign(new Error("Release channels are managed by License Master. Use Sync from License Master."),{status:409});
    throw Object.assign(new Error("Unsupported release-channel action"),{status:400});
  }catch(e){return httpError(e)}
}