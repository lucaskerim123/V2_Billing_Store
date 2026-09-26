import {masterRequest} from "@/lib/master-api";
import {licenseDb} from "@/lib/license-api";
import {httpError,requireOrbitAdmin} from "@/lib/orbitfs-deployment";

function normalize(r:any,override?:any){
  const m=r?.manifest&&typeof r.manifest==="object"?r.manifest:{};
  return {
    id:r.id,releaseId:r.id,version:r.version,channel:r.channel,releaseChannel:r.channel||"stable",status:r.status,
    reviewStatus:r.review_status,releaseType:r.release_type||r.releaseType,
    title:override?.title??m.title??`OrbitFS ${(r.release_type||r.releaseType)==="base"?"Base":"Update"} ${r.version}`,
    description:override?.description??m.description??r.description??null,
    changelog:override?.changelog??r.changelog??r.notes??null,
    customerNotes:override?.customer_notes??m.customer_notes??m.customerNotes??"",
    internalNotes:m.internal_notes||m.internalNotes||"",severity:m.severity||"normal",required:m.required===true,
    rollout:m.rollout||"public",minimumVersion:m.minimum_version||m.minimumVersion||null,
    rollbackVersion:m.rollback_version||m.rollbackVersion||null,components:Array.isArray(m.components)?m.components:[],
    sourceCommit:r.source_sha||r.source_commit||null,sourceRepo:r.source_repo||null,sourceRef:r.source_ref||null,
    artifactUrl:r.artifact_url||null,checksum:r.checksum||null,artifactName:r.artifact_name||null,
    artifactRepo:r.artifact_repo||null,artifactRunId:r.artifact_run_id||null,validation:m.validation||null,
    deliveryStatus:r.status==="published"?"published":r.review_status==="approved"?"approved":"pending",
    publishedAt:r.published_at||null,updatedAt:r.updated_at||null
  };
}

export async function GET(req:Request){
  try{
    await requireOrbitAdmin(req);
    const u=new URL(req.url),action=u.searchParams.get("action")||"review",type=u.searchParams.get("type")||"update",product=u.searchParams.get("product")||"orbitfs_base",channel=u.searchParams.get("channel")||"";
    const qs=new URLSearchParams({product});if(type&&type!=="all")qs.set("type",type);if(channel)qs.set("channel",channel);
    const [result,channelResult]=await Promise.all([
      masterRequest("/api/v1/releases?"+qs.toString(),{method:"GET"},"billing"),
      masterRequest("/api/v1/release-channels?include_disabled=true",{method:"GET"},"billing")
    ]);
    const rows=Array.isArray(result)?result:(Array.isArray(result?.releases)?result.releases:[]);
    let overrides:any[]=[];
    if(rows.some((r:any)=>String(r.release_type||r.releaseType)==="base")){
      const ids=rows.filter((r:any)=>String(r.release_type||r.releaseType)==="base").map((r:any)=>String(r.id));
      const query=await licenseDb().from("orbitfs_release_presentation_overrides").select("*").in("release_id",ids);
      if(!query.error)overrides=query.data||[];
    }
    const overrideMap=new Map(overrides.map((o:any)=>[String(o.release_id),o]));
    const releases=rows.map((r:any)=>normalize(r,overrideMap.get(String(r.id)))).filter((r:any)=>
      (type==="all"||r.releaseType===type)&&
      (action==="published"?r.status==="published":action==="history"?true:action==="review"?r.reviewStatus==="approved"&&r.status!=="published":true)
    );
    const channels=Array.isArray(channelResult?.channels)?channelResult.channels:[];
    return Response.json({releases,channels},{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}

export async function POST(req:Request){
  try{
    await requireOrbitAdmin(req);
    return Response.json({error:"Use License Manager for technical approval. Billing Store only performs customer-facing release publication and presentation."},{status:409});
  }catch(e){return httpError(e)}
}
