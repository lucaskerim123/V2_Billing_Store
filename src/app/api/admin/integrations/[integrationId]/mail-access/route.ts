import { requireIntegrationAdmin, integrationErrorResponse, hasIntegrationPermission } from "@/lib/integrations/admin-context";
import { createClient } from "@supabase/supabase-js";
import { getMailModuleConfig } from "@/integrations/Mailsystem/Data/config";

export const runtime = "nodejs";

async function context(req: Request) {
  const { db, access } = await requireIntegrationAdmin(req, [
    "integrations.manage", "integrations.mail.manage", "staff.view", "staff.manage",
    "staff.groups.view", "staff.groups.manage", "settings.permissions",
  ]);
  const allowed = ["integrations.manage", "integrations.mail.manage", "staff.view", "staff.manage", "staff.groups.view", "staff.groups.manage", "settings.permissions"]
    .some((permission) => hasIntegrationPermission(access, permission));
  if (!allowed) throw Object.assign(new Error("Mail integration or staff directory permission required."), { status: 403 });
  const { data: state, error } = await db.from("app_integrations").select("installed,enabled")
    .eq("integration_id", "mailsystem").maybeSingle();
  if (error) throw Object.assign(new Error(error.message), { status: 503 });
  if (state?.installed !== true || state?.enabled !== true) {
    throw Object.assign(new Error("Install, connect and enable Mail System in Integration Manager first."), { status: 409 });
  }
  return { db, access };
}

async function coreRequest(baseUrl: string, apiKey: string, path: string, method = "GET", body?: unknown) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
  });
  const result: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof result.error === "object" ? result.error.message : result.error;
    throw Object.assign(new Error(detail || "Mail System Core request failed."), { status: response.status });
  }
  return result;
}

export async function GET(req: Request) {
  try {
    const { db } = await context(req);


    const [{ data: snapshot, error: snapshotError }, { data: departments, error: departmentError }, { data: departmentStaff, error: departmentStaffError }] = await Promise.all([
      db.rpc("admin_get_staff_snapshot"),
      db.from("support_departments").select("id,name,slug,enabled").eq("enabled", true).order("name"),
      db.from("support_department_staff").select("department_id,user_id"),
    ]);
    if (snapshotError || departmentError || departmentStaffError) {
      throw Object.assign(new Error(snapshotError?.message || departmentError?.message || departmentStaffError?.message || "Could not load Billing Store directory."), { status: 503 });
    }
    const groups = Array.isArray(snapshot?.groups) ? snapshot.groups.map((group: any) => ({
      id: String(group.id), code: String(group.slug || group.id), name: String(group.name || group.slug),
      permissions: Object.entries(group.permissions || {}).filter(([, enabled]) => enabled === true).map(([permission]) => permission),
    })) : [];
    const departmentRows = Array.isArray(departments) ? departments.map((department: any) => ({
      id: String(department.id), code: String(department.slug || department.id), name: String(department.name),
    })) : [];
    const groupById = new Map(groups.map((group: any) => [group.id, group]));
    const departmentsByUser = new Map<string, string[]>();
    for (const row of departmentStaff || []) {
      const list = departmentsByUser.get(String(row.user_id)) || [];
      list.push(String(row.department_id));
      departmentsByUser.set(String(row.user_id), list);
    }
    const users = (Array.isArray(snapshot?.members) ? snapshot.members : []).map((member: any) => ({
      id: String(member.user_id),
      email: member.email || "",
      display_name: member.display_name || member.name || member.email || member.user_id,
      status: member.status || "active",
      role: member.profile_role || "staff",
      group_codes: (Array.isArray(member.group_ids) ? member.group_ids : []).map((id: unknown) => groupById.get(String(id))).filter(Boolean).map((group: any) => group.code),
      department_codes: (departmentsByUser.get(String(member.user_id)) || []).map((id) => departmentRows.find((department: any) => department.id === id)).filter(Boolean).map((department: any) => department.code),
    }));
    const config = await getMailModuleConfig();
    const core = await coreRequest(config.baseUrl, config.apiKey, "/api/integrations/remote-staff/access-catalogue");
    const {data:rules,error:rulesError}=await serviceDb().from("app_mail_settings").select("key,value").like("key","host_access_rule:%");
    if(rulesError)throw rulesError;
    return Response.json({ directory: { groups, departments: departmentRows, users }, core, rules:(rules||[]).map(row=>row.value) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return integrationErrorResponse(error, "Unable to load Mail System access settings.");
  }
}

function serviceDb(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw Object.assign(new Error("Mail configuration storage unavailable."),{status:503});
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function PUT(req:Request){
 try{
  await requireIntegrationAdmin(req,["integrations.manage","integrations.mail.manage"]);
  await context(req);
  const body=await req.json().catch(()=>null);
  if(!Array.isArray(body?.rules)||body.rules.length>500)throw Object.assign(new Error("Provide up to 500 access rules."),{status:400});
  const rules=body.rules.map((rule:any)=>{
   if(!["group","department","role","user"].includes(rule?.selector_type)||typeof rule.selector_code!=="string"||!rule.selector_code.trim()||rule.selector_code.length>255||typeof rule.mailbox_id!=="string"||!/^[0-9a-f-]{36}$/i.test(rule.mailbox_id)||!Array.isArray(rule.capabilities)||rule.capabilities.some((cap:unknown)=>!["mail.read","mail.send","mail.update","mail.delete","mail.manage_members","mail.manage_settings"].includes(String(cap))))throw Object.assign(new Error("Invalid access rule."),{status:400});
   return {mailbox_id:rule.mailbox_id,selector_type:rule.selector_type,selector_code:rule.selector_code.trim(),capabilities:[...new Set<string>(rule.capabilities)]};
  });
  const config=await getMailModuleConfig();
  const result=await coreRequest(config.baseUrl,config.apiKey,"/api/integrations/remote-staff/access-mappings","PUT",{rules});
  const db=serviceDb();
  if(rules.length){
   const {error}=await db.from("app_mail_settings").upsert(rules.map((rule:any)=>({key:"host_access_rule:"+rule.selector_type+":"+encodeURIComponent(rule.selector_code)+":"+rule.mailbox_id,value:rule})),{onConflict:"key"});
   if(error)throw error;
  }
  const sync=await fetch(new URL("/api/admin/integrations/mailsystem/mail-directory",req.url),{method:"POST",headers:{authorization:req.headers.get("authorization")||"","content-type":"application/json"},cache:"no-store"});
  const syncResult=await sync.json().catch(()=>({}));
  return Response.json({ok:sync.ok&&syncResult.ok!==false,saved:true,core:result,sync:syncResult},{status:sync.ok&&syncResult.ok!==false?200:409,headers:{"cache-control":"no-store"}});
 }catch(error){return integrationErrorResponse(error,"Unable to save mailbox access.");}
}
