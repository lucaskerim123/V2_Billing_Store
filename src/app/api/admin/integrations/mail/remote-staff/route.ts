import {randomUUID} from "node:crypto";
import {syncRemoteStaff,terminateRemoteStaff} from "@/integrations/mail/module";
import {requireIntegrationAdmin,integrationErrorResponse,hasIntegrationPermission} from "@/lib/integrations/admin-context";

type StaffMember=Record<string,any>;

async function loadBillingStaff(db:any){
  const {data:snapshot,error}=await db.rpc("admin_get_staff_snapshot");
  if(error)throw Object.assign(new Error(error.message),{status:403});
  const [{data:departments,error:departmentError},{data:assignments,error:assignmentError}]=await Promise.all([
    db.from("support_departments").select("id,slug,name"),
    db.from("support_department_staff").select("department_id,user_id")
  ]);
  if(departmentError)throw Object.assign(new Error(departmentError.message),{status:400});
  if(assignmentError)throw Object.assign(new Error(assignmentError.message),{status:400});
  const groups=new Map((snapshot?.groups||[]).map((g:any)=>[String(g.id),String(g.slug||g.name||"")]));
  const departmentMap=new Map((departments||[]).map((d:any)=>[String(d.id),String(d.slug||d.name||"")]));
  const byUser=new Map<string,string[]>();
  for(const row of assignments||[]){
    const list=byUser.get(String(row.user_id))||[];
    list.push(String(row.department_id));
    byUser.set(String(row.user_id),list);
  }
  return (snapshot?.members||[]).map((member:StaffMember)=>{
    const groupCodes=(Array.isArray(member.group_ids)?member.group_ids:[])
      .map((id:any)=>groups.get(String(id))).filter(Boolean);
    const departmentCodes=(byUser.get(String(member.user_id))||[])
      .map(id=>departmentMap.get(id)).filter(Boolean);
    return {
      external_user_id:String(member.user_id),
      email:String(member.email||"")||null,
      display_name:String(member.display_name||member.email||member.user_id),
      status:member.status==="active"?"active":"disabled",
      profile:{
        title:member.title||null,
        department:member.department||null,
        profile_role:member.profile_role||null
      },
      role_codes:member.profile_role?[String(member.profile_role)]:[],
      department_codes:departmentCodes,
      group_codes:groupCodes
    };
  });
}

export async function GET(req:Request){
  try{
    const {db,access}=await requireIntegrationAdmin(req,["integrations.view","integrations.manage"]);
    if(!hasIntegrationPermission(access,"staff.view")&&!hasIntegrationPermission(access,"staff.manage")&&!hasIntegrationPermission(access,"settings.permissions")){
      return Response.json({error:"Staff view permission is required for Remote Staff."},{status:403});
    }
    const staff=await loadBillingStaff(db);
    return Response.json({staff},{headers:{"cache-control":"no-store"}});
  }catch(error){return integrationErrorResponse(error,"Unable to load Billing staff for Mail System.");}
}

export async function POST(req:Request){
  try{
    const {db,user,access}=await requireIntegrationAdmin(req,["integrations.manage"]);
    if(!hasIntegrationPermission(access,"staff.view")&&!hasIntegrationPermission(access,"staff.manage")&&!hasIntegrationPermission(access,"settings.permissions")){
      return Response.json({error:"Staff view permission is required for Remote Staff."},{status:403});
    }
    const body=await req.json().catch(()=>({}));
    const action=String(body.action||"sync");
    const userId=String(body.external_user_id||"");
    if(!userId)return Response.json({error:"Billing staff user ID is required."},{status:400});
    if(action!=="sync"&&action!=="terminate")return Response.json({error:"Unsupported Remote Staff action."},{status:400});

    const staff=await loadBillingStaff(db);
    const person=staff.find((row:any)=>row.external_user_id===userId);
    if(!person)return Response.json({error:"Billing staff record was not found."},{status:404});

    const {data:prior,error:priorError}=await db.from("app_remote_staff_sync_state")
      .select("source_revision").eq("user_id",userId).maybeSingle();
    if(priorError)throw Object.assign(new Error(priorError.message),{status:503});
    const source_revision=Math.max(Date.now(),Number(prior?.source_revision||0)+1);
    const event_id=randomUUID();
    let result:any;
    if(action==="sync"){
      result=await syncRemoteStaff({
        event_id,
        source_revision,
        user:person
      });
    }else{
      result=await terminateRemoteStaff({
        event_id,
        external_user_id:userId,
        source_revision,
        reason:"Billing Store staff access terminated by an authorised administrator."
      });
    }

    const remoteStatus=action==="terminate"?"terminated":person.status;
    const {error:saveError}=await db.from("app_remote_staff_sync_state").upsert({
      user_id:userId,
      source_revision,
      last_event_id:event_id,
      remote_status:remoteStatus,
      last_synced_at:new Date().toISOString(),
      updated_at:new Date().toISOString()
    },{onConflict:"user_id"});
    if(saveError)throw Object.assign(new Error("Mail System accepted the request, but Billing Store could not save its sync receipt: "+saveError.message),{status:500});

    await db.from("admin_audit_log").insert({
      actor_id:user.id,
      action:action==="terminate"?"mail.remote_staff.terminated":"mail.remote_staff.synced",
      target_type:"staff_member",
      target_id:userId,
      detail:{event_id,source_revision,remote_status:remoteStatus}
    });
    return Response.json({ok:true,result},{headers:{"cache-control":"no-store"}});
  }catch(error){return integrationErrorResponse(error,"Remote Staff operation failed.");}
}
