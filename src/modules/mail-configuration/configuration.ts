import type { MailModuleStore, MailRoute, MailTrigger, MailModuleSettings } from "./types";
import { extractVariables } from "./renderer";

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{1,99}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateKey(value: string, label: string) {
  if (!KEY_PATTERN.test(value)) throw new Error(`${label} must be 2–100 letters, numbers, dots, underscores or hyphens.`);
}

export async function configureTemplate(
  store: MailModuleStore,
  input: {
    id?: string;
    template_key: string;
    display_name: string;
    subject: string;
    body_text?: string | null;
    body_html?: string | null;
    active?: boolean;
  },
) {
  validateKey(input.template_key, "Template key");
  if (!input.display_name.trim()) throw new Error("Template name is required.");
  if (!input.subject.trim()) throw new Error("Template subject is required.");
  if (!(input.body_text || "").trim() && !(input.body_html || "").trim()) {
    throw new Error("A text or HTML body is required.");
  }
  if (input.subject.length > 998 || (input.body_text || "").length > 100_000 || (input.body_html || "").length > 200_000) {
    throw new Error("Template content exceeds size limits.");
  }

  const existing = await store.getTemplateByKey(input.template_key);
  if (existing && existing.id !== input.id) throw new Error("A template with this key already exists.");
  return store.saveTemplate({
    id: input.id || existing?.id,
    template_key: input.template_key,
    display_name: input.display_name.trim(),
    subject: input.subject.trim(),
    body_text: input.body_text ?? null,
    body_html: input.body_html ?? null,
    variables: extractVariables({ subject: input.subject, text: input.body_text, html: input.body_html }),
    active: input.active ?? false,
  });
}

export async function configureRoute(store: MailModuleStore, input: Omit<MailRoute, "id"> & { id?: string }) {
  validateKey(input.route_key, "Route key");
  const sender = input.sender_address.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(sender)) throw new Error("A valid sender email address is required.");
  if (!Number.isSafeInteger(input.priority)) throw new Error("Route priority must be a whole number.");
  if (!input.conditions || typeof input.conditions !== "object" || Array.isArray(input.conditions)) {
    throw new Error("Route conditions must be a JSON object.");
  }
  for (const [path, expected] of Object.entries(input.conditions)) {
    const parts = path.split(".");
    if (!parts.length || parts.some((part) => !/^[a-zA-Z0-9_-]+$/.test(part) || ["__proto__", "prototype", "constructor"].includes(part))) {
      throw new Error("Route condition paths must be safe dotted identifiers.");
    }
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      const condition = expected as Record<string, unknown>;
      const operators = Object.keys(condition);
      if (!operators.length || operators.some((operator) => !["equals", "notEquals", "in", "contains"].includes(operator))) {
        throw new Error("Route conditions support equals, notEquals, in and contains only.");
      }
      if ("in" in condition && !Array.isArray(condition.in)) throw new Error("The in operator requires an array.");
      if ("contains" in condition && typeof condition.contains !== "string") {
        throw new Error("The contains operator requires a string.");
      }
    }
  }
  return store.saveRoute({ ...input, sender_address: sender });
}

export async function configureTrigger(store: MailModuleStore, input: Omit<MailTrigger, "id"> & { id?: string }) {
  validateKey(input.event_key, "Event key");
  validateKey(input.template_key, "Template key");
  const template = await store.getTemplateByKey(input.template_key);
  if (!template) throw new Error("Trigger template does not exist.");
  if (input.active && !template.active) throw new Error("Activate the template before enabling this trigger.");

  if (input.route_key) {
    const routes = await store.listRoutes();
    const route = routes.find((item) => item.route_key === input.route_key);
    if (!route) throw new Error("Selected route does not exist.");
    if (input.active && !route.active) throw new Error("Activate the selected sender route before enabling this trigger.");
  }
  if (!input.recipient_mapping || typeof input.recipient_mapping !== "object" || Array.isArray(input.recipient_mapping)) {
    throw new Error("Recipient mapping must be a JSON object.");
  }
  return store.saveTrigger(input);
}

export async function updateModuleSettings(store: MailModuleStore, settings: MailModuleSettings) {
  if (settings.defaultSender && !EMAIL_PATTERN.test(settings.defaultSender.trim())) {
    throw new Error("Default sender must be a valid email address.");
  }
  return store.saveSettings({
    ...settings,
    defaultSender: settings.defaultSender?.trim().toLowerCase() || null,
  });
}
