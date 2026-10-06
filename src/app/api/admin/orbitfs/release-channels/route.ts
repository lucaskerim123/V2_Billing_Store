import {licenseDb} from "@/lib/license-api";
import {masterRequest} from "@/lib/master-api";
import {httpError,requireOrbitAdmin} from "@/lib/orbitfs-deployment";
import {notifyChannelCustomer} from "@/lib/release-channel-notifications";

async function authoritativeChannels(){
  const remote=await masterRequest("/api/v1/release-channels?include_disabled=true",{method:"GET",cache:"no-store"},"billing");
  return Array.isArray(remote?.channels)?remote.channels:[];
}

export async function GET(req:Request){
  try{
    await requireOrbitAdmin(req);
    const db=licenseDb();
    const [channels,profiles,customerRows,requests,remoteAccess,baseReleases,updateReleases]=await Promise.all([
      authoritativeChannels(),
      db.from("user_profiles").select("id,display_name,company_name,status,role"),
      db.from("customers").select("id,auth_user_id,user_id,customer_number,name,email,status").order("name"),
      masterRequest("/api/v1/release-channels/access?status=pending",{method:"GET",cache:"no-store"},"billing"),
      masterRequest("/api/v1/release-channels/access?view=access",{method:"GET",cache:"no-store"},"billing"),
      masterRequest("/api/v1/releases?product=orbitfs_base&type=base",{method:"GET",cache:"no-store"},"billing"),
      masterRequest("/api/v1/releases?product=orbitfs_base&type=update",{method:"GET",cache:"no-store"},"billing")
    ]);
    if(profiles.error)throw profiles.error;
    if(customerRows.error)throw customerRows.error;

    const profileMap=new Map((profiles.data||[]).map((p:any)=>[String(p.id),p]));
    const customers=(customerRows.data||[]).map((customer:any)=>{
      const userId=String(customer.auth_user_id||customer.user_id||"");
      const profile:any=profileMap.get(userId)||{};
      return {
        id:userId,
        display_name:profile.display_name||customer.name||null,
        company_name:profile.company_name||null,
        status:customer.status||profile.status||"active",
        role:profile.role||"user",
        email:customer.email||null,
        customer_id:customer.id||null,
        customer_number:customer.customer_number||null,
        customer_name:customer.name||null
      };
    }).filter((customer:any)=>customer.id&&customer.status!=="deleted");

    const customerByNumber=new Map(customers.filter((customer:any)=>customer.customer_number).map((customer:any)=>[String(customer.customer_number).toLowerCase(),customer]));
    const authoritativeAccess=(Array.isArray(remoteAccess?.access)?remoteAccess.access:[]).map((a:any)=>{
      const customer:any=customerByNumber.get(String(a.external_reference||"").toLowerCase());
      return {...a,user_id:String(customer?.id||"")};
    });
    const authoritativeRequests=(Array.isArray(requests?.requests)?requests.requests:[]).map((request:any)=>{
      const customer:any=customerByNumber.get(String(request.external_reference||"").toLowerCase());
      return {...request,user_id:String(customer?.id||"")};
    });

    const usage:Record<string,{base:{total:number;published:number};update:{total:number;published:number}}>= {};
    const countRelease=(row:any,type:"base"|"update")=>{
      const channel=String(row?.channel||"stable").trim().toLowerCase()||"stable";
      if(!usage[channel])usage[channel]={base:{total:0,published:0},update:{total:0,published:0}};
      usage[channel][type].total+=1;
      if(String(row?.status||"").toLowerCase()==="published")usage[channel][type].published+=1;
    };
    const baseRows=Array.isArray(baseReleases?.releases)?baseReleases.releases:(Array.isArray(baseReleases)?baseReleases:[]);
    const updateRows=Array.isArray(updateReleases?.releases)?updateReleases.releases:(Array.isArray(updateReleases)?updateReleases:[]);
    baseRows.forEach((row:any)=>countRelease(row,"base"));
    updateRows.forEach((row:any)=>countRelease(row,"update"));

    return Response.json({
      channels,
      access:authoritativeAccess,
      customers,
      requests:authoritativeRequests,
      releaseUsage:usage,
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

    if(action==="save"){
      const channel=String(body.channel||"").trim().toLowerCase();
      const label=String(body.label||"").trim();
      if(!channel||!label)throw Object.assign(new Error("Channel and label are required"),{status:400});
      const remote=await masterRequest("/api/v1/release-channels",{
        method:"POST",
        body:JSON.stringify({
          channel,
          label,
          description:String(body.description||""),
          enabled:body.enabled!==false,
          customer_visible:body.customer_visible!==false,
          access_mode:body.access_mode==="open"?"open":"closed",
          access_request_enabled:body.access_request_enabled===true,
          self_join_enabled:body.self_join_enabled===true,
          sort_order:Number.isFinite(Number(body.sort_order))?Number(body.sort_order):100
        })
      },"billing");
      return Response.json({...remote,authority:"license_manager",mirrored:false},{headers:{"cache-control":"no-store"}});
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
      const customer=await db.from("customers").select("customer_number").or(`auth_user_id.eq.${userId},user_id.eq.${userId}`).limit(1).maybeSingle();
      if(customer.error)throw customer.error;
      const customerReference=String(customer.data?.customer_number||"").trim();
      if(!customerReference)throw Object.assign(new Error("Customer has no Billing customer number"),{status:409});
      const remote=await masterRequest("/api/v1/release-channels/access",{method:"POST",body:JSON.stringify({action:"grant",channel,external_reference:customerReference})},"billing");
      const label=String(authoritative.label||channel);
      try{await notifyChannelCustomer(userId,{eventType:"release_channel.added",channel,label,message:`You've been added to the ${label} channel.`,severity:"success"})}
      catch(notificationError){console.error("release channel grant notification failed",notificationError)}
      return Response.json({access:remote?.access||remote,authority:"license_manager"},{status:201});
    }

    if(action==="revoke"){
      const licenseId=String(body.licenseId||body.license_id||"").trim();
      const channel=String(body.channel||"").trim().toLowerCase();
      if(!licenseId||!channel)throw Object.assign(new Error("License and channel are required"),{status:400});
      const userId=String(body.userId||body.user_id||"").trim();
      const remote=await masterRequest("/api/v1/release-channels/access",{method:"POST",body:JSON.stringify({action:"revoke",license_id:licenseId,channel,external_reference:userId||null})},"billing");
      if(userId){
        const channels=await authoritativeChannels();const label=String(channels.find((x:any)=>String(x.channel)===channel)?.label||channel);
        try{await notifyChannelCustomer(userId,{eventType:"release_channel.removed",channel,label,message:`You've been removed from the ${label} channel.`,severity:"warning"})}
        catch(notificationError){console.error("release channel revoke notification failed",notificationError)}
      }
      return Response.json({ok:true,access:remote?.access||null,authority:"license_manager"});
    }

    if(action==="request"||action==="approve"){
      const licenseId=String(body.licenseId||body.license_id||"").trim();
      const channel=String(body.channel||"").trim().toLowerCase();
      if(!licenseId||!channel)throw Object.assign(new Error("License and channel are required"),{status:400});
      const remote=await masterRequest("/api/v1/release-channels/access",{method:"POST",body:JSON.stringify({action:"grant",license_id:licenseId,channel,external_reference:body.customerReference||body.customer_reference||null})},"billing");
      const userId=String(body.userId||body.user_id||"").trim();
      if(action==="approve"&&userId){
        const channels=await authoritativeChannels();const label=String(channels.find((x:any)=>String(x.channel)===channel)?.label||channel);
        try{await notifyChannelCustomer(userId,{eventType:"release_channel.request.approved",channel,label,message:`Your request was accepted. You've been added to the ${label} channel.`,severity:"success"})}
        catch(notificationError){console.error("release channel approval notification failed",notificationError)}
      }
      return Response.json(remote);
    }

    if(action==="reject"){
      const licenseId=String(body.licenseId||body.license_id||"").trim();
      const channel=String(body.channel||"").trim().toLowerCase();
      if(!licenseId||!channel)throw Object.assign(new Error("License and channel are required"),{status:400});
      const remote=await masterRequest("/api/v1/release-channels/access",{method:"POST",body:JSON.stringify({action:"reject",license_id:licenseId,channel,reason:body.reason||null})},"billing");
      const userId=String(body.userId||body.user_id||"").trim();
      if(userId){
        const channels=await authoritativeChannels();const label=String(channels.find((x:any)=>String(x.channel)===channel)?.label||channel);
        try{await notifyChannelCustomer(userId,{eventType:"release_channel.request.denied",channel,label,message:`Your request to join the ${label} channel was denied.`,severity:"warning"})}
        catch(notificationError){console.error("release channel rejection notification failed",notificationError)}
      }
      return Response.json(remote);
    }

    throw Object.assign(new Error("Unsupported release-channel action"),{status:400});
  }catch(e){return httpError(e)}
}
