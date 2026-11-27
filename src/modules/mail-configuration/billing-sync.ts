import "server-only";
import {randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {syncRemoteStaff,terminateRemoteStaff} from "./remote-staff";
import type {RemoteStaffState} from "./remote-staff-types";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||"";

function serviceDb(){
  if(!url||!serviceKey)throw new Error("Billing service database is not configured.");
  return createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
}
function statusOf(value:string):RemoteStaffState["status"]{
  if(value==="active")return "active";
  if(value==="terminated")return "terminated";
  if(value==="on_leave"||value==="suspended"||value==="locked"||value==="pending")return value;
  return "disabled";
}
function code(value:string){return value.trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,80)}

export async function listBillingRemoteStaff():Promise<RemoteStaffState[]>{
  const db=serviceDb();
  const {data:staff,error}=await db.from("staff_members").select("user_id,status,title,department").order("created_at",{ascending:false});
  if(error)throw error;
  const ids=(staff||[]).map((x:any)=>String(x.user_id)).filter(Boolean);
  if(!ids.length)return [];
  const [membershipResult,departmentResult,groupResult,deptResult,profileResult,customerResult]=await Promise.all([
    db.from("staff_member_groups").select("user_id,group_id,is_primary").in("user_id",ids),
    db.from("support_department_staff").select("user_id,department_id").in("user_id",ids),
    db.from("staff_groups").select("id,slug,name"),
    db.from("support_departments").select("id,slug,name"),
    db.from("user_profiles").select("id,display_name,first_name,last_name").in("id",ids),
    db.from("customers").select("auth_user_id,email,name").in("auth_user_id",ids)
  ]);
  for(const result of [membershipResult,departmentResult,groupResult,deptResult,profileResult,customerResult])if(result.error)throw result.error;
  const groups=new Map((groupResult.data||[]).map((x:any)=>[String(x.id),x]));
  const departments=new Map((deptResult.data||[]).map((x:any)=>[String(x.id),x]));
  const profiles=new Map((profileResult.data||[]).map((x:any)=>[String(x.id),x]));
  const customers=new Map((customerResult.data||[]).map((x:any)=>[String(x.auth_user_id),x]));
  return (staff||[]).map((person:any)=>{
    const id=String(person.user_id);
    const memberships=(membershipResult.data||[]).filter((x:any)=>String(x.user_id)===id)
      .sort((a:any,b:any)=>Number(!!b.is_primary)-Number(!!a.is_primary));
    const groupRows=memberships.map((x:any)=>groups.get(String(x.group_id))).filter(Boolean) as any[];
    const departmentRows=(departmentResult.data||[]).filter((x:any)=>String(x.user_id)===id)
      .map((x:any)=>departments.get(String(x.department_id))).filter(Boolean) as any[];
    const profile:any=profiles.get(id)||{},customer:any=customers.get(id)||{};
    const displayName=profile.display_name||[profile.first_name,profile.last_name].filter(Boolean).join(" ")||customer.name||id;
    const departmentCodes=departmentRows.map((x:any)=>String(x.slug||code(x.name||""))).filter(Boolean);
    if(!departmentCodes.length&&person.department)departmentCodes.push(code(String(person.department)));
    return {
      external_user_id:id,
      email:customer.email||null,
      display_name:displayName,
      status:statusOf(String(person.status||"disabled")),
      profile:{title:person.title||null,department:person.department||null},
      role_codes:groupRows.slice(0,1).map((x:any)=>String(x.slug)),
      group_codes:groupRows.map((x:any)=>String(x.slug)),
      department_codes:departmentCodes
    } as RemoteStaffState;
  });
}

async function nextRevision(userId:string){
  const {data,error}=await serviceDb().rpc("app_mail_next_remote_staff_revision",{p_user_id:userId});
  if(error)throw new Error("Remote Staff revision store is unavailable. Apply the Billing mail module database migration first. "+error.message);
  const revision=Number(data);
  if(!Number.isSafeInteger(revision)||revision<1)throw new Error("Remote Staff revision counter returned an invalid value.");
  return revision;
}

export async function syncBillingRemoteStaff(userId:string){
  if(!process.env.MAIL_SYSTEM_URL||!process.env.MAIL_SYSTEM_API_KEY)return {skipped:true as const,reason:"Mail System connection is not configured."};
  const staff=(await listBillingRemoteStaff()).find(x=>x.external_user_id===userId);
  if(!staff)return {skipped:true as const,reason:"Billing staff record no longer exists."};
  if(staff.status==="terminated")return terminateBillingRemoteStaff(userId,"Billing staff record marked terminated");
  const source_revision=await nextRevision(userId);
  return syncRemoteStaff({event_id:randomUUID(),source_revision,user:staff});
}

export async function terminateBillingRemoteStaff(userId:string,reason="Billing staff access removed"){
  if(!process.env.MAIL_SYSTEM_URL||!process.env.MAIL_SYSTEM_API_KEY)return {skipped:true as const,reason:"Mail System connection is not configured."};
  const source_revision=await nextRevision(userId);
  return terminateRemoteStaff({event_id:randomUUID(),external_user_id:userId,source_revision,reason});
}
