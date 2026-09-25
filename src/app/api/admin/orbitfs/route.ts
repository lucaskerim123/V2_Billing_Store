import {masterReleases} from "@/lib/master-api";
import {getLicenseMasterAvailability} from "@/lib/license-master-availability";
import {httpError,requireOrbitAdmin} from "@/lib/orbitfs-deployment";

function normalizeMaster(r:any){
  const m=r?.manifest&&typeof r.manifest==="object"?r.manifest:{};
  return {
    id:r.id,
    releaseId:r.id,
    version:String(r.version||""),
    channel:r.channel||"stable",
    status:r.status||"draft",
    review_status:r.review_status||"pending",
    reviewStatus:r.review_status||"pending",
    release_type:r.release_type||r.releaseType||"update",
    releaseType:r.release_type||r.releaseType||"update",
    title:m.title||`OrbitFS ${(r.release_type||r.releaseType)==="base"?"Base":"Update"} ${r.version}`,
    description:m.description||null,
    changelog:r.changelog||r.notes||null,
    customerNotes:m.customer_notes||m.customerNotes||"",
    internalNotes:m.internal_notes||m.internalNotes||"",
    severity:m.severity||"normal",
    required:m.required===true,
    rollout:m.rollout||"public",
    minimumVersion:m.minimum_version||m.minimumVersion||null,
    rollbackVersion:m.rollback_version||m.rollbackVersion||null,
    components:Array.isArray(m.components)?m.components:[],
    sourceCommit:r.source_sha||null,
    sourceRepo:r.source_repo||null,
    sourceRef:r.source_ref||null,
    checksum:r.checksum||null,
    artifactUrl:r.artifact_url||null,
    artifactName:r.artifact_name||null,
    artifactRunId:r.artifact_run_id||null,
    publishedAt:r.published_at||null,
    updatedAt:r.updated_at||r.created_at||null,
    validation:m.validation||null,
    archivedAt:r.archived_at||r.archivedAt||null
  };
}

export async function GET(req:Request){
  try{
    await requireOrbitAdmin(req);
    const [base,update,authority]=await Promise.all([
      masterReleases("orbitfs_base","all","base","billing"),
      masterReleases("orbitfs_base","all","update","billing"),
      getLicenseMasterAvailability()
    ]);
    const releases=[...(base?.releases||[]),...(update?.releases||[])]
      .map(normalizeMaster)
      .sort((a:any,b:any)=>String(b.publishedAt||b.updatedAt||"").localeCompare(String(a.publishedAt||a.updatedAt||"")));
    const latest=(releaseType:"base"|"update")=>releases.find((r:any)=>r.releaseType===releaseType&&r.status==="published"&&!r.archivedAt)||null;

    return Response.json({
      releases,
      latestBase:latest("base"),
      latestUpdate:latest("update"),
      authority:{
        source:"license_manager",
        reachable:authority.reachable,
        restricted:authority.restricted,
        release_enabled:authority.releaseAuthorityAvailable,
        deployment_enabled:authority.deploymentAuthorityAvailable,
        base_deployment_enabled:authority.baseDeploymentAvailable,
        update_deployment_enabled:authority.updateDeploymentAvailable,
        rollback_enabled:authority.rollbackAvailable,
        reason:authority.reason
      }
    },{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}

export async function POST(req:Request){
  try{
    await requireOrbitAdmin(req);
    return Response.json({
      error:"This compatibility route is read-only. Use the dedicated Billing final-review APIs; technical release state remains authoritative in License Manager.",
      code:"ORBITFS_ADMIN_MUTATION_ROUTE_RETIRED"
    },{status:410,headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}

export async function PATCH(req:Request){
  try{
    await requireOrbitAdmin(req);
    return Response.json({
      error:"This compatibility route is read-only. Use /api/admin/orbitfs/release-presentation for customer-facing review fields.",
      code:"ORBITFS_ADMIN_MUTATION_ROUTE_RETIRED"
    },{status:410,headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}
