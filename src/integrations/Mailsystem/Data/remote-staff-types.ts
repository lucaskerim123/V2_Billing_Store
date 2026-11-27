export type RemoteStaffStatus = "pending" | "active" | "on_leave" | "suspended" | "locked" | "disabled" | "terminated";
export type RemoteStaffState = {
  external_user_id: string;
  email?: string | null;
  display_name?: string | null;
  status: RemoteStaffStatus;
  status_reason?: string | null;
  profile?: Record<string, unknown>;
  role_codes?: string[];
  department_codes?: string[];
  group_codes?: string[];
};
export type RemoteStaffSyncInput = {
  event_id: string;
  source_revision: number;
  effective_at?: string;
  user: RemoteStaffState;
};
export type RemoteStaffSyncResult = {
  ok: true;
  remote_user: { id: string; external_user_id: string; status: RemoteStaffStatus; permission_revision: number };
  access: {
    state: "applied" | "pending_review";
    granted: unknown[];
    revoked: unknown[];
    unmapped_assignments: unknown[];
    pending_review: boolean;
  };
};
export type RemoteStaffSession = {
  token_type: "Bearer";
  access_token: string;
  expires_at: string;
  remote_user: { id: string; external_user_id: string; email: string | null; display_name: string | null };
};
