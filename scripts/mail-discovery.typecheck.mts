import { BILLING_EMAIL_EVENTS } from "../src/lib/billing-email-events.mjs";
import { planMailDiscovery } from "../src/integrations/Mailsystem/Data/discovery.mjs";
import type { MailTemplate, MailRoute, MailTrigger } from "../src/integrations/Mailsystem/Data/types";

// Compile the same typed data boundary used by the admin discovery endpoint.
export function checkDiscoveryContract(
  senders: readonly { id: string; address: string; kind?: string }[],
  templates: readonly MailTemplate[],
  triggers: readonly MailTrigger[],
  routes: readonly MailRoute[],
  legacyTemplates: readonly { template_key: string; name: string; subject: string; text_body: string | null; html: string | null; from_account: string | null }[],
  legacyAutomations: readonly { event_key: string; template_key: string }[],
) {
  const planned = planMailDiscovery({ events: BILLING_EMAIL_EVENTS, senders, templates, triggers, routes, legacyTemplates, legacyAutomations });
  return planned.map(event => {
    const sender: string | null = event.sender;
    const template: Pick<MailTemplate, "template_key" | "display_name" | "subject" | "body_text" | "body_html" | "variables" | "active"> | null = event.template;
    const status: "configured" | "needs_sender" | "needs_template" | "ready_to_configure" = event.status;
    return { key: event.key, sender, template, status, sensitive: event.variables.some(variable => variable.sensitive) };
  });
}
