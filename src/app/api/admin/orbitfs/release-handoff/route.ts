import {masterRequest} from "@/lib/master-api";
import {httpError,requireOrbitAdmin} from "@/lib/orbitfs-deployment";

export async function GET(req:Request){
  try{
    await requireOrbitAdmin(req);
    const u=new URL(req.url),action=u.searchParams.get("action")||"published";
    if(action!=="published"&&action!=="all")return Response.json({error:"Release publication is controlled by License Master"},{status:409});
    const result=await masterRequest("/api/releases",{method:"GET"},"billing");
    // License Master returns { releases: [...] }; accept the legacy array shape too.
    const rows=Array.isArray(result)?result:(Array.isArray(result?.releases)?result.releases:[]);
    const releases=rows.filter((r:any)=>action==="all"||r.status==="published").map((r:any)=>({
      id:r.id,
      version:r.version,
      channel:r.channel,
      status:r.status,
      releaseType:r.release_type||r.releaseType,
      title:`OrbitFS ${(r.release_type||r.releaseType)==='base'?'Base':'Update'} ${r.version}`,
      description:r.notes||r.description||null,
      changelog:r.changelog||r.notes||null,
      sourceCommit:r.source_sha||r.source_commit||null,
      sourceRepo:r.source_repo||null,
      sourceRef:r.source_ref||null,
      artifactUrl:r.artifact_url||null,
      checksum:r.checksum||null,
      artifactName:r.artifact_name||null,
      artifactRepo:r.artifact_repo||null,
      artifactRunId:r.artifact_run_id||null,
      deliveryStatus:r.status==="published"?"published":"pending",
      deliveryAttempts:0,
      deliveryError:null,
      publishedAt:r.published_at||null,
      updatedAt:r.updated_at||null
    }));
    return Response.json({releases},{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}

export async function POST(req:Request){
  try{
    await requireOrbitAdmin(req);
    return Response.json({error:"Release publication is controlled by License Master. Review and publish the release in License Master first."},{status:409});
  }catch(e){return httpError(e)}
}
