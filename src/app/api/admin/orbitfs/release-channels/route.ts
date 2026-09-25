import {licenseDb} from "@/lib/license-api";
import {masterRequest} from "@/lib/master-api";
import {httpError,requireOrbitAdmin} from "@/lib/orbitfs-deployment";

async function authoritativeChannels(){
  const remote=await masterRequest("/api/v1/release-channels?include_disabled=true",{method:"GET"},"billing");
  return Array.isArray(remote?.channels)?remote.channels:[];
}

export async function GET(req:Request){
  try{
    await requireOrbitAdmin(req);
    const db=licenseDb();
    const [channels,profiles,customerRows,bindingRows,requests,remoteAccess]=await Promise.all([
      authoritativeChannels(),
      db.from("user_profiles").select("id,display_name,company_name,status,role").eq("role","user").order("display_name"),
      db.from("customers").select("id,auth_user_id,user_id,customer_number,name,email"),
      db.from("license_bindings").select("license_id,auth_user_id").eq("license_product_key","orbitfs_base").is("archived_at",null),
      masterRequest("/api/v1/release-channels/access?status=pending",{method:"GET"},"billing").catch(()=>({requests:[]})),
      masterRequest("/api/v1/release-channels/access?view=access",{method:"GET"},"billing").catch(()=>({access:[]}))
    ]);
    if(profiles.error)throw profiles.error;
    if(customerRows.error)throw customerRows.error;
    if(bindingRows.error)throw bindingRows.error;

    const customerMap=new Map((customerRows.data||[]).map((c:any)=>[String(c.auth_user_id||c.user_id||c.id),c]));
    const customers=(profiles.data||[]).map((p:any)=>{
      const c=customerMap.get(String(p.id));
      return {...p,email:c?.email||null,customer_id:c?.id||null,customer_number:c?.customer_number||null,customer_name:c?.name||null};
    }).filter((p:any)=>p.status!=="deleted");

    const userByLicense=new Map((bindingRows.data||[]).map((b:any)=>[String(b.license_id),String(b.auth_user_id)]));
    const authoritativeAccess=(Array.isArray(remoteAccess?.access)?remoteAccess.access:[]).map((a:any)=>({
      ...a,
      user_id:String(a.external_reference||userByLicense.get(String(a.license_id))||"")
    }));

    return Response.json({
      channels,
      access:authoritativeAccess,
      customers,
      requests:Array.isArray(requests?.requests)?requests.requests:[],
      authority:"license_manager",
      mirrored:false
    },{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}

export async function POST(req:Request){
  try{
    await requireOrbitAdmin(req);
    const body=await req.json().catch(()=>({}));
    const action=String(body.action||"").toLowerCase();

    if(action==="sync"){
      const channels=await authoritativeChannels();
      return Response.json({ok:true,channels,authority:"license_manager",mirrored:false});
    }

    if(action==="grant"){
      const channel=String(body.channel||"").trim().toLowerCase();
      const userId=String(body.userId||body.user_id||"").trim();
      if(!channel||!userId)throw Object.assign(new Error("Channel and customer are required"),{status:400});

      const channels=await authoritativeChannels();
      const authoritative=channels.find((c:any)=>String(c.channel||"").toLowerCase()===channel);
      if(!authoritative)throw Object.assign(new Error("Release channel was not found in License Manager"),{status:404});
      if(authoritative.enabled===false||authoritative.customer_visible===false)throw Object.assign(new Error("Release channel is not available to customers"),{status:400});

      const db=licenseDb();
      const binding=await db.from("license_bindings").select("license_id").eq("auth_user_id",userId).eq("license_product_key","orbitfs_base").is("archived_at",null).order("created_at",{ascending:false}).limit(1).maybeSingle();
      if(binding.error)throw binding.error;
      if(!binding.data?.license_id)throw Object.assign(new Error("Customer has no linked OrbitFS Base license"),{status:409});

      const remote=await masterRequest("/api/v1/release-channels/access",{method:"POST",body:JSON.stringify({action:"grant",license_id:String(binding.data.license_id),channel,external_reference:userId})},"billing");
      return Response.json({access:remote?.access||remote,authority:"license_manager"},{status:201});
    }

    if(action==="revoke"){
      const licenseId=String(body.licenseId||body.license_id||"").trim();
      const channel=String(body.channel||"").trim().toLowerCase();
      if(!licenseId||!channel)throw Object.assign(new Error("License and channel are required"),{status:400});
      const remote=await masterRequest("/api/v1/release-channels/access",{method:"POST",body:JSON.stringify({action:"revoke",license_id:licenseId,channel,external_reference:body.userId||body.user_id||null})},"billing");
      return Response.json({ok:true,access:remote?.access||null,authority:"license_manager"});
    }

    if(action==="request"||action==="approve"){
      const licenseId=String(body.licenseId||body.license_id||"").trim();
      const channel=String(body.channel||"").trim().toLowerCase();
      if(!licenseId||!channel)throw Object.assign(new Error("License and channel are required"),{status:400});
      return Response.json(await masterRequest("/api/v1/release-channels/access",{method:"POST",body:JSON.stringify({action:"grant",license_id:licenseId,channel,external_reference:body.userId||body.user_id||null})},"billing"));
    }

    if(action==="reject"){
      const licenseId=String(body.licenseId||body.license_id||"").trim();
      const channel=String(body.channel||"").trim().toLowerCase();
      if(!licenseId||!channel)throw Object.assign(new Error("License and channel are required"),{status:400});
      return Response.json(await masterRequest("/api/v1/release-channels/access",{method:"POST",body:JSON.stringify({action:"reject",license_id:licenseId,channel,reason:body.reason||null})},"billing"));
    }

    throw Object.assign(new Error("Unsupported release-channel action"),{status:400});
  }catch(e){return httpError(e)}
}
