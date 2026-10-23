import {createClient} from "@supabase/supabase-js";
type DeploymentReport={phase?:string;action?:string;userRef?:string;installationId?:string;releaseId?:string;deploymentId?:string;productVersion?:string;error?:string};
const uuid=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
// Billing only emits communication after License Administration has accepted the result report.
// This helper must never authorize or execute deployments.
export async function notifyRecordedDeployment(report:DeploymentReport){
 const phase=String(report.phase||"").toLowerCase();
 if(!["completed","failed"].includes(phase)||!uuid.test(String(report.userRef||"")))return;
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new Error("Billing notification database unavailable");
 const db=createClient(url,key,{auth:{persistSession:false}});
 const action=String(report.action||"deployment").replace(/_/g," ");
 const success=phase==="completed";
 const eventType=success?"deployment.succeeded":"deployment.failed";
 const title=success?`${action} completed`:`${action} failed`;
 const message=success?`OrbitFS ${action} completed successfully${report.productVersion?" (version "+report.productVersion+")":""}.`:`OrbitFS ${action} could not be completed. Open the installation for details.`;
 const source=String(report.installationId||report.releaseId||"unknown");
 const dedupe=`${eventType}:${report.action||""}:${source}:${report.deploymentId||report.releaseId||"none"}`;
 const emit=async(userId:string,surface:"portal"|"admin")=>{
  const {error}=await db.rpc("notification_emit",{p_recipient_user_id:userId,p_surface:surface,p_category:"deployment",p_event_type:eventType,p_title:title,p_message:message,p_severity:success?"success":"error",p_source_type:"authoritative_deployment_report",p_source_id:source,p_action_url:surface==="admin"?"/admin/orbitfs/installations":"/portal/orbitfs",p_metadata:{kind:"notification",authority:"license_administration",report_phase:phase,action:report.action},p_dedupe_key:dedupe});
  if(error)throw error;
 };
 await emit(report.userRef!,"portal");
 const {data:staff,error:se}=await db.from("staff_members").select("user_id,status").eq("status","active");
 if(se)throw se;
 const ids=(staff||[]).map(row=>row.user_id);
 if(!ids.length)return;
 const {data:memberships,error:me}=await db.from("staff_member_groups").select("user_id,staff_groups(slug,permissions)").in("user_id",ids);
 if(me)throw me;
 const recipients=new Set<string>();
 for(const row of memberships||[]){
  const group:any=row.staff_groups;
  if(group?.slug==="superadmin"||group?.permissions?.all===true||group?.permissions?.["licenses.view"]===true)recipients.add(row.user_id);
 }
 for(const id of recipients)await emit(id,"admin");
}
