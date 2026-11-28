import { requireIntegrationAdmin, integrationErrorResponse, hasIntegrationPermission } from "@/lib/integrations/admin-context";
import { getMailModuleConfig, getMailRemoteIdentityConfig } from "@/integrations/Mailsystem/Data/config";
import { randomUUID, createPublicKey } from "node:crypto";
import type { RemoteStaffStatus, RemoteStaffSyncInput } from "@/integrations/Mailsystem/Data/remote-staff-types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const scheduled = typeof process !== "undefined" && !!process.env.CRON_SECRET && req.headers.get("authorization") === "Bearer " + process.env.CRON_SECRET;
    const { db, access } = scheduled ? await (async()=>{
      const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
      if(!url||!key)throw new Error("Scheduled directory storage unavailable.");
      const {createClient}=await import("@supabase/supabase-js");
      return {db:createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),access:null};
    })() : await requireIntegrationAdmin(req, ["integrations.manage", "integrations.mail.manage", "staff.view", "staff.manage", "staff.groups.view", "staff.groups.manage", "settings.permissions"]);
    if (!scheduled && !["integrations.manage", "integrations.mail.manage", "staff.view", "staff.manage", "staff.groups.view", "staff.groups.manage", "settings.permissions"].some((permission) => hasIntegrationPermission(access!, permission))) {
      throw Object.assign(new Error("Staff or integration management permission required."), { status: 403 });
    }
    const { data: state, error: stateError } = await db.from("app_integrations")
      .select("installed,enabled").eq("integration_id", "mailsystem").maybeSingle();
    if (stateError) throw Object.assign(new Error(stateError.message), { status: 503 });
    if (state?.installed !== true || state?.enabled !== true) {
      throw Object.assign(new Error("Install and enable Mail System before synchronising the directory."), { status: 409 });
    }

    const [{ data: snapshot, error: snapshotError }, { data: departments, error: departmentError }, { data: memberships, error: membershipError }] = await Promise.all([
      db.rpc(scheduled?"app_mail_staff_snapshot":"admin_get_staff_snapshot"),
      db.from("support_departments").select("id,name,slug,enabled").eq("enabled", true),
      db.from("support_department_staff").select("department_id,user_id"),
    ]);
    if (snapshotError || departmentError || membershipError) {
      throw Object.assign(new Error(snapshotError?.message || departmentError?.message || membershipError?.message || "Could not read Billing Store staff directory."), { status: 503 });
    }

    // Never reconcile an incomplete snapshot as an empty, authoritative directory.
    if (!Array.isArray(snapshot?.members) || !Array.isArray(snapshot?.groups) || !Array.isArray(departments) || !Array.isArray(memberships)) {
      throw Object.assign(new Error("Billing Store staff directory snapshot is incomplete; Mail System was not changed."), { status: 503 });
    }
    const members = snapshot.members;
    const groups = snapshot.groups;
    const supportedStatuses = new Set<RemoteStaffStatus>(["pending", "active", "on_leave", "suspended", "locked", "disabled", "terminated"]);
    const memberIds = new Set<string>();
    for (const member of members) {
      const userId = String(member?.user_id || member?.id || "").trim();
      if (!userId || memberIds.has(userId) || !supportedStatuses.has(member?.status)) {
        throw Object.assign(new Error("Billing Store staff directory contains an invalid or duplicate staff record; Mail System was not changed."), { status: 503 });
      }
      memberIds.add(userId);
    }
    const departmentRows = departments;
    const deptByUser = new Map<string, string[]>();
    for (const row of memberships || []) {
      const values = deptByUser.get(String(row.user_id)) || [];
      values.push(String(row.department_id));
      deptByUser.set(String(row.user_id), values);
    }
    const groupById = new Map(groups.map((group: any) => [String(group.id), group]));
    const roleCode = (member: any) => String(member.profile_role || member.primary_role || member.role || "staff").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
    const roleRows = [...new Map(members.map((member: any) => {
      const code = roleCode(member);
      return [code, { code, name: String(member.profile_role || member.primary_role || member.role || "Staff") }];
    })).values()];
    const departmentDirectory = departmentRows.map((item: any) => ({ code: String(item.slug || item.id), name: String(item.name) }));
    const groupDirectory = groups.map((item: any) => ({ code: String(item.slug || item.id), name: String(item.name || item.slug), permissions: Object.entries(item.permissions || {}).filter(([, enabled]) => enabled === true).map(([permission]) => permission) }));

    const config = await getMailModuleConfig();
    const identity = await getMailRemoteIdentityConfig();
    const publicJwk = createPublicKey(identity.privateKey).export({ format: "jwk" });
    const trustResponse = await fetch(config.baseUrl + "/api/integrations/remote-staff/register-key", {
      method: "POST", headers: { Authorization: "Bearer " + config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({kid: identity.keyId, issuer: identity.issuer, audience: identity.audience, public_jwk: publicJwk}), cache: "no-store",
    });
    const trustResult = await trustResponse.json().catch(() => ({}));
    if (!trustResponse.ok) throw Object.assign(new Error(trustResult.error?.message || trustResult.error || "Could not register the saved Mail System connection."), { status: trustResponse.status });
    const directoryResponse = await fetch(config.baseUrl + "/api/integrations/remote-staff/directory", {
      method: "POST",
      headers: { Authorization: "Bearer " + config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ roles: roleRows, departments: departmentDirectory, groups: groupDirectory }),
      cache: "no-store",
    });
    const directoryResult: any = await directoryResponse.json().catch(() => ({}));
    if (!directoryResponse.ok) {
      const detail = typeof directoryResult.error === "object" ? directoryResult.error.message : directoryResult.error;
      throw Object.assign(new Error(detail || "Mail System could not detect the Billing Store directory. Check that the API key includes remote:staff:sync."), { status: directoryResponse.status });
    }

    const sourceRevision = Date.now();
    const outcomes: any[] = [];
    for (const member of members) {
      const userId = String(member.user_id || member.id).trim();
      const groupCodes = (Array.isArray(member.group_ids) ? member.group_ids : [])
        .map((id: unknown) => groupById.get(String(id)))
        .filter(Boolean)
        .map((group: any) => String(group.slug || group.id));
      const departmentCodes = (deptByUser.get(userId) || [])
        .map((id) => departmentRows.find((item: any) => String(item.id) === id))
        .filter(Boolean)
        .map((item: any) => String(item.slug || item.id));
      const role = roleCode(member);
      const status: RemoteStaffStatus = member.status;
      const payload: RemoteStaffSyncInput = {
        event_id: "billing-directory-" + sourceRevision + "-" + userId,
        source_revision: sourceRevision,
        user: {
          external_user_id: userId,
          email: member.email || null,
          display_name: member.display_name || member.name || null,
          status,
          profile: { job_title: member.title || null, employee_number: member.employee_number || null },
          role_codes: [role],
          department_codes: departmentCodes,
          group_codes: groupCodes,
        },
      };
      const response = await fetch(config.baseUrl + "/api/integrations/remote-staff/sync", {
        method: "POST",
        headers: { Authorization: "Bearer " + config.apiKey, "Content-Type": "application/json", "Idempotency-Key": payload.event_id },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      const result: any = await response.json().catch(() => ({}));
      outcomes.push({ external_user_id: userId, ok: response.ok, status: response.status, result: response.ok ? result : (typeof result.error === "object" ? result.error.message : result.error) || "Sync failed" });
    }
    const failed = outcomes.filter((item) => !item.ok);
    let reconciliation: any = null;
    if (failed.length === 0) {
      const completeResponse = await fetch(config.baseUrl + "/api/integrations/remote-staff/directory", {
        method: "POST",
        headers: { Authorization: "Bearer " + config.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          roles: roleRows, departments: departmentDirectory, groups: groupDirectory,
          complete_snapshot: true, user_ids: [...memberIds],
        }),
        cache: "no-store",
      });
      reconciliation = await completeResponse.json().catch(() => ({}));
      if (!completeResponse.ok) failed.push({ external_user_id: "directory-reconcile", ok: false, status: completeResponse.status, result: reconciliation.error?.message || reconciliation.error || "Directory reconciliation failed" });
    }
    return Response.json({
      ok: failed.length === 0,
      directory: directoryResult.detected,
      users: { total: outcomes.length, synced: outcomes.filter((item) => item.ok).length, failed: outcomes.filter((item) => !item.ok).length },
      disabledRemoteUsers: reconciliation?.disabled_users || 0,
      failures: failed.slice(0, 20),
      event_id: randomUUID(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return integrationErrorResponse(error, "Unable to synchronise the Billing Store directory.");
  }
}
