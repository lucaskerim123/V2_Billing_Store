# Module API

## Connection verification

- `getMailModuleConfig(env?)` reads and validates HTTPS `MAIL_SYSTEM_URL` and server-only `MAIL_SYSTEM_API_KEY`.
- `verifyMailSystemConnection(config?)` calls the central sender-discovery endpoint and returns a typed status, safe message, sender list and `canSend` flag. It never returns the API key.
- `getSenders(config?)` retrieves only sender mailboxes assigned to the connected External System.
- `sendMessage(input, config?)` verifies the connection and sender assignment before calling the central send endpoint.

## Host persistence

- `createSupabaseMailModuleStore(client)` adapts an authenticated Supabase JS client to `MailModuleStore`.
- `schema.sql` creates the host-owned tables.
- `supabase-functions.sql` creates SECURITY INVOKER functions for atomic template save + revision snapshot and revision restore.
- The host owns RLS policies, tenant isolation, authenticated client creation and administrator authorization.

## Server-side operations

- `getModuleCapabilities()` returns connection state and permitted senders.
- `sendConfiguredMail({ store, templateKey, routeKey, context, resolveRecipients })` checks module enablement, template state, recipient output, route selection and sender permission before sending.
- `dispatchMailEvent({ store, eventKey, context, resolveRecipients })` loads an active trigger and dispatches its template using a trusted host-side recipient resolver.
- `resolveMailRoute(routes, context, fallbackSender)` selects the highest-priority active route whose conditions match.
- `configureTemplate`, `configureRoute`, `configureTrigger` and `updateModuleSettings` validate host-owned configuration before saving.

## Route conditions

Conditions use dotted context paths. A scalar means exact equality. Object operators are `equals`, `notEquals`, `in` and `contains`. All conditions on a route must match. Higher numeric priority wins. An empty condition object matches all contexts. If no route matches, the configured default sender is used. A trigger with an explicit route fails closed if that route is inactive or does not match.

## Connection status values

`connected`, `no_senders_assigned`, `invalid_api_key`, `external_system_or_scope_invalid`, `configuration_missing`, `mail_system_unavailable`, `network_error`, and `unknown_error`.

The central API's current sender-discovery contract is `GET /api/mail/senders`, authenticated with a Bearer API key. It requires an active External System and an API key with exactly the `mail:send` scope. Sending uses `POST /api/mail`; the central API independently enforces mailbox access.

## Security and responsibility boundary

The host owns authentication, admin authorization, database access, tenant isolation, templates, revision history, triggers, routing, recipient resolution and module appearance. The central Mail System owns transport, mailboxes, API credentials/scopes, delivery processing and central logs. The API key is read only by server-side code and is never passed to React components. Recipient resolution must run in trusted server-side host code. Do not accept recipient addresses or event context directly from untrusted browser input. HTML template sanitization is the host application's responsibility.

The central Mail System currently applies its mailbox-level or global Reply-To configuration. This module does not override that setting.
