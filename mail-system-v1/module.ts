import { verifyMailSystemConnection, sendMessage } from "./client";
import { resolveMailRoute } from "./routing";
import { renderTemplate } from "./renderer";
import type { MailModuleStore, MailModuleCapabilities } from "./types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function getModuleCapabilities(): Promise<MailModuleCapabilities> {
  try {
    const result = await verifyMailSystemConnection();
    const senders = result.senders.filter((sender) => EMAIL_PATTERN.test(sender.address));
    return {
      connected: result.connected,
      canSend: result.canSend && senders.length > 0,
      senders,
      defaultSender: result.sender,
      status: result.status,
      message: result.message,
      ...(result.connected ? {} : { error: result.message }),
    };
  } catch (error) {
    return {
      connected: false,
      canSend: false,
      senders: [],
      defaultSender: null,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

export async function sendConfiguredMail(input: {
  store: MailModuleStore;
  templateKey: string;
  routeKey?: string | null;
  context: Record<string, unknown>;
  resolveRecipients: (context: Record<string, unknown>) => Promise<string | string[]>;
}) {
  const settings = await input.store.getSettings();
  if (!settings.enabled) throw new Error("Mail module is disabled for this application.");

  const template = await input.store.getTemplateByKey(input.templateKey);
  if (!template || !template.active) throw new Error("Template is missing or disabled.");

  const resolved = await input.resolveRecipients(input.context);
  const recipients = (Array.isArray(resolved) ? resolved : [resolved])
    .map((recipient) => recipient.trim())
    .filter(Boolean);
  if (!recipients.length || recipients.some((recipient) => !EMAIL_PATTERN.test(recipient))) {
    throw new Error("Recipient resolver must return one or more valid email addresses.");
  }

  const allRoutes = await input.store.listRoutes();
  const candidateRoutes = input.routeKey
    ? allRoutes.filter((route) => route.route_key === input.routeKey)
    : allRoutes;
  const selection = resolveMailRoute(candidateRoutes, input.context, settings.defaultSender);

  if (input.routeKey && !selection.route) {
    throw new Error("The trigger sender route is inactive or its conditions did not match.");
  }
  if (!selection.sender) throw new Error("No sender is configured.");

  const capabilities = await getModuleCapabilities();
  if (!capabilities.connected) throw new Error(capabilities.error || "Mail service unavailable.");
  const permitted = capabilities.senders.some(
    (sender) => sender.address.toLowerCase() === selection.sender!.toLowerCase(),
  );
  if (!permitted) throw new Error("API key does not grant access to the selected sender.");

  const rendered = renderTemplate(
    { subject: template.subject, text: template.body_text, html: template.body_html },
    input.context,
  );
  return sendMessage({
    to: recipients,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    from_address: selection.sender,
  });
}

export async function dispatchMailEvent(input: {
  store: MailModuleStore;
  eventKey: string;
  context: Record<string, unknown>;
  resolveRecipients: (
    mapping: Record<string, unknown>,
    context: Record<string, unknown>,
  ) => Promise<string | string[]>;
}) {
  const settings = await input.store.getSettings();
  if (!settings.enabled) return { skipped: true as const, reason: "Module disabled" };

  const trigger = await input.store.getTrigger(input.eventKey);
  if (!trigger || !trigger.active) return { skipped: true as const, reason: "No active trigger" };

  return sendConfiguredMail({
    store: input.store,
    templateKey: trigger.template_key,
    routeKey: trigger.route_key,
    context: input.context,
    resolveRecipients: (context) => input.resolveRecipients(trigger.recipient_mapping, context),
  });
}
