# Standalone Mail Configuration Module

A portable, brand-neutral mail component for installation inside other applications. The module is maintained independently in this folder and can be copied into a host application's source tree without copying the Mail System itself.

## Responsibility boundary

The **host application** owns templates, immutable template revisions, variables, event triggers, recipient resolution, sender routing rules, module enable/disable state, appearance, admin authentication and its database. The **central Mail System** owns mail transports, domains, sender mailboxes, API credentials/scopes, delivery processing and central delivery logs.

The module connects to the central Mail System using the host application's server-only `MAIL_SYSTEM_URL` and `MAIL_SYSTEM_API_KEY`. It verifies the key against `GET /api/mail/senders`, discovers only mailboxes assigned to that External System, and sends through `POST /api/mail`. The central service validates the key and sender permission again on every send.

## Included

- Supabase persistence adapter for templates, revisions, routing, triggers and module settings.
- Host database schema and atomic template-revision SQL functions.
- Server-only Mail System API client and connection verification.
- Explicit setup outcomes: connected, no sender assigned, invalid API key, inactive External System or invalid scope, missing configuration, network failure and Mail System failure.
- Template authoring, variable discovery, preview, revision history and restore.
- Priority-based conditional sender routing and event triggers.
- Recipient resolution delegated to trusted host-side code.
- Embeddable React console with module enable/disable, connection test and appearance controls.
- Automated contract and behavior tests.

## Quick start

1. Copy this folder into the host application's source tree.
2. Apply `schema.sql`, then `supabase-functions.sql` to the host application's database.
3. Configure server-only `MAIL_SYSTEM_URL` and `MAIL_SYSTEM_API_KEY`.
4. Register the host as an External System in Mail System. Issue an active key with the exact `mail:send` scope and assign at least one active sender mailbox.
5. Create the host's authenticated Supabase client, call `createSupabaseMailModuleStore(client)`, and mount `MailModuleConsole` behind the host's own admin authorization.
6. Pass a server-side `onTestConnection` callback that calls `verifyMailSystemConnection()`. Do not pass the key to a Client Component.
7. Test the connection, choose an assigned sender, configure templates/routes/triggers, then enable the module.

See [INSTALL.md](./INSTALL.md), [API.md](./API.md) and [schema.sql](./schema.sql). The module does not create public admin routes or bypass host authorization.
