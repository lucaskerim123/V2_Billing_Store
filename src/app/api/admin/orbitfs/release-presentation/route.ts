import {masterRequest} from "@/lib/master-api";
import {httpError,requireOrbitAdmin} from "@/lib/orbitfs-deployment";

const allowed=new Set(["title","description","changelog","customer_notes","internal_notes","severity","required","rollout","minimum_version","rollback_version"]);

export async function PATCH(req:Request){
  try{
    await requireOrbitAdmin(req);
    const body=await req.json().catch(()=>({}));
    const id=String(body.releaseId||body.id||"").trim();
    if(!id)throw Object.assign(new Error("Release ID is required"),{status:400});
    const current=await masterRequest(`/api/v1/releases/${encodeURIComponent(id)}`,{method:"GET"},"billing");
    if(String(current?.release?.release_type||"")!=="update")throw Object.assign(new Error("Billing Store can edit Update releases only"),{status:403});
    const patch:any={};
    for(const key of Object.keys(body)){if(allowed.has(key))patch[key]=body[key];}
    const result=await masterRequest(`/api/v1/releases/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify(patch)},"billing");
    return Response.json(result,{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}
