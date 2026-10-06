# OrbitFS communication event inventory

Last code audit: 2026-10-06.

This document records the communication paths already present in V2_Billing_Store. It is an inventory, not a second source of runtime truth.

## Current channel ownership

- Customer portal notification centre: `public.notifications`, surface `portal`.
- Admin portal notification centre: `public.notifications`, surface `admin`.
- Manual Alert System: publishes into the same notification backend; it is not a separate transactional store.
- Customer email: OrbitFS Mail in Supabase owns templates, automations, sender identity, subscription policy and delivery history. Resend is transport only.
- Portal banner: `portal_banner.*` settings; global customer-facing banner, separate from per-user notifications and Alert System.
- Audit log: administrative/operational history; not a customer notification channel.
- Technical release/licence/deployment truth remains License Manager authority. Billing may present or deliver communications only from authoritative results.

## Notification centre

Shared component: `src/components/NotificationCenter.tsx`.

Surfaces:
- `admin`: mounted once in the Admin shell.
- `portal`: mounted once in the Customer Portal shell.

Capabilities:
- unread/read state
- mark all read
- action/deep links
- severity: `info`, `success`, `warning`, `error`
- display kind: `notification`, `message`, `alert`, `announcement`, `maintenance`
- Supabase Realtime delivery
- RLS per recipient
- configurable feed limit and realtime switch

## Manual Alert System

Backend:
- `public.notification_admin_send(...)`
- `public.notification_admin_recipient_options(...)`

Permission:
- `notifications.send`

Audiences:
- selected people
- customers
- active staff
- everyone

Settings already present:
- `alerts.enabled`
- `alerts.manual_send_enabled`
- `alerts.realtime_enabled`
- `alerts.action_links_enabled`
- `alerts.feed_limit`
- default type
- default severity
- default audience
- bulk confirmation threshold
- maximum message length
- per-type enable switches

Admin manual sends are recorded in `admin_audit_log` as `notification.send`.

## Portal/admin notifications already wired

### Support -> Admin notification centre

Existing support notification logic covers:
- new support ticket
- assignment / reassignment / removal
- department transfer / claim required
- escalation / target-tier claim required
- customer reply
- staff reply
- internal note for the current owner
- customer close
- relevant ticket status changes
- priority changes for the assigned staff member

Support notification helpers use `public.notification_emit(...)` / support recipient routing.

### Release channels -> Customer notification centre

Existing customer events:
- `release_channel.joined`
- `release_channel.left`
- `release_channel.added`
- `release_channel.removed`

Current deep link: `/portal/orbitfs/channels`.

### Release-channel requests -> Admin notification centre

Existing admin event:
- `release_channel.request.pending`

Current deep link: `/admin/orbitfs/release-channels`.

### Major notification gaps

The notification documentation explicitly leaves orders, invoices, licences, payments, security and general system events for future `public.notification_emit(...)` wiring.

Email automation coverage is currently much broader than portal/admin notification coverage. The final design should not create another notification table or another bell.

## OrbitFS Mail

Runtime:
- `mail_settings` stores runtime mail configuration.
- `mail_accounts` stores mailbox/sender identities.
- `mail_templates` stores templates.
- `mail_automations` maps event keys to templates.
- `mail_delivery_log` stores delivery history.
- `mail_event_outbox` handles queued events.
- Resend is delivery transport only.

Standard sender responsibilities:
- System / notifications: `info@orbitfs.cc`
- Support: `support@orbitfs.cc`
- Billing: `billing@orbitfs.cc`

Primary server path:
- `sendAutomation(eventKey, to, vars, relatedType, relatedId)` in `src/lib/transactional-server.ts`.

It resolves the automation, template, customer subscription policy, sender identity, delivery reference, sends through Resend and finalises the delivery record.

## Existing email event inventory

### Account / identity

- `customer.created` — customer welcome
- `account.email_verification` — verification link
- `account.password_reset` — password reset link

### Support

- `support.guest.created` — guest ticket receipt/access
- `support.ticket.created`
- `support.ticket.replied`
- `support.ticket.closed`
- `support.ticket.reopened`

### Orders / service

- `order.created`
- `order.paid`
- `order.cancelled_unpaid`
- `service.activated`
- `service.suspended`
- `service.restored`
- `service.terminated`

### Invoices / billing

- `invoice.created`
- `invoice.paid`
- `invoice.due`
- `invoice.overdue`
- `invoice.cancelled`
- `invoice.refund`

### Cancellation

- `cancellation.requested`
- `cancellation.scheduled`
- `cancellation.denied`
- `cancellation.completed`

### Licensing

- `license.key_issued` — one-time initial licence-key delivery link.
- Licence key rotation is deliberately not emailed.

### Releases

- `release.update_available`
- `release.update_released`

### Deployments

- `deployment.ready`
- `deployment.started`
- `deployment.succeeded`
- `deployment.failed`
- `deployment.action_required`
- `deployment.rollback_succeeded`

Release/deployment technical state must come from License Manager authority; Billing owns the customer-facing communication/presentation.

### News / publication mail

- `news.general_news`
- `news.announcement`
- `news.product_updates`

## Email subscription groups

Existing customer subscription categories:
- `system` — required; system/security and critical transactional mail
- `updates_available`
- `product_updates`
- `news`
- `deployments`
- `support`
- `orders`

Existing required/critical examples include:
- account/security/password events
- invoices and payment-critical events
- cancellation/licence-critical events
- `order.created`
- `order.paid`
- `service.suspended`
- `service.terminated`
- `deployment.failed`
- `deployment.action_required`
- `deployment.rollback_succeeded`
- `support.ticket.created`

Optional examples include normal news, update availability, customer-facing release announcements, routine deployment progress, non-critical support updates, activation/restoration updates.

Customer email opt-outs do not remove portal notifications.

## Other alert-like surfaces

### Global customer portal banner

`PortalGlobalBanner` is a persistent global banner controlled by `portal_banner.*` settings. It is intentionally separate from the notification centre and Alert System.

Use it for platform-wide customer-facing status/banner messaging, not per-user transactional events.

### Inline page status

Many feature pages have local success/error/status messages. No separate central toast/notification store was found in the audited paths. These should remain local UI feedback unless the event needs durable notification history.

## Target event-routing model

The existing systems should converge around one event-routing definition per business event:

1. authoritative event source
2. recipients
3. customer portal notification: yes/no
4. admin portal notification: yes/no
5. email: yes/no
6. email subscription category / mandatory status
7. sender role
8. severity
9. deep link
10. dedupe key / escalation behaviour
11. audit requirement

Do not duplicate authoritative state in the communication layer.

Recommended ownership:
- License/release/deployment state: License Manager authority -> Billing communication presentation/delivery.
- Billing/order/invoice/payment/customer events: Billing authority -> portal/admin notifications and Mail.
- Support events: Billing Support authority -> portal/admin notifications and Mail.
- Manual messages/announcements: Alert System -> shared notification backend.
- Global customer banner: portal-banner system only.

## Root gaps to address next

1. Make transactional event routing explicit instead of separately wiring email and portal/admin notifications in each feature.
2. Add portal notification equivalents for important customer lifecycle events already covered by Mail.
3. Add admin notification equivalents for operational events that require staff attention.
4. Keep critical versus optional email behaviour aligned with the existing subscription system.
5. Remove direct notification-table writes where a shared emission/routing API can preserve dedupe, audit and policy consistently.
6. Keep Alert System for manual authored communication; do not turn it into the transactional event engine.
7. Keep Portal Banner separate from per-user durable notifications.
8. Verify every release/licence/deployment communication originates from authoritative License Manager state before Billing sends it.
