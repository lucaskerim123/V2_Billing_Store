import {masterPromoteRelease} from "@/lib/master-api";
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
    return Response.json(await masterPromoteRelease(id,target),{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}
