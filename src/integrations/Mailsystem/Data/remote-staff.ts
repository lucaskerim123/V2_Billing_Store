import { getMailModuleConfig } from "./config";
import type { RemoteStaffSession, RemoteStaffSyncInput, RemoteStaffSyncResult } from "./remote-staff-types";

export class RemoteStaffApiError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code?: string) {
    super(message);
    this.name = "RemoteStaffApiError";
  }
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

/** Call from trusted host-server code after a hire, role change or department transfer. */
export async function syncRemoteStaff(input: RemoteStaffSyncInput) {
  const config = getMailModuleConfig();
  return request<RemoteStaffSyncResult>("/api/integrations/remote-staff/sync", config.apiKey, {
    method: "POST",
    headers: { "Idempotency-Key": input.event_id },
    body: JSON.stringify(input),
  });
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
