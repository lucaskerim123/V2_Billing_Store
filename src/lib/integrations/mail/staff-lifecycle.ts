import {randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {syncRemoteStaff,terminateRemoteStaff} from "@/integrations/mail/module";

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||"";

function serviceClient(){
  if(!SUPABASE_URL||!SERVICE_KEY)throw new Error("Billing Store service database credentials are missing.");
  return createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}

async function enabledServiceClient(){
  if(!SUPABASE_URL||!SERVICE_KEY||!process.env.MAIL_SYSTEM_URL||!process.env.MAIL_SYSTEM_API_KEY)return null;
  const service=serviceClient();
  const {data,error}=await service.from("app_integrations").select("installed,enabled").eq("integration_id","mail").maybeSingle();
  if(error)throw new Error("Mail integration state unavailable: "+error.message);
  return data?.installed&&data?.enabled?service:null;
}

async function billingStaffSnapshot(db:any){
  const {data:snapshot,error}=await db.rpc("admin_get_staff_snapshot");
  if(error)throw new Error("Billing staff snapshot unavailable: "+error.message);
  const [{data:departments,error:de},{data:assignments,error:ae}]=await Promise.all([
    db.from("support_departments").select("id,slug,name"),
    db.from("support_department_staff").select("department_id,user_id")
  ]);
  if(de)throw new Error(de.message);
  if(ae)throw new Error(ae.message);
  const groups: Array<{id:unknown;slug?:unknown;name?:unknown}> = Array.isArray(snapshot?.groups) ? snapshot.groups : [];
  const groupSlugs = new Map<string,string>(groups.map((group):[string,string]=>[String(group.id),String(group.slug||group.name||"")]));
  const departmentSlugs=new Map<string,string>((departments||[]).map((department:any):[string,string]=>[String(department.id),String(department.slug||department.name||"")]));
  const departmentIds=new Map<string,string[]>();
  for(const row of assignments||[]){
    const list=departmentIds.get(String(row.user_id))||[];
    list.push(String(row.department_id));
    departmentIds.set(String(row.user_id),list);
  }
  return (snapshot?.members||[]).map((member:any)=>({
    external_user_id:String(member.user_id),
    email:String(member.email||"")||null,
    display_name:String(member.display_name||member.email||member.user_id),
    status:member.status==="active"?"active":"disabled",
    profile:{title:member.title||null,department:member.department||null,profile_role:member.profile_role||null},
    role_codes:member.profile_role?[String(member.profile_role)]:[],
    department_codes:(departmentIds.get(String(member.user_id))||[]).flatMap((id:string):string[]=>{const code=departmentSlugs.get(id);return code?[code]:[]}),
    group_codes:(Array.isArray(member.group_ids)?(member.group_ids as unknown[]):[]).flatMap((id:unknown):string[]=>{const code=groupSlugs.get(String(id));return code?[code]:[]})
  }));
}

async function nextRevision(service:any,userId:string){
  const {data,error}=await service.rpc("app_mail_next_remote_staff_revision",{p_user_id:userId});
  if(error)throw new Error("Remote Staff revision allocation failed: "+error.message);
  const revision=Number(data);
  if(!Number.isSafeInteger(revision)||revision<1)throw new Error("Remote Staff revision allocator returned an invalid revision.");
  return revision;
}

async function saveReceipt(service:any,userId:string,revision:number,eventId:string,status:string){
  const now=new Date().toISOString();
  const {error}=await service.from("app_remote_staff_sync_state").upsert({
    user_id:userId,source_revision:revision,last_event_id:eventId,
    remote_status:status,last_synced_at:now,updated_at:now
  },{onConflict:"user_id"});
  if(error)throw new Error("Remote Staff sync receipt could not be saved: "+error.message);
}

export async function syncBillingStaffToMail(db:any,userId:string){
  const service=await enabledServiceClient();
  if(!service)return {ok:true,skipped:true,reason:"mail_integration_disabled_or_not_configured"};
  const staff=await billingStaffSnapshot(db);
  const person=staff.find((row:any)=>row.external_user_id===userId);
  if(!person)return {ok:true,skipped:true,reason:"billing_staff_record_not_found"};
  const revision=await nextRevision(service,userId);
  const eventId=randomUUID();
  const result=await syncRemoteStaff({event_id:eventId,source_revision:revision,user:person});
  await saveReceipt(service,userId,revision,eventId,person.status);
  try{await db.from("admin_audit_log").insert({actor_id:(await db.auth.getUser()).data?.user?.id||null,action:"mail.remote_staff.auto_synced",target_type:"staff_member",target_id:userId,detail:{event_id:eventId,source_revision:revision}})}catch{}
  return {ok:true,result};
}

export async function terminateBillingStaffInMail(db:any,userId:string){
  const service=await enabledServiceClient();
  if(!service)return {ok:true,skipped:true,reason:"mail_integration_disabled_or_not_configured"};
  const revision=await nextRevision(service,userId);
  const eventId=randomUUID();
  const result=await terminateRemoteStaff({
    event_id:eventId,external_user_id:userId,source_revision:revision,
    reason:"Billing Store staff access removed by an authorised administrator."
  });
  await saveReceipt(service,userId,revision,eventId,"terminated");
  try{await db.from("admin_audit_log").insert({actor_id:(await db.auth.getUser()).data?.user?.id||null,action:"mail.remote_staff.auto_terminated",target_type:"staff_member",target_id:userId,detail:{event_id:eventId,source_revision:revision}})}catch{}
  return {ok:true,result};
}

export async function syncBillingStaffGroupToMail(db:any,groupId:string){
  const {data:rows,error}=await db.from("staff_member_groups").select("user_id").eq("group_id",groupId);
  if(error)throw new Error("Could not load staff group members for Mail sync: "+error.message);
  const ids=[...new Set((rows||[]).map((row:any)=>String(row.user_id)))];
  const results:any[]=[];
  const failures:string[]=[];
  for(const userId of ids){
    try{results.push(await syncBillingStaffToMail(db,userId))}
    catch(error){failures.push(error instanceof Error?error.message:"Remote Staff sync failed for "+userId)}
  }
  if(failures.length)throw new Error(failures.join("; "));
  return {ok:true,processed:results.length,results};
}
