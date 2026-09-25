import {masterRequest} from "@/lib/master-api";
import {httpError,requireOrbitAdmin} from "@/lib/orbitfs-deployment";

export async function POST(req:Request){
  try{
    await requireOrbitAdmin(req);
    const body=await req.json().catch(()=>({}));
    const id=String(body.releaseId||body.id||"").trim();
    if(!id)throw Object.assign(new Error("Release ID is required"),{status:400});

    const [current,channelResult]=await Promise.all([
      masterRequest(`/api/v1/releases/${encodeURIComponent(id)}`,{method:"GET"},"billing"),
      masterRequest("/api/v1/release-channels?include_disabled=true",{method:"GET"},"billing")
    ]);
    const release=current?.release;
    if(String(release?.release_type||"")!=="update")throw Object.assign(new Error("Billing Store can publish Update releases only"),{status:403});
    if(String(release?.review_status||"")!=="approved")throw Object.assign(new Error("License Manager technical approval is required before final publication"),{status:409});
    if(String(release?.manifest?.validation?.status||"")!=="passed")throw Object.assign(new Error("License Manager validation must pass before final publication"),{status:409});
    if(!String(release?.checksum||"").trim())throw Object.assign(new Error("Release artifact checksum is missing"),{status:409});

    const channelName=String(release?.channel||"").trim().toLowerCase();
    const channels=Array.isArray(channelResult?.channels)?channelResult.channels:[];
    const channel=channels.find((c:any)=>String(c.channel||"").trim().toLowerCase()===channelName);
    if(!channel||channel.enabled===false||channel.customer_visible===false)throw Object.assign(new Error("Select an enabled customer-visible release channel before publishing"),{status:409});

    const manifest=release?.manifest&&typeof release.manifest==="object"?release.manifest:{};
    const title=String(manifest.title||"").trim();
    const changelog=String(release?.notes||release?.changelog||"").trim();
    if(!title)throw Object.assign(new Error("Add a customer-facing release title before publishing"),{status:409});
    if(!changelog)throw Object.assign(new Error("Add a customer-facing changelog before publishing"),{status:409});
    if(String(manifest.rollout||"public").toLowerCase()==="internal")throw Object.assign(new Error("Internal rollout cannot be published to the customer portal"),{status:409});

    const result=await masterRequest(`/api/v1/releases/${encodeURIComponent(id)}`,{method:"POST",body:JSON.stringify({action:"publish"})},"billing");
    return Response.json(result,{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}
