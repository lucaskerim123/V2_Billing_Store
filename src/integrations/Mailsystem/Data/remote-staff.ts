import { createSign, randomUUID } from "node:crypto";
import { getMailModuleConfig, getMailRemoteIdentityConfig } from "./config";
import type { RemoteStaffSession, RemoteStaffSyncInput, RemoteStaffSyncResult } from "./remote-staff-types";

export class RemoteStaffApiError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code?: string) { super(message); this.name = "RemoteStaffApiError"; }
}
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

export async function createRemoteActorAssertion(externalUserId: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const subject = String(externalUserId || "").trim();
  if (!subject) throw new Error("externalUserId is required.");
  const config = await getMailRemoteIdentityConfig();
  const header = encode({ alg: "RS256", typ: "JWT", kid: config.keyId });
  const claims = encode({ iss: config.issuer, aud: config.audience, sub: subject, iat: nowSeconds, exp: nowSeconds + 120, jti: randomUUID() });
  const signingInput = header + "." + claims;
  const signer = createSign("RSA-SHA256"); signer.update(signingInput); signer.end();
  return signingInput + "." + signer.sign(config.privateKey).toString("base64url");
}
async function request<T>(path: string, token: string, init: RequestInit = {}) {
  const config = await getMailModuleConfig();
  let response: Response;
  try {
    response = await fetch(config.baseUrl + path, {
      ...init,
      headers: { Authorization: "Bearer " + token, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
      cache: "no-store",
    });
  } catch (error) { throw new RemoteStaffApiError(error instanceof Error ? error.message : "Could not reach Mail System.", 0, "NETWORK_ERROR"); }
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data.error === "object" ? data.error : {};
    throw new RemoteStaffApiError(detail.message || data.error || "Remote Staff request failed.", response.status, detail.code);
  }
  return data as T;
}
export async function syncRemoteStaff(input: RemoteStaffSyncInput) {
  const config = await getMailModuleConfig();
  return request<RemoteStaffSyncResult>("/api/integrations/remote-staff/sync", config.apiKey, {
    method: "POST", headers: { "Idempotency-Key": input.event_id }, body: JSON.stringify(input),
  });
}
export async function provisionRemoteStaffLogin(input: RemoteStaffSyncInput) {
  const synced = await syncRemoteStaff(input);
  if (synced.remote_user.status !== "active") throw new RemoteStaffApiError("Remote User is not active; login was not created.", 403, "REMOTE_USER_INACTIVE");
  if (synced.access.state === "pending_review" || synced.access.pending_review) throw new RemoteStaffApiError("Remote User was provisioned, but access assignments require review before login.", 202, "REMOTE_ACCESS_PENDING_REVIEW");
  const assertion = await createRemoteActorAssertion(input.user.external_user_id);
  const session = await exchangeRemoteIdentity(assertion);
  return { ...synced, session };
}
export async function terminateRemoteStaff(input: { event_id: string; external_user_id: string; source_revision: number; reason?: string }) {
  const config = await getMailModuleConfig();
  return request<{ ok: true; status: "terminated"; remote_user_id: string; permission_revision: number; event_id: string }>(
    "/api/integrations/remote-staff/terminate", config.apiKey,
    { method: "POST", headers: { "Idempotency-Key": input.event_id }, body: JSON.stringify(input) },
  );
}
export async function exchangeRemoteIdentity(assertion: string) {
  const config = await getMailModuleConfig();
  return request<RemoteStaffSession>("/api/remote-staff/session", config.apiKey, { method: "POST", headers: { "X-Remote-Actor-Assertion": assertion } });
}
export async function assignRemoteAdminPermissions(input: { sessionToken: string; remoteUserId: string; permissionIds: string[]; expiresAt?: string | null }) {
  if (!input.remoteUserId || !input.permissionIds.length) throw new Error("A remote user and at least one permission are required.");
  return request<{ assignment: { id: string; remote_user_id: string; permission_ids: string[]; active: boolean; expires_at: string | null } }>(
    "/api/remote-staff/admin-assignments", input.sessionToken,
    { method: "POST", body: JSON.stringify({ remote_user_id: input.remoteUserId, permission_ids: input.permissionIds, expires_at: input.expiresAt ?? null }) },
  );
}
export async function revokeRemoteSession(sessionToken: string) { return request<{ ok: true }>("/api/remote-staff/session/revoke", sessionToken, { method: "POST" }); }
export async function refreshRemoteSession(sessionToken: string) {
  return request<{ token_type: "Bearer"; access_token: string; expires_at: string }>("/api/remote-staff/session/refresh", sessionToken, { method: "POST" });
}
