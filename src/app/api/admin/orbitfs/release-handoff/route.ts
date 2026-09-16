import {masterRequest} from "@/lib/master-api";
import {httpError,requireOrbitAdmin} from "@/lib/orbitfs-deployment";

function normalize(r:any){
  const manifest=r?.manifest&&typeof r.manifest==="object"?r.manifest:{};
  return {
    id:r.id,
    releaseId:r.id,
    version:r.version,
    channel:r.channel,
    status:r.status,
    releaseType:r.release_type||r.releaseType,
    title:manifest.title||`OrbitFS ${(r.release_type||r.releaseType)==='base'?'Base':'Update'} ${r.version}`,
    description:manifest.description||r.description||null,
    changelog:r.changelog||r.notes||null,
    customerNotes:manifest.customer_notes||manifest.customerNotes||"",
    internalNotes:manifest.internal_notes||manifest.internalNotes||"",
    severity:manifest.severity||"normal",
    required:manifest.required===true,
    rollout:manifest.rollout||"public",
    minimumVersion:manifest.minimum_version||manifest.minimumVersion||null,
    rollbackVersion:manifest.rollback_version||manifest.rollbackVersion||null,
    components:Array.isArray(manifest.components)?manifest.components:[],
    sourceCommit:r.source_sha||r.source_commit||null,
    sourceRepo:r.source_repo||null,
    sourceRef:r.source_ref||null,
    artifactUrl:r.artifact_url||null,
    checksum:r.checksum||null,
    artifactName:r.artifact_name||null,
    artifactRepo:r.artifact_repo||null,
    artifactRunId:r.artifact_run_id||null,
    validation:manifest.validation||null,
    deliveryStatus:r.status==="published"?"published":"pending",
    deliveryAttempts:0,
    deliveryError:null,
    publishedAt:r.published_at||null,
    updatedAt:r.updated_at||null
  };
}

export async function GET(req:Request){
  try{
    await requireOrbitAdmin(req);
    const u=new URL(req.url),action=u.searchParams.get("action")||"published";
    if(action!=="published"&&action!=="all")return Response.json({error:"Release publication is controlled by License Master"},{status:409});
    const result=await masterRequest("/api/releases",{method:"GET"},"billing");
    const rows=Array.isArray(result)?result:(Array.isArray(result?.releases)?result.releases:[]);
    const releases=rows.filter((r:any)=>action==="all"||r.status==="published").map(normalize);
    return Response.json({releases},{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}

export async function POST(req:Request){
  try{
    await requireOrbitAdmin(req);
    return Response.json({error:"Release publication is controlled by License Master. Review and publish the release in License Master first."},{status:409});
  }catch(e){return httpError(e)}
}
