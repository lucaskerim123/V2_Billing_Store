import type {
  MailModuleStore, MailModuleSettings, MailTemplate, MailTemplateRevision,
  MailRoute, MailTrigger,
} from "./types";

/** Minimal structural type: accepts a Supabase JS client without forcing a second SDK install. */
export type SupabaseMailClient = {
  from(table: string): any;
  rpc(name: string, args?: Record<string, unknown>): any;
};

const fail = (error: any, operation: string): never => {
  if (error) throw new Error(`Mail module ${operation} failed: ${error.message || String(error)}`);
  throw new Error(`Mail module ${operation} failed.`);
};

const DEFAULT_SETTINGS: MailModuleSettings = {
  enabled: false,
  defaultSender: null,
  appearance: {
    primaryColor: "#253858", accentColor: "#3978d4", surfaceColor: "#ffffff",
    textColor: "#172033", borderColor: "#d9e0ea", borderRadius: "12px",
    fontFamily: "inherit", title: "Mail settings", subtitle: "Configure application email",
  },
};

/**
 * Supabase persistence adapter for the host application's own database.
 * The host must apply schema.sql + migrations and enforce admin/tenant RLS.
 * Never pass a service-role client to browser code.
 */
export function createSupabaseMailModuleStore(client: SupabaseMailClient): MailModuleStore {
  return {
    async listTemplates() {
      const { data, error } = await client.from("app_mail_templates").select("*").order("updated_at", { ascending: false });
      if (error) fail(error, "template listing");
      return (data || []) as MailTemplate[];
    },
    async getTemplateByKey(key) {
      const { data, error } = await client.from("app_mail_templates").select("*").eq("template_key", key).maybeSingle();
      if (error) fail(error, "template lookup");
      return (data || null) as MailTemplate | null;
    },
    async saveTemplate(input) {
      const { data, error } = await client.rpc("app_mail_save_template_with_revision", { p_template: input });
      if (error) fail(error, "template save");
      return data as MailTemplate;
    },
    async listTemplateRevisions(templateId) {
      const { data, error } = await client.from("app_mail_template_revisions").select("*")
        .eq("template_id", templateId).order("revision", { ascending: false });
      if (error) fail(error, "revision listing");
      return (data || []) as MailTemplateRevision[];
    },
    async restoreTemplateRevision(templateId, revision) {
      const { data, error } = await client.rpc("app_mail_restore_template_revision", {
        p_template_id: templateId, p_revision: revision,
      });
      if (error) fail(error, "revision restore");
      return data as MailTemplate;
    },
    async deleteTemplate(id) {
      const { error } = await client.from("app_mail_templates").delete().eq("id", id);
      if (error) fail(error, "template deletion");
    },
    async listRoutes() {
      const { data, error } = await client.from("app_mail_routes").select("*").order("priority", { ascending: false });
      if (error) fail(error, "route listing");
      return (data || []) as MailRoute[];
    },
    async saveRoute(input) {
      const query = input.id
        ? client.from("app_mail_routes").update(input).eq("id", input.id)
        : client.from("app_mail_routes").insert(input);
      const { data, error } = await query.select("*").single();
      if (error) fail(error, "route save");
      return data as MailRoute;
    },
    async deleteRoute(id) {
      const { error } = await client.from("app_mail_routes").delete().eq("id", id);
      if (error) fail(error, "route deletion");
    },
    async listTriggers() {
      const { data, error } = await client.from("app_mail_triggers").select("*").order("event_key");
      if (error) fail(error, "trigger listing");
      return (data || []) as MailTrigger[];
    },
    async getTrigger(eventKey) {
      const { data, error } = await client.from("app_mail_triggers").select("*").eq("event_key", eventKey).maybeSingle();
      if (error) fail(error, "trigger lookup");
      return (data || null) as MailTrigger | null;
    },
    async saveTrigger(input) {
      const query = input.id
        ? client.from("app_mail_triggers").update(input).eq("id", input.id)
        : client.from("app_mail_triggers").upsert(input, { onConflict: "event_key" });
      const { data, error } = await query.select("*").single();
      if (error) fail(error, "trigger save");
      return data as MailTrigger;
    },
    async deleteTrigger(id) {
      const { error } = await client.from("app_mail_triggers").delete().eq("id", id);
      if (error) fail(error, "trigger deletion");
    },
    async getSettings() {
      const { data, error } = await client.from("app_mail_settings").select("value").eq("key", "module").maybeSingle();
      if (error) fail(error, "settings lookup");
      return { ...DEFAULT_SETTINGS, ...(data?.value || {}), appearance: {
        ...DEFAULT_SETTINGS.appearance, ...(data?.value?.appearance || {}),
      } } as MailModuleSettings;
    },
    async saveSettings(input) {
      const { data, error } = await client.from("app_mail_settings")
        .upsert({ key: "module", value: input }, { onConflict: "key" }).select("value").single();
      if (error) fail(error, "settings save");
      return { ...DEFAULT_SETTINGS, ...(data?.value || {}), appearance: {
        ...DEFAULT_SETTINGS.appearance, ...(data?.value?.appearance || {}),
      } } as MailModuleSettings;
    },
  };
}
