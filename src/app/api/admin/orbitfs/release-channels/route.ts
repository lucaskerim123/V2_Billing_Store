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
      enabled:c.enabled!==false,customer_visible:c.customer_visible!==false,access_mode:String(c.access_mode||"closed")==="open"?"open":"closed",access_request_enabled:c.access_request_enabled===true,self_join_enabled:c.self_join_enabled===true,updated_at:new Date().toISOString()
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
    const [channels,localAccess,profiles,customerRows,requests,remoteAccess]=await Promise.all([
      db.from("orbitfs_release_channels").select("*").order("channel"),
      Promise.resolve({data:[],error:null} as any),
      db.from("user_profiles").select("id,display_name,company_name,status,role").eq("role","user").order("display_name"),
      db.from("customers").select("id,auth_user_id,user_id,customer_number,name,email"),
      masterRequest("/api/v1/release-channels/access?status=pending",{method:"GET"},"billing").catch(()=>({requests:[]})),
      masterRequest("/api/v1/release-channels/access?view=access",{method:"GET"},"billing").catch(()=>({access:[]}))
    ]);
    if(channels.error)throw channels.error;if(profiles.error)throw profiles.error;if(customerRows.error)throw customerRows.error;
    const customerMap=new Map((customerRows.data||[]).map((c:any)=>[String(c.auth_user_id||c.user_id||c.id),c]));
    const customers=(profiles.data||[]).map((p:any)=>{const c=customerMap.get(String(p.id));return {...p,email:c?.email||null,customer_id:c?.id||null,customer_number:c?.customer_number||null,customer_name:c?.name||null}}).filter((p:any)=>p.status!=="deleted");
    const authoritativeAccess=Array.isArray(remoteAccess?.access)?remoteAccess.access:[];
    return Response.json({channels:channels.data||[],access:authoritativeAccess,customers,requests:Array.isArray(requests?.requests)?requests.requests:[]},{headers:{"cache-control":"no-store"}});
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
      const binding=await db.from("license_bindings").select("license_id").eq("auth_user_id",userId).eq("license_product_key","orbitfs_base").is("archived_at",null).order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(binding.error)throw binding.error;
      if(binding.data?.license_id) await masterRequest("/api/v1/release-channels/access",{method:"POST",body:JSON.stringify({license_id:String(binding.data.license_id),channel,external_reference:userId})},"billing");
      await db.from("orbitfs_release_channel_access_audit").insert({channel_id:c.data.id,user_id:userId,action:"grant",actor_user_id:auth.user.id,metadata:{source:"admin",licenseMasterSynced:Boolean(binding.data?.license_id)}});
      return Response.json({access:x.data,licenseMasterSynced:Boolean(binding.data?.license_id)},{status:201});
    }
    if(action==="revoke"){
      const id=String(body.id||"").trim();if(!id)throw Object.assign(new Error("Access ID is required"),{status:400});
      const existing=await db.from("orbitfs_release_channel_access").select("channel_id,user_id").eq("id",id).maybeSingle();if(existing.error)throw existing.error;if(!existing.data)throw Object.assign(new Error("Channel access was not found"),{status:404});
      const x=await db.from("orbitfs_release_channel_access").delete().eq("id",id);if(x.error)throw x.error;
      const binding=await db.from("license_bindings").select("license_id").eq("auth_user_id",existing.data.user_id).eq("license_product_key","orbitfs_base").is("archived_at",null).order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(binding.error)throw binding.error;
      if(binding.data?.license_id) await masterRequest("/api/v1/release-channels/access",{method:"POST",body:JSON.stringify({license_id:String(binding.data.license_id),channel:(await db.from("orbitfs_release_channels").select("channel").eq("id",existing.data.channel_id).single()).data?.channel,revoke:true,external_reference:existing.data.user_id})},"billing");
      await db.from("orbitfs_release_channel_access_audit").insert({channel_id:existing.data.channel_id,user_id:existing.data.user_id,action:"revoke",actor_user_id:auth.user.id,metadata:{source:"admin",licenseMasterSynced:Boolean(binding.data?.license_id)}});
      return Response.json({ok:true,licenseMasterSynced:Boolean(binding.data?.license_id)});
    }
    if(action==="request"){
      const licenseId=String(body.licenseId||body.license_id||"").trim(),channel=String(body.channel||"").trim().toLowerCase();
      if(!licenseId||!channel)throw Object.assign(new Error("License and channel are required"),{status:400});
      return Response.json(await masterRequest("/api/v1/release-channels/access",{method:"POST",body:JSON.stringify({action:"grant",license_id:licenseId,channel,external_reference:body.userId||body.user_id||null})},"billing"));
    }
    if(action==="reject"){
      const licenseId=String(body.licenseId||body.license_id||"").trim(),channel=String(body.channel||"").trim().toLowerCase();
      if(!licenseId||!channel)throw Object.assign(new Error("License and channel are required"),{status:400});
      return Response.json(await masterRequest("/api/v1/release-channels/access",{method:"POST",body:JSON.stringify({action:"reject",license_id:licenseId,channel,reason:body.reason||null})},"billing"));
    }
    if(action==="channel"){
      const channel=String(body.channel||"").trim().toLowerCase();
      if(!channel)throw Object.assign(new Error("Channel is required"),{status:400});
      const remote=await masterRequest("/api/v1/release-channels",{
        method:"POST",
        body:JSON.stringify({
          channel,
          label:body.label,
          description:body.description,
          enabled:body.enabled,
          customer_visible:body.customer_visible,
          access_mode:body.access_mode,
          access_request_enabled:body.access_request_enabled,
          self_join_enabled:body.self_join_enabled,
          sort_order:body.sort_order
        })
      },"billing");
      await syncFromMaster();
      return Response.json({ok:true,channel:remote?.channel||remote});
    }
    throw Object.assign(new Error("Unsupported release-channel action"),{status:400});
  }catch(e){return httpError(e)}
}