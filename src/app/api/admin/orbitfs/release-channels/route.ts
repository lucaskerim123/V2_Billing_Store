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
    const [channels,profiles,customerRows,bindingRows,requests,remoteAccess]=await Promise.all([
      db.from("orbitfs_release_channels").select("*").order("channel"),
      db.from("user_profiles").select("id,display_name,company_name,status,role").eq("role","user").order("display_name"),
      db.from("customers").select("id,auth_user_id,user_id,customer_number,name,email"),
      db.from("license_bindings").select("license_id,auth_user_id").eq("license_product_key","orbitfs_base").is("archived_at",null),
      masterRequest("/api/v1/release-channels/access?status=pending",{method:"GET"},"billing").catch(()=>({requests:[]})),
      masterRequest("/api/v1/release-channels/access?view=access",{method:"GET"},"billing").catch(()=>({access:[]}))
    ]);
    if(channels.error)throw channels.error;if(profiles.error)throw profiles.error;if(customerRows.error)throw customerRows.error;if(bindingRows.error)throw bindingRows.error;
    const customerMap=new Map((customerRows.data||[]).map((c:any)=>[String(c.auth_user_id||c.user_id||c.id),c]));
    const customers=(profiles.data||[]).map((p:any)=>{const c=customerMap.get(String(p.id));return {...p,email:c?.email||null,customer_id:c?.id||null,customer_number:c?.customer_number||null,customer_name:c?.name||null}}).filter((p:any)=>p.status!=="deleted");
    const userByLicense=new Map((bindingRows.data||[]).map((b:any)=>[String(b.license_id),String(b.auth_user_id)]));
    const channelByKey=new Map((channels.data||[]).map((ch:any)=>[String(ch.channel),ch]));
    const authoritativeAccess=(Array.isArray(remoteAccess?.access)?remoteAccess.access:[]).map((a:any)=>{
      const ch=channelByKey.get(String(a.channel));
      const userId=String(a.external_reference||userByLicense.get(String(a.license_id))||"");
      return {...a,channel_id:ch?.id||null,user_id:userId};
    });
    return Response.json({channels:channels.data||[],access:authoritativeAccess,customers,requests:Array.isArray(requests?.requests)?requests.requests:[]},{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}

export async function POST(req:Request){
  try{
    await requireOrbitAdmin(req);
    const body=await req.json().catch(()=>({})),action=String(body.action||"").toLowerCase(),db=licenseDb();
    if(action==="sync"){const channels=await syncFromMaster();return Response.json({ok:true,channels});}
    if(action==="grant"){
      const channel=String(body.channel||"").trim().toLowerCase(),userId=String(body.userId||body.user_id||"").trim();
      if(!channel||!userId)throw Object.assign(new Error("Channel and customer are required"),{status:400});
      const ch=await db.from("orbitfs_release_channels").select("id,enabled,customer_visible").eq("channel",channel).maybeSingle();
      if(ch.error)throw ch.error;if(!ch.data)throw Object.assign(new Error("Release channel was not found"),{status:404});
      if(!ch.data.enabled||!ch.data.customer_visible)throw Object.assign(new Error("Release channel is not available to customers"),{status:400});
      const binding=await db.from("license_bindings").select("license_id").eq("auth_user_id",userId).eq("license_product_key","orbitfs_base").is("archived_at",null).order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(binding.error)throw binding.error;if(!binding.data?.license_id)throw Object.assign(new Error("Customer has no active OrbitFS Base license"),{status:409});
      const remote=await masterRequest("/api/v1/release-channels/access",{method:"POST",body:JSON.stringify({action:"grant",license_id:String(binding.data.license_id),channel,external_reference:userId})},"billing");
      return Response.json({access:remote?.access||remote,licenseMasterSynced:true},{status:201});
    }
    if(action==="revoke"){
      const licenseId=String(body.licenseId||body.license_id||"").trim(),channel=String(body.channel||"").trim().toLowerCase();
      if(!licenseId||!channel)throw Object.assign(new Error("License and channel are required"),{status:400});
      const remote=await masterRequest("/api/v1/release-channels/access",{method:"POST",body:JSON.stringify({action:"revoke",license_id:licenseId,channel,external_reference:body.userId||body.user_id||null})},"billing");
      return Response.json({ok:true,access:remote?.access||null,licenseMasterSynced:true});
    }
    if(action==="request"||action==="approve"){
      const licenseId=String(body.licenseId||body.license_id||"").trim(),channel=String(body.channel||"").trim().toLowerCase();
      if(!licenseId||!channel)throw Object.assign(new Error("License and channel are required"),{status:400});
      return Response.json(await masterRequest("/api/v1/release-channels/access",{method:"POST",body:JSON.stringify({action:"grant",license_id:licenseId,channel,external_reference:body.userId||body.user_id||null})},"billing"));
    }
    if(action==="reject"){
      const licenseId=String(body.licenseId||body.license_id||"").trim(),channel=String(body.channel||"").trim().toLowerCase();
      if(!licenseId||!channel)throw Object.assign(new Error("License and channel are required"),{status:400});
      return Response.json(await masterRequest("/api/v1/release-channels/access",{method:"POST",body:JSON.stringify({action:"reject",license_id:licenseId,channel,reason:body.reason||null})},"billing"));
    }
    throw Object.assign(new Error("Unsupported release-channel action"),{status:400});
  }catch(e){return httpError(e)}
}