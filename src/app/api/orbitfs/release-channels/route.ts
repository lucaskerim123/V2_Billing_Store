import {licenseDb} from "@/lib/license-api";
import {masterRequest} from "@/lib/master-api";
import {httpError,requireOrbitUser} from "@/lib/orbitfs-deployment";
import {notifyChannelCustomer,notifyChannelRequestAdmins} from "@/lib/release-channel-notifications";

async function billingCustomerIdentity(userId:string){
  const db=licenseDb();
  const result=await db.from("customers").select("customer_number,name,email").or(`auth_user_id.eq.${userId},user_id.eq.${userId}`).limit(1).maybeSingle();
  if(result.error)throw result.error;
  const reference=String(result.data?.customer_number||"").trim();
  if(!reference)throw Object.assign(new Error("Billing customer number is required for release channel access"),{status:409,code:"CUSTOMER_REFERENCE_REQUIRED"});
  return {reference,name:String(result.data?.name||result.data?.email||reference)};
}
async function billingCustomerReference(userId:string){return (await billingCustomerIdentity(userId)).reference;}

export async function GET(req:Request){
  try{
    const {user}=await requireOrbitUser(req);
    const channelResult=await masterRequest("/api/v1/release-channels?include_disabled=false",{method:"GET",cache:"no-store"},"billing");
    const customerReference=await billingCustomerReference(user.id);
    async function snapshot(action:"list_requests"|"list_access"){
      try{
        return await masterRequest("/api/v1/release-channels/access",{method:"POST",body:JSON.stringify({action,external_reference:customerReference})},"billing");
      }catch(error:any){
        if(Number(error?.status)===403&&String(error?.code||"")==="ACTIVE_BASE_LICENSE_REQUIRED"){
          return action==="list_requests"?{requests:[]}:{access:[]};
        }
        throw error;
      }
    }
    const [requestResult,accessResult]=await Promise.all([snapshot("list_requests"),snapshot("list_access")]);
    const channels=Array.isArray(channelResult?.channels)?channelResult.channels.filter((x:any)=>x.enabled!==false&&x.customer_visible!==false):[];
    return Response.json({
      channels,
      requests:Array.isArray(requestResult?.requests)?requestResult.requests:[],
      access:Array.isArray(accessResult?.access)?accessResult.access:[],
      authority:"license_manager",
    },{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}

export async function POST(req:Request){
  try{
    const {user}=await requireOrbitUser(req);
    const body=await req.json().catch(()=>({}));
    const action=String(body.action||"").trim().toLowerCase();
    const channel=String(body.channel||"").trim().toLowerCase();
    if(!channel)throw Object.assign(new Error("Release channel is required"),{status:400});
    const customerIdentity=await billingCustomerIdentity(user.id);
    const customerReference=customerIdentity.reference;
    if(!["request","join","leave"].includes(action))throw Object.assign(new Error("Unsupported channel access action"),{status:400});
    const requestDetails=action==="request"&&body.requestDetails&&typeof body.requestDetails==="object"&&!Array.isArray(body.requestDetails)
      ?{
        use_case:String(body.requestDetails.use_case||body.requestDetails.useCase||"").trim().slice(0,500),
        environment:String(body.requestDetails.environment||"").trim().slice(0,80),
        notes:String(body.requestDetails.notes||"").trim().slice(0,500),
      }
      :undefined;
    if(action==="request"&&!requestDetails?.use_case)throw Object.assign(new Error("Tell us what you want to test in this channel"),{status:400});
    if(action==="request"&&!requestDetails?.environment)throw Object.assign(new Error("Choose the environment you plan to use"),{status:400});
    const result=await masterRequest("/api/v1/release-channels/access",{
      method:"POST",
      body:JSON.stringify({
        action:action==="leave"?"revoke":action,
        channel,
        external_reference:customerReference,
        ...(requestDetails?{request_details:requestDetails}:{})
      })
    },"billing");
    // License Manager is authoritative for channel access. Billing only publishes UI notifications after the authority succeeds.
    const label=channel.replace(/[-_]+/g," ").replace(/\b\w/g,m=>m.toUpperCase());
    try{
      if(action==="request"){
        await notifyChannelRequestAdmins({
          channel,label,customerName:customerIdentity.name,customerUserId:user.id,
          requestId:String(result?.request?.id||"")||null
        });
      }else if(action==="join"){
        await notifyChannelCustomer(user.id,{eventType:"release_channel.joined",channel,label,message:`You've joined the ${label} channel.`,severity:"success"});
      }else if(action==="leave"){
        await notifyChannelCustomer(user.id,{eventType:"release_channel.left",channel,label,message:`You've left the ${label} channel.`,severity:"info"});
      }
    }catch(notificationError){console.error("release channel notification failed",notificationError)}
    return Response.json(result,{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}
