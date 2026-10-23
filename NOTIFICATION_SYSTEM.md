# OrbitFS Notification Centre

OrbitFS uses one central `public.notifications` backend with two UI surfaces:

- `admin` — one notification panel mounted once in `src/app/admin/layout.tsx`.
- `portal` — one notification panel mounted once in `src/app/portal/layout.tsx`.

Both surfaces use `src/components/NotificationCenter.tsx`. Notifications are stored per recipient, support unread/read state, deep links, Supabase Realtime updates and RLS so users can only read their own records.

## Persistence lifecycle

- Closing the panel, tab, browser, signing out or restarting the device does not remove a notification; notification state is server-side.
- Opening a notification sets `read_at` only. Reading is not acknowledgement.
- Acknowledging sets `acknowledged_at` and also marks the notification read.
- An acknowledged notification is retained for 3 days, then permanently deleted by the retention cleanup.
- Saving sets `saved_at`; saved notifications are excluded from automatic deletion.
- Unsaving restores the normal acknowledgement retention rule.
- Deduplicated events that become active again reset acknowledgement so a newly reactivated event cannot remain silently acknowledged.


## Admin-authored notifications

Administrators with `notifications.send` can compose directly from the Admin notification centre. Manual sends use the same notification stream as system events rather than creating a second messaging system.

Supported manual types:

- notification
- message
- alert
- announcement
- maintenance

Audience options:

- selected customers and/or staff
- all customers
- all active staff
- everyone

Selected recipients can be searched by name, email or customer number. Staff recipients are delivered to the `admin` surface; customer recipients are delivered to the `portal` surface. Manual sends may include a local OrbitFS action path and one of the standard severities (`info`, `success`, `warning`, `error`). Broad sends require UI confirmation.

The secure backend entry point is `public.notification_admin_send(...)`. Recipient lookup uses `public.notification_admin_recipient_options(...)`. Only authenticated staff with `notifications.send` may execute either function. Manual sends are recorded in `public.admin_audit_log` as `notification.send` actions.

## Support events currently wired

- new support ticket
- ticket assignment/reassignment/removal
- department transfer / claim required
- escalation / target tier claim required
- customer reply
- staff reply
- internal note for the current owner
- customer close
- relevant ticket status changes
- priority changes for the assigned staff member

Future Orders, invoices, licences, payments, security and system alerts should publish through `public.notification_emit(...)` instead of creating another notification table or UI.

Deployment policy: keep exactly one notification centre mounted in the Admin shell and one in the Customer Portal shell; feature pages publish events but do not mount additional notification panels.
