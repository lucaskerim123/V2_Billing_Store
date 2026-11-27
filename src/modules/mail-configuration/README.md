# Billing Mail Configuration Module

Installable host module for `lucaskerim123/V2_Billing_Store`. It is mounted inside Billing's existing Next.js Admin Center and customer profile pages; it is not a separate Mail System application.

## Responsibility boundary

**Billing Store owns** customer and employee records, staff groups and permissions, templates, template revisions, event triggers, recipient resolution, sender routing rules, module enablement, appearance and admin authorization. **Central Mail System owns** External System credentials/scopes, sender mailbox assignments, transport, delivery processing, Remote User identity/access decisions, mailbox grants, sessions and delivery audit.

The module calls the central Mail System only from trusted server-side Billing code. The API key is never sent to browser components. Customer profile sends resolve the recipient from the authoritative Billing customer record; browser input cannot choose the recipient or sender.

## Billing integration

- Admin Center → System → Outbound Mail provides template, revision, route, trigger, connection and module settings.
- Customer profiles gain an Emails tab for staff with `communications.mail.send` or `communications.mail.manage`.
- Billing's existing transactional event callers dispatch through the new module. The module is disabled by default; imported legacy templates and triggers remain inactive until reviewed and enabled.
- Staff group permissions expose separate `communications.mail.manage` and `communications.mail.send` capabilities.
- Billing remains authoritative for staff identity, status, group codes and department codes. Staff changes, removals and accepted invitations trigger best-effort Remote Staff synchronisation. A manual Remote Staff panel is available in Outbound Mail.
- Mail System independently applies its approved External System delegation and role/group/department mappings. Billing does not send raw permissions or assign mailbox capabilities directly.

## Database ownership

The authoritative forward migration is maintained in the central `lucaskerim123/Master-Database-System` repository:

`Main Core System/Main services/Billing StoreFront/migrations/20261128000100_billing_mail_configuration_module.sql`

The Billing repository contains the module's portable schema/function references, but production database changes must go through the Master Database System's manual migration workflow. Do not apply the SQL directly from this application repository.

## Server configuration

Configure `MAIL_SYSTEM_URL` and `MAIL_SYSTEM_API_KEY` in the Billing server runtime. The existing `SUPABASE_SERVICE_ROLE_KEY` is used only by server-side sync and send routes. None of these values may be prefixed with `NEXT_PUBLIC_` or passed to client components.

The External System must be active and have the approved Mail System scopes for sending and Remote Staff provisioning/termination. Sender mailboxes must be assigned by Mail System administration. Do not issue `mail:admin` merely to enable Remote Staff provisioning.

## Included

- Host persistence adapter for templates, immutable revisions, routes, triggers and module settings.
- Conditional sender routing, template rendering, preview and revision restore.
- Server-only Mail System connection verification and send client.
- Billing customer-profile send panel with trusted recipient resolution.
- Compatibility dispatcher for existing Billing transactional event callers.
- Remote Staff roster sync, termination and monotonic source revisions.
- Staff-group permission definitions and Admin Center integration.
- Contract tests run by the repository CI workflow.

Remote identity session exchange helpers are included in the SDK, but Billing's current integration uses machine-to-machine provisioning and sending; it does not yet expose a Remote User mailbox session UI.
