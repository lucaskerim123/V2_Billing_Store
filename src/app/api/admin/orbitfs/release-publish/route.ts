import {masterRequest} from "@/lib/master-api";
import {httpError,requireOrbitAdmin} from "@/lib/orbitfs-deployment";

export async function POST(req:Request){try{await requireOrbitAdmin(req);const body=await req.json().catch(()=>({}));const id=String(body.releaseId||body.id||"").trim();if(!id)throw Object.assign(new Error("Release ID is required"),{status:400});const result=await masterRequest(`/api/v1/releases/${encodeURIComponent(id)}/publish`,{method:"POST",body:"{}"},"billing");return Response.json(result,{headers:{"cache-control":"no-store"}})}catch(e){return httpError(e)}}
