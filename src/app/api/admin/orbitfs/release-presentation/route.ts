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

    const presentationPatch:any={release_id:id,release_type:type,updated_at:new Date().toISOString()};
    for(const key of Object.keys(body))if(presentation.has(key))presentationPatch[key]=body[key]===undefined?null:body[key];
    let presentationOverride:any=null;
    if(Object.keys(presentationPatch).length>3){
      const db=licenseDb();
      const {data,error}=await db.from("orbitfs_release_presentation_overrides").upsert(presentationPatch,{onConflict:"release_id"}).select().single();
      if(error)throw error;
      presentationOverride=data;
    }

    if(type==="base"){
      if(!presentationOverride)throw Object.assign(new Error("No editable customer-facing release fields were supplied"),{status:400});
      return Response.json({release:{...release,presentation_override:presentationOverride}},{headers:{"cache-control":"no-store"}});
    }

    const technicalPatch:any={};
    for(const key of Object.keys(body))if(updateOnly.has(key))technicalPatch[key]=body[key];
    let result:any={release};
    if(Object.keys(technicalPatch).length){
      result=await masterRequest("/api/v1/releases/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify(technicalPatch)},"billing");
    }
    if(!presentationOverride&&!Object.keys(technicalPatch).length)throw Object.assign(new Error("No editable customer-facing release fields were supplied"),{status:400});
    return Response.json({...(result||{}),release:{...(result?.release||release),presentation_override:presentationOverride}},{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}
