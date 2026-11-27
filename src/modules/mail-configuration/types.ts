export type MailSender = { id: string; address: string; display_name?: string | null };

export type MailTemplate = {
  id: string;
  template_key: string;
  display_name: string;
  subject: string;
  body_text: string | null;
  body_html: string | null;
  variables: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type MailRoute = {
  id: string;
  route_key: string;
  sender_address: string;
  priority: number;
  conditions: Record<string, unknown>;
  active: boolean;
};

export type MailTrigger = {
  id: string;
  event_key: string;
  template_key: string;
  route_key: string | null;
  recipient_mapping: Record<string, unknown>;
  active: boolean;
};

export type MailAppearance = {
  primaryColor: string;
  accentColor: string;
  surfaceColor: string;
  textColor: string;
  borderColor: string;
  borderRadius: string;
  fontFamily: string;
  logoUrl?: string;
  title: string;
  subtitle: string;
};

export type MailModuleSettings = {
  enabled: boolean;
  defaultSender: string | null;
  appearance: MailAppearance;
};

export type MailTemplateRevision = {
  id: string;
  template_id: string;
  revision: number;
  snapshot: MailTemplate;
  created_at: string;
};

export type MailModuleCapabilities = {
  connected: boolean;
  canSend: boolean;
  senders: MailSender[];
  defaultSender: string | null;
  error?: string;
  status?: "connected" | "no_senders_assigned" | "invalid_api_key" | "external_system_or_scope_invalid" | "configuration_missing" | "mail_system_unavailable" | "network_error" | "unknown_error";
  message?: string;
};

/**
 * Host-owned persistence contract. saveTemplate MUST update the template and
 * insert its next revision snapshot in one database transaction.
 */
export type MailModuleStore = {
  listTemplates(): Promise<MailTemplate[]>;
  getTemplateByKey(key: string): Promise<MailTemplate | null>;
  saveTemplate(input: Omit<MailTemplate, "id" | "created_at" | "updated_at"> & { id?: string }): Promise<MailTemplate>;
  listTemplateRevisions(templateId: string): Promise<MailTemplateRevision[]>;
  restoreTemplateRevision(templateId: string, revision: number): Promise<MailTemplate>;
  deleteTemplate(id: string): Promise<void>;
  listRoutes(): Promise<MailRoute[]>;
  saveRoute(input: Omit<MailRoute, "id"> & { id?: string }): Promise<MailRoute>;
  deleteRoute(id: string): Promise<void>;
  listTriggers(): Promise<MailTrigger[]>;
  getTrigger(eventKey: string): Promise<MailTrigger | null>;
  saveTrigger(input: Omit<MailTrigger, "id"> & { id?: string }): Promise<MailTrigger>;
  deleteTrigger(id: string): Promise<void>;
  getSettings(): Promise<MailModuleSettings>;
  saveSettings(input: MailModuleSettings): Promise<MailModuleSettings>;
};

export const defaultAppearance: MailAppearance = {
  primaryColor: "#253858",
  accentColor: "#3978d4",
  surfaceColor: "#ffffff",
  textColor: "#172033",
  borderColor: "#d9e0ea",
  borderRadius: "12px",
  fontFamily: "inherit",
  title: "Mail settings",
  subtitle: "Configure application email",
};
