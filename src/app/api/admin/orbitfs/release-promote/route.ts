import {masterPromoteRelease,masterRequest} from "@/lib/master-api";
import {httpError,requireOrbitAdmin} from "@/lib/orbitfs-deployment";

export async function POST(req:Request){
  try{
    await requireOrbitAdmin(req);
    const body=await req.json().catch(()=>({}));
    const id=String(body.releaseId||body.id||"").trim();
    const target=String(body.targetChannel||body.target_channel||"").trim().toLowerCase();
    if(!id)throw Object.assign(new Error("Release ID is required"),{status:400});
    if(!target)throw Object.assign(new Error("Target release channel is required"),{status:400});
    if(!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(target))throw Object.assign(new Error("Invalid release channel"),{status:400});
    const [current,channelResult]=await Promise.all([
      masterRequest(`/api/v1/releases/${encodeURIComponent(id)}`,{method:"GET"},"billing"),
      masterRequest("/api/v1/release-channels?include_disabled=true",{method:"GET"},"billing")
    ]);
    const releaseType=String(current?.release?.release_type||"").toLowerCase();
    if(!["base","update"].includes(releaseType))throw Object.assign(new Error("Unsupported OrbitFS release type"),{status:403});
    if(String(current?.release?.review_status||"")!=="approved")throw Object.assign(new Error("License Manager technical approval is required before changing release channel"),{status:409});
    if(String(current?.release?.manifest?.validation?.status||"")!=="passed")throw Object.assign(new Error("License Manager validation must pass before changing release channel"),{status:409});
    const channels=Array.isArray(channelResult?.channels)?channelResult.channels:[];
    const channel=channels.find((c:any)=>String(c.channel||"").toLowerCase()===target);
    if(!channel||channel.enabled===false||channel.customer_visible===false)throw Object.assign(new Error("Target channel is not enabled for customer publication"),{status:409});
    return Response.json(await masterPromoteRelease(id,target),{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}
