# FALLBACK notification implementation status
Date: 2026-10-23. Changes are on main. No production web deployment authorized or performed.

## Surfaces and authority
- V6A Admin: independent `AdminNotifications` bell, staff/operational notifications only.
- V6C Customer: `NotificationCenter surface="portal"`, manual customer messages and customer lifecycle events.
- Both use `public.notifications`, separate `surface` values and recipient-scoped deletion/acknowledgement.
- Billing technical notices are only communication based on an accepted License Administration result; no local technical authority and no automatic deployment.

## Wired in this implementation
- Staff invite: OrbitFS Mail `staff.invite`, from `info@orbitfs.cc`, seven-day token, hashed server-side, customer-account email match, explicit acceptance before any staff access.
- Staff operations: acceptance, access disabled/removed, role and permission changes (existing staff update and group edits).
- Customer operations: customer creation and account status transitions.
- Orders: created, paid, payment failed, cancelled.
- Invoices: created, paid, overdue, due reminders, cancelled.
- Invoice payment/refunds: failed payment attempts and completed refund.
- Customer lifecycle mail-outbox bridge: activation, suspension, restoration, termination, cancellation requested/scheduled/denied/completed.
- Customer support: staff reply to ticket. Existing staff ticket notification routing remains.
- Wallet: credit and debit records.
- Subscription: active/payment-related failure/cancellation status transitions.
- Deployment: success/failure notifications AFTER License Administration accepts a completed/failed result report.
- Release channel notifications: existing customer join/leave/add/remove and staff access request notification retained.
- Manual Alert System: customer portal only, notification/message/maintenance via bell; alert/announcement via persistent dismissible banner. Explicit optional DND override.
- Preferences: per-user per-surface quiet hours, DND, muted categories, critical interrupt allowance. Preferences affect interruptions; notification history and required Mail policies stay intact.
- Duplicate protection: invoice overdue source de-duplicated; `notification_emit` resets acknowledgement on event reactivation.

## Not wired without a verified event source or policy
- Ticket SLA timeout/unassigned age thresholds (no authorised SLA values).
- Suspicious login/new-device/fraud signals (no verified detection event).
- Licence expiry, activation failure, technical release intake/validation/publish events beyond existing release-channel events (must come from License Administration).
- Persistent health/offline monitoring and provider credential expiry (must come from verified health/provider state).
- Other optional notifications from the earlier planning inventory where no explicit transaction event exists.
- User-specific quieting of external email/OS push is not part of notification preferences; existing mail subscriptions remain authoritative for Mail.

## Validation performed
- Supabase migrations for invite flow, mail template, customer/operational routing and preferences applied.
- Database confirmed 10 unique routing triggers across orders, invoices, payments, refunds, customers, support replies, subscriptions, wallet, staff and mail outbox.
- Invites RLS blocks authenticated reads of invitation token hashes; acceptance RPC is granted to authenticated.
- `staff.invite` automation and `info@orbitfs.cc` sender verified active.
- Duplicate notification acknowledgement reset present in live `notification_emit`.

## Verification outstanding
- Full Next.js `npm run typecheck` and `npm run build` (no reachable authenticated checkout in this tool runtime).
- Authenticated end-to-end staff invite email/acceptance and customer/administrator notification UI.
- Real source-trigger event smoke tests and Release/Deployment authority integrations.
- No web production deployment was initiated.
