import {masterRequest} from "@/lib/master-api";
import {licenseDb} from "@/lib/license-api";
import {httpError,requireOrbitAdmin} from "@/lib/orbitfs-deployment";

const presentation=new Set(["title","description","changelog","customer_notes"]);
const updateOnly=new Set(["internal_notes","severity","required","rollout","minimum_version","rollback_version"]);

export async function PATCH(req:Request){
  try{
    await requireOrbitAdmin(req);
    const body=await req.json().catch(()=>({}));
    const id=String(body.releaseId||body.id||"").trim();
    if(!id)throw Object.assign(new Error("Release ID is required"),{status:400});

    const current=await masterRequest("/api/v1/releases/"+encodeURIComponent(id),{method:"GET"},"billing");
    const release=current?.release;
    const type=String(release?.release_type||release?.releaseType||"").toLowerCase();
    if(type!=="base"&&type!=="update")throw Object.assign(new Error("Unsupported OrbitFS release type"),{status:403});

    if(type==="base"){
      const patch:any={release_id:id,release_type:"base",updated_at:new Date().toISOString()};
      for(const key of Object.keys(body))if(presentation.has(key))patch[key]=body[key]===undefined?null:body[key];
      if(Object.keys(patch).length===3)throw Object.assign(new Error("No editable customer-facing release fields were supplied"),{status:400});
      const db=licenseDb();
      const {data,error}=await db.from("orbitfs_release_presentation_overrides").upsert(patch,{onConflict:"release_id"}).select().single();
      if(error)throw error;
      return Response.json({release:{...release,presentation_override:data}},{headers:{"cache-control":"no-store"}});
    }

    const allowed=new Set([...presentation,...updateOnly]);
    const patch:any={};
    for(const key of Object.keys(body))if(allowed.has(key))patch[key]=body[key];
    if(!Object.keys(patch).length)throw Object.assign(new Error("No editable customer-facing release fields were supplied"),{status:400});
    const result=await masterRequest("/api/v1/releases/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify(patch)},"billing");
    return Response.json(result,{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}
