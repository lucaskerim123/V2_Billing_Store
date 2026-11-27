# Billing Mail Configuration Module — Installation

## 1. Host integration

This module is installed at `src/modules/mail-configuration` inside `lucaskerim123/V2_Billing_Store`. Its Admin Center page is `/admin/settings/outbound-mail`; customer profile email actions are exposed through the Emails tab. Do not install or copy the central Mail System Next.js application into Billing.

## 2. Database migration

Database source is centrally owned. The forward migration is maintained in `lucaskerim123/Master-Database-System`:

`Main Core System/Main services/Billing StoreFront/migrations/20261128000100_billing_mail_configuration_module.sql`

That migration creates the Billing-owned `app_mail_*` tables, revision functions, RLS policies, permission keys and Remote Staff source-revision counter. It also imports existing legacy Billing templates and automation mappings with sending disabled so administrators can review them before activation.

**Do not apply `schema.sql` or `supabase-functions.sql` directly to production.** Use the Master Database System's manual migration validation/apply workflow. Production DB changes remain manual-only.

## 3. Server environment

Configure the following in the Billing server runtime:

```env
MAIL_SYSTEM_URL=https://your-mail-system-domain
MAIL_SYSTEM_API_KEY=your-billing-external-system-api-key
```

The existing `SUPABASE_SERVICE_ROLE_KEY` is also required by server-side Billing routes and the Remote Staff sync helper. Keep all credentials server-only. Never use a `NEXT_PUBLIC_` prefix or pass credentials into client components.

The External System must be active in Mail System. Its API key must have only the approved send and Remote Staff provisioning/termination scopes. Sender mailboxes must be assigned by Mail System administration. Do not grant `mail:admin` solely for Remote Staff synchronisation.

## 4. Permissions

The central Billing database migration adds:

- `communications.mail.manage` — manage module settings, templates, routes, triggers and Remote Staff synchronisation.
- `communications.mail.send` — send enabled templates to customer records.

The Admin Center staff group editor exposes both capabilities. The migration grants manage/send to the Administrator group and send-only to Support and Senior Support. Superadmin retains its existing `all` authority. Custom groups can be assigned either capability independently.

## 5. Configure the module

1. Open Admin Center → System → Outbound Mail.
2. Test the Mail System connection and confirm the permitted sender mailboxes.
3. Review imported templates and their variables.
4. Review imported routes and activate only sender addresses assigned to the Billing External System.
5. Review event triggers and recipient mappings. They are imported inactive.
6. Enable the module only after the connection and sender configuration are verified.
7. Activate the required triggers and send a controlled test message.

The customer profile Emails tab uses the customer's Billing email address resolved server-side. The browser cannot override the recipient or sender.

## 6. Remote Staff

Billing remains authoritative for staff employment records, group membership and department membership. Staff updates, deactivation/removal and invitation acceptance call the Remote Staff sync helper; Outbound Mail also provides a manual sync/termination panel.

Mail System must have the Billing External System's Remote Staff delegation configured, including permitted external role, group and department codes and the approved mapping/access ceiling. Billing sends identity and organisational codes only; it does not send Mail System permission grants or mailbox assignments.

Remote Staff sync is best-effort so an unavailable Mail System does not block ordinary Billing staff changes. Failed syncs are recorded in the Billing audit log where possible and can be retried from Outbound Mail. The central Mail System Remote Staff API must be deployed and its relevant workflow checks must pass before production sync is enabled.

## 7. Disable safely

Disable the Billing module and event triggers first. Revoke the Billing External System API key in Mail System, remove the server environment values, then remove the module database objects only through the central database source and approved migration workflow. Preserve template and revision records if required for audit.
