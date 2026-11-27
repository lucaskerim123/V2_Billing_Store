import { requireIntegrationAdmin, integrationErrorResponse, hasIntegrationPermission } from "@/lib/integrations/admin-context";
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
    const authorization = req.headers.get("authorization") || "";
    const sync = await fetch(new URL("/api/admin/integrations/mailsystem/mail-directory", req.url), {
      method: "POST", headers: { authorization, "content-type": "application/json" }, cache: "no-store",
    });
    const syncResult: any = await sync.json().catch(() => ({}));
    if (!sync.ok) throw Object.assign(new Error(syncResult.error || "Could not synchronise the Billing Store directory."), { status: sync.status });

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
    return Response.json({ directory: { groups, departments: departmentRows, users }, core, sync: syncResult }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return integrationErrorResponse(error, "Unable to load Mail System access settings.");
  }
}

export async function PUT(req: Request) {
  try {
    await context(req);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "Access mapping configuration is required." }, { status: 400 });
    }
    const config = await getMailModuleConfig();
    let delegation: any = null;
    if (body.delegation && typeof body.delegation === "object") {
      delegation = await coreRequest(config.baseUrl, config.apiKey, "/api/integrations/remote-staff/delegation", "PUT", body.delegation);
    }
    const result = await coreRequest(config.baseUrl, config.apiKey, "/api/integrations/remote-staff/access-mappings", "PUT", {
      mappings: Array.isArray(body.mappings) ? body.mappings : [],
      permission_mappings: Array.isArray(body.permission_mappings) ? body.permission_mappings : [],
    });
    return Response.json({ ...result, delegation }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return integrationErrorResponse(error, "Unable to save Mail System access mappings.");
  }
}
