import {licenseDb} from "@/lib/license-api";
import {httpError,requireOrbitAdmin} from "@/lib/orbitfs-deployment";

export async function GET(req:Request){
  try{
    await requireOrbitAdmin(req);
    const db=licenseDb();
    const [channels,access,profiles]=await Promise.all([
      db.from("orbitfs_release_channels").select("*").order("channel"),
      db.from("orbitfs_release_channel_access").select("id,channel_id,user_id,created_at").order("created_at",{ascending:false}),
      db.from("user_profiles").select("id,display_name,company_name,email,status").order("display_name")
    ]);
    if(channels.error)throw channels.error;
    if(access.error)throw access.error;
    if(profiles.error)throw profiles.error;
    return Response.json({channels:channels.data||[],access:access.data||[],customers:profiles.data||[]},{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}

export async function POST(req:Request){
  try{
    await requireOrbitAdmin(req);
    const body=await req.json().catch(()=>({}));
    const action=String(body.action||"").toLowerCase();
    const db=licenseDb();
    if(action==="grant"){
      const channel=String(body.channel||"").trim().toLowerCase();
      const userId=String(body.userId||body.user_id||"").trim();
      if(!channel||!userId)throw Object.assign(new Error("Channel and customer are required"),{status:400});
      const c=await db.from("orbitfs_release_channels").select("id,enabled,customer_visible").eq("channel",channel).maybeSingle();
      if(c.error)throw c.error;
      if(!c.data)throw Object.assign(new Error("Release channel was not found"),{status:404});
      if(!c.data.enabled||!c.data.customer_visible)throw Object.assign(new Error("Release channel is not available to customers"),{status:400});
      const x=await db.from("orbitfs_release_channel_access").upsert({channel_id:c.data.id,user_id:userId},{onConflict:"channel_id,user_id"}).select().single();
      if(x.error)throw x.error;
      return Response.json({access:x.data},{status:201});
    }
    if(action==="revoke"){
      const id=String(body.id||"").trim();
      if(!id)throw Object.assign(new Error("Access ID is required"),{status:400});
      const x=await db.from("orbitfs_release_channel_access").delete().eq("id",id);
      if(x.error)throw x.error;
      return Response.json({ok:true});
    }
    if(action==="channel"){
      const channel=String(body.channel||"").trim().toLowerCase();
      const label=String(body.label||channel).trim();
      if(!channel||!label)throw Object.assign(new Error("Channel and label are required"),{status:400});
      const patch={channel,label,description:String(body.description||""),enabled:body.enabled!==false,customer_visible:body.customer_visible!==false,default_for_new_customers:body.default_for_new_customers===true,updated_at:new Date().toISOString()};
      const x=await db.from("orbitfs_release_channels").upsert(patch,{onConflict:"channel"}).select().single();
      if(x.error)throw x.error;
      return Response.json({channel:x.data});
    }
    throw Object.assign(new Error("Unsupported release-channel action"),{status:400});
  }catch(e){return httpError(e)}
}
