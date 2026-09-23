import {masterRequest} from "@/lib/master-api";
import {httpError,requireOrbitAdmin} from "@/lib/orbitfs-deployment";

const allowed=new Set(["publish","withdraw","rollback","archive","restore","delete","approve","reject","promote","revise"]);
export async function POST(req:Request){
  try{
    await requireOrbitAdmin(req);
    const body=await req.json().catch(()=>({}));
    const id=String(body.releaseId||body.id||"").trim();
    const action=String(body.action||"").trim().toLowerCase();
    if(!id)throw Object.assign(new Error("Release ID is required"),{status:400});
    if(!allowed.has(action))throw Object.assign(new Error("Unsupported release control"),{status:400});
    const payload:any={action};
    if(action==="promote")payload.target_channel=String(body.targetChannel||body.target_channel||"").trim().toLowerCase();
    if(action==="reject"&&body.reason)payload.reason=String(body.reason);
    if(action==="revise"){for(const key of ["title","description","changelog","customer_notes","internal_notes","severity","required","rollout","minimum_version","rollback_version"]){if(Object.prototype.hasOwnProperty.call(body,key))payload[key]=body[key];}}
    return Response.json(await masterRequest(`/api/v1/releases/${encodeURIComponent(id)}`,{method:"POST",body:JSON.stringify(payload)},"billing"),{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}
