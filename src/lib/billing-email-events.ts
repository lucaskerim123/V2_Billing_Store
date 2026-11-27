/**
 * Billing-owned transactional email event contract.
 *
 * Business workflows publish these stable event keys. An installed email
 * integration may read this catalogue and configure delivery, but it cannot
 * create, rename, or own Billing business events.
 */
export type BillingEmailEvent = {
  key: string;
  name: string;
  category: string;
  description: string;
  variables: readonly { name: string; sensitive?: boolean }[];
};

export const BILLING_EMAIL_EVENTS: readonly BillingEmailEvent[] = Object.freeze([
  { key: "account.password_reset", name: "Password reset", category: "account", description: "A customer requests a password reset.", variables: [{name:"customer_name"},{name:"reset_url",sensitive:true},{name:"expires_minutes"}] },
  { key: "account.email_verification", name: "Email verification", category: "account", description: "A customer registers or requests a new verification link.", variables: [{name:"customer_name"},{name:"verification_url",sensitive:true},{name:"expires_hours"}] },
  { key: "customer.created", name: "Customer created", category: "customers", description: "An administrator creates a customer account.", variables: [{name:"customer_name"}] },
  { key: "staff.invite", name: "Staff invitation", category: "staff", description: "A staff member is invited and must accept the invitation.", variables: [{name:"invite_url",sensitive:true}] },
  { key: "license.key_issued", name: "License key issued", category: "licensing", description: "A license key is issued for an order.", variables: [{name:"customer_name"},{name:"license_key_url",sensitive:true},{name:"expires_hours"}] },
  { key: "invoice.created", name: "Invoice created", category: "billing", description: "A new invoice is created.", variables: [{name:"customer_name"},{name:"invoice_number"},{name:"invoice_total"},{name:"invoice_due"},{name:"due_date"}] },
  { key: "invoice.paid", name: "Invoice paid", category: "billing", description: "An invoice is paid.", variables: [{name:"customer_name"},{name:"invoice_number"},{name:"invoice_total"},{name:"invoice_due"},{name:"due_date"}] },
  { key: "invoice.due", name: "Invoice due", category: "billing", description: "An unpaid invoice is approaching its due date.", variables: [{name:"customer_name"},{name:"invoice_number"},{name:"invoice_total"},{name:"invoice_due"},{name:"due_date"}] },
  { key: "invoice.overdue", name: "Invoice overdue", category: "billing", description: "An invoice has passed its due date.", variables: [{name:"customer_name"},{name:"invoice_number"},{name:"invoice_total"},{name:"invoice_due"},{name:"due_date"}] },
  { key: "order.created", name: "Order created", category: "orders", description: "A customer order is created.", variables: [{name:"customer_name"},{name:"order_number"},{name:"order_total"},{name:"reason"}] },
  { key: "order.paid", name: "Order paid", category: "orders", description: "An order payment is confirmed.", variables: [{name:"customer_name"},{name:"order_number"},{name:"order_total"},{name:"reason"}] },
  { key: "order.cancelled_unpaid", name: "Unpaid order cancelled", category: "orders", description: "An unpaid order is cancelled after its payment grace period.", variables: [{name:"customer_name"},{name:"order_number"},{name:"order_total"},{name:"reason"}] },
  { key: "service.activated", name: "Service activated", category: "services", description: "A customer service becomes active.", variables: [{name:"customer_name"},{name:"order_number"},{name:"order_total"},{name:"reason"}] },
  { key: "service.suspended", name: "Service suspended", category: "services", description: "A customer service is suspended.", variables: [{name:"customer_name"},{name:"order_number"},{name:"order_total"},{name:"reason"}] },
  { key: "service.restored", name: "Service restored", category: "services", description: "A suspended customer service is restored.", variables: [{name:"customer_name"},{name:"order_number"},{name:"order_total"},{name:"reason"}] },
  { key: "service.terminated", name: "Service terminated", category: "services", description: "A customer service is terminated.", variables: [{name:"customer_name"},{name:"order_number"},{name:"order_total"},{name:"reason"}] },
  { key: "support.guest.created", name: "Guest support ticket received", category: "support", description: "A guest submits a support ticket.", variables: [{name:"customer_name"},{name:"ticket_number"},{name:"ticket_subject"},{name:"guest_email"},{name:"guest_code",sensitive:true},{name:"expires_at"},{name:"support_url"}] },
  { key: "deployment.succeeded", name: "Deployment completed", category: "deployments", description: "Billing receives a successful deployment result from the authoritative deployment workflow.", variables: [{name:"customer_name"},{name:"product_name"},{name:"version"},{name:"deployment_type"},{name:"environment_url"}] }
]);

const EVENTS_BY_KEY = new Map(BILLING_EMAIL_EVENTS.map(event => [event.key, event]));

export function getBillingEmailEvent(key: string): BillingEmailEvent | null {
  return EVENTS_BY_KEY.get(key) || null;
}
