import { createSign, randomUUID } from "node:crypto";
import { getMailModuleConfig } from "./config";
import type { RemoteStaffSession, RemoteStaffSyncInput, RemoteStaffSyncResult } from "./remote-staff-types";

export class RemoteStaffApiError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code?: string) {
    super(message);
    this.name = "RemoteStaffApiError";
  }
}

type RemoteAssertionConfig = {
  issuer: string;
  audience: string;
  keyId: string;
  privateKey: string;
};

function getRemoteAssertionConfig(env: NodeJS.ProcessEnv = process.env): RemoteAssertionConfig {
  const issuer = String(env.MAIL_SYSTEM_REMOTE_ASSERTION_ISSUER ?? "").trim();
  const audience = String(env.MAIL_SYSTEM_REMOTE_ASSERTION_AUDIENCE ?? "").trim();
  const keyId = String(env.MAIL_SYSTEM_REMOTE_ASSERTION_KID ?? "").trim();
  const privateKey = String(env.MAIL_SYSTEM_REMOTE_ASSERTION_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
  if (!issuer || !audience || !keyId || !privateKey) {
    throw new Error("Remote identity is not configured. Set MAIL_SYSTEM_REMOTE_ASSERTION_ISSUER, MAIL_SYSTEM_REMOTE_ASSERTION_AUDIENCE, MAIL_SYSTEM_REMOTE_ASSERTION_KID and MAIL_SYSTEM_REMOTE_ASSERTION_PRIVATE_KEY.");
  }
  if (!privateKey.includes("BEGIN PRIVATE KEY") && !privateKey.includes("BEGIN RSA PRIVATE KEY")) {
    throw new Error("MAIL_SYSTEM_REMOTE_ASSERTION_PRIVATE_KEY must be a PEM-encoded private key.");
  }
  return { issuer, audience, keyId, privateKey };
}

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** Create a one-use RS256 assertion. The matching public JWK must be registered in Mail System. */
export function createRemoteActorAssertion(
  externalUserId: string,
  env: NodeJS.ProcessEnv = process.env,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const subject = String(externalUserId || "").trim();
  if (!subject) throw new Error("externalUserId is required.");
  const config = getRemoteAssertionConfig(env);
  const header = encode({ alg: "RS256", typ: "JWT", kid: config.keyId });
  const claims = encode({
    iss: config.issuer,
    aud: config.audience,
    sub: subject,
    iat: nowSeconds,
    exp: nowSeconds + 120,
    jti: randomUUID(),
  });
  const signingInput = header + "." + claims;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  return signingInput + "." + signer.sign(config.privateKey).toString("base64url");
}

async function request<T>(path: string, token: string, init: RequestInit = {}) {
  const config = getMailModuleConfig();
  let response: Response;
  try {
    response = await fetch(config.baseUrl + path, {
      ...init,
      headers: {
        Authorization: "Bearer " + token,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      cache: "no-store",
    });
  } catch (error) {
    throw new RemoteStaffApiError(error instanceof Error ? error.message : "Could not reach Mail System.", 0, "NETWORK_ERROR");
  }
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data.error === "object" ? data.error : {};
    throw new RemoteStaffApiError(detail.message || data.error || "Remote Staff request failed.", response.status, detail.code);
  }
  return data as T;
}

/** Provision or update the remote login identity and its delegated role/group access. */
export async function syncRemoteStaff(input: RemoteStaffSyncInput) {
  const config = getMailModuleConfig();
  return request<RemoteStaffSyncResult>("/api/integrations/remote-staff/sync", config.apiKey, {
    method: "POST",
    headers: { "Idempotency-Key": input.event_id },
    body: JSON.stringify(input),
  });
}

/** Provision/update staff and immediately exchange a short-lived assertion for a Mail System login session. */
export async function provisionRemoteStaffLogin(input: RemoteStaffSyncInput) {
  const synced = await syncRemoteStaff(input);
  if (synced.remote_user.status !== "active") {
    throw new RemoteStaffApiError("Remote User is not active; login was not created.", 403, "REMOTE_USER_INACTIVE");
  }
  if (synced.access.state === "pending_review" || synced.access.pending_review) {
    throw new RemoteStaffApiError("Remote User was provisioned, but access assignments require review before login.", 202, "REMOTE_ACCESS_PENDING_REVIEW");
  }
  const assertion = createRemoteActorAssertion(input.user.external_user_id);
  const session = await exchangeRemoteIdentity(assertion);
  return { ...synced, session };
}

/** Call from trusted host-server code when employment ends. */
export async function terminateRemoteStaff(input: {
  event_id: string;
  external_user_id: string;
  source_revision: number;
  reason?: string;
}) {
  const config = getMailModuleConfig();
  return request<{ ok: true; status: "terminated"; remote_user_id: string; permission_revision: number; event_id: string }>(
    "/api/integrations/remote-staff/terminate",
    config.apiKey,
    { method: "POST", headers: { "Idempotency-Key": input.event_id }, body: JSON.stringify(input) },
  );
}

/** Exchange a short-lived signed actor assertion for a revocable Remote User session. */
export async function exchangeRemoteIdentity(assertion: string) {
  const config = getMailModuleConfig();
  return request<RemoteStaffSession>("/api/remote-staff/session", config.apiKey, {
    method: "POST",
    headers: { "X-Remote-Actor-Assertion": assertion },
  });
}

/** Appoint delegated Mail System administrator permissions within the Mail System's configured ceiling. */
export async function assignRemoteAdminPermissions(input: {
  sessionToken: string;
  remoteUserId: string;
  permissionIds: string[];
  expiresAt?: string | null;
}) {
  if (!input.remoteUserId || !input.permissionIds.length) throw new Error("A remote user and at least one permission are required.");
  return request<{ assignment: { id: string; remote_user_id: string; permission_ids: string[]; active: boolean; expires_at: string | null } }>(
    "/api/remote-staff/admin-assignments",
    input.sessionToken,
    { method: "POST", body: JSON.stringify({
      remote_user_id: input.remoteUserId,
      permission_ids: input.permissionIds,
      expires_at: input.expiresAt ?? null,
    }) },
  );
}

/** Revoke the current Remote User session. */
export async function revokeRemoteSession(sessionToken: string) {
  return request<{ ok: true }>("/api/remote-staff/session/revoke", sessionToken, { method: "POST" });
}

/** Rotate a Remote User session before it expires. The previous token is invalidated atomically. */
export async function refreshRemoteSession(sessionToken: string) {
  return request<{ token_type: "Bearer"; access_token: string; expires_at: string }>(
    "/api/remote-staff/session/refresh",
    sessionToken,
    { method: "POST" },
  );
}
