// @ts-check
// Host-owned starter content. Never use live credentials or sensitive sample values.
/** @type {Record<string,string>} */
const bodies={
 "account.password_reset":"A password reset was requested for your account. Use this link to reset your password: {{reset_url}}. The link expires in {{expires_minutes}} minutes. If you did not request this, ignore this email.",
 "account.email_verification":"Please verify your email address using this link: {{verification_url}}. The link expires in {{expires_hours}} hours.",
 "customer.created":"Your customer account has been created. You can sign in to manage your account and services.",
 "staff.invite":"You have been invited to join the staff portal. Accept your invitation here: {{invite_url}}.",
 "license.key_issued":"Your license key is ready. Retrieve it securely using this link: {{license_key_url}}. The link expires in {{expires_hours}} hours.",
 "invoice.created":"Invoice {{invoice_number}} has been created. Total: {{invoice_total}}. Due: {{due_date}}. View your invoice: {{invoice_url}}.",
 "invoice.paid":"Payment for invoice {{invoice_number}} has been recorded. View your invoice: {{invoice_url}}.",
 "invoice.due":"Invoice {{invoice_number}} is due on {{due_date}}. Outstanding amount: {{invoice_due}}. View your invoice: {{invoice_url}}.",
 "invoice.overdue":"Invoice {{invoice_number}} is overdue. Outstanding amount: {{invoice_due}}. View your invoice: {{invoice_url}}.",
 "invoice.cancelled":"Invoice {{invoice_number}} has been cancelled.",
 "invoice.refund":"Your refund for invoice {{invoice_number}} has been updated. Amount: {{refund_amount}}. Status: {{refund_status}}. Reference: {{refund_reference}}.",
 "order.created":"Order {{order_number}} has been created. Total: {{order_total}}.",
 "order.paid":"Payment for order {{order_number}} has been recorded.",
 "order.cancelled_unpaid":"Order {{order_number}} has been cancelled because payment was not received.",
 "service.activated":"The service associated with order {{order_number}} is now active.",
 "service.suspended":"The service associated with order {{order_number}} has been suspended. Reason: {{reason}}.",
 "service.restored":"The service associated with order {{order_number}} has been restored.",
 "service.terminated":"The service associated with order {{order_number}} has been terminated. Reason: {{reason}}.",
 "support.guest.created":"We received support ticket {{ticket_number}}: {{ticket_subject}}. Your access code is {{guest_code}} and expires at {{expires_at}}. View your ticket: {{support_url}}.",
 "support.ticket.created":"We received support ticket {{ticket_number}}: {{ticket_subject}}. View your ticket: {{support_url}}.",
 "support.ticket.replied":"A reply has been added to support ticket {{ticket_number}}. View your ticket: {{support_url}}.",
 "support.ticket.closed":"Support ticket {{ticket_number}} has been closed. View your ticket: {{support_url}}.",
 "support.ticket.reopened":"Support ticket {{ticket_number}} has been reopened. View your ticket: {{support_url}}.",
 "cancellation.requested":"We received a cancellation request for order {{order_number}}.",
 "cancellation.scheduled":"Cancellation for order {{order_number}} is scheduled for {{scheduled_for}}.",
 "cancellation.denied":"Your cancellation request for order {{order_number}} was denied. Review your order in the customer portal.",
 "cancellation.completed":"Cancellation for order {{order_number}} has been completed.",
 "release.update_available":"An update to {{product_name}} version {{version}} is available. View the update: {{update_url}}.",
 "release.update_released":"{{product_name}} version {{version}} has been released. View the release: {{release_url}}.",
 "deployment.succeeded":"Deployment of {{product_name}} version {{version}} completed. Environment: {{environment_url}}.",
 "deployment.ready":"Deployment of {{product_name}} version {{version}} is ready for your approval: {{deploy_url}}.",
 "deployment.started":"Deployment of {{product_name}} version {{version}} has started.",
 "deployment.failed":"Deployment of {{product_name}} version {{version}} failed. View deployment details: {{deployment_url}}.",
 "deployment.action_required":"Deployment of {{product_name}} requires an action. View deployment details: {{deployment_url}}.",
 "deployment.rollback_succeeded":"Rollback of {{product_name}} to version {{rollback_version}} has completed.",
 "news.general_news":"{{news_title}}\n\n{{news_excerpt}}\n\nRead more: {{news_url}}.",
 "news.announcement":"{{news_title}}\n\n{{news_excerpt}}\n\nRead more: {{news_url}}.",
 "news.product_updates":"{{news_title}}\n\n{{news_excerpt}}\n\nRead more: {{news_url}}."
};
/**
 * @param {readonly {key:string,name:string,description?:string,variables:readonly {name:string,sensitive?:boolean}[]}[]} events
 */
export function defaultBillingMailTemplates(events){
 return events.map(event=>{
  const names=new Set(event.variables.map(v=>v.name));
  const message=bodies[event.key]??(event.name+".");
  const missing=event.variables.filter(v=>v.sensitive&&!message.includes("{{"+v.name+"}}"));
  const text=(names.has("customer_name")?"Hi {{customer_name}},\n\n":"")+message+
   (missing.length?"\n\n"+missing.map(v=>"{{"+v.name+"}}").join("\n"):"")+"\n\nOrbitFS";
  return {template_key:event.key,display_name:event.name,subject:event.name,body_text:text,body_html:null,variables:[...new Set([...text.matchAll(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g)].map(m=>m[1]))],active:false};
 });
}
