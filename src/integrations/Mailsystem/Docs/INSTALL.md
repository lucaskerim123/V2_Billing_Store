# Installation and setup

## 1. Install the add-on

Install the package from its published package source, or copy only the `mail-configuration-module/Billing` folder into the host application's source tree. Keep it as a distinct module so it can be upgraded or transferred independently. Do not copy the Mail System's Next.js application or the sibling build workspaces.

## 2. Install host dependencies

The host needs React 18 or later for the optional console and a Supabase JS client if using the supplied adapter. The adapter accepts an existing Supabase client structurally and does not bundle a second Supabase SDK. The host must already support TypeScript and JSX if it imports the React console.

## 3. Apply the host database schema

Run these files against the **host application's database**, in this order: `schema.sql`, then `supabase-functions.sql`. They create host-owned templates, immutable revisions, routes, triggers and module settings. The module starts disabled.

The schema enables RLS and intentionally does not install permissive policies. Create host-specific policies that restrict reads and writes to authorized administrators and the correct tenant. The host remains responsible for authentication, tenant isolation and authorization. Never use a service-role key in browser code to bypass RLS.

## 4. Configure the central Mail System connection

Set these environment variables in the host application's **server runtime**:

```env
MAIL_SYSTEM_URL=https://your-mail-system-domain
MAIL_SYSTEM_API_KEY=your-external-system-api-key
```

Use the Mail System origin without an `/api` suffix. Keep both variables server-only. Never prefix them with `NEXT_PUBLIC_`, render them into HTML, pass them as component props, or store them in browser storage.

`MAIL_SYSTEM_API_KEY` must be issued for the host's External System in the central Mail System. The External System must be active. The key must have `mail:send` or `mail:admin` scope for sender discovery. Send-only keys require assigned active sender mailboxes; admin-scoped keys discover active mailboxes across the system. A user login token or general user API key is not a substitute.

## 5. Verify the connection

`verifyMailSystemConnection()` runs server-side and calls `GET {MAIL_SYSTEM_URL}/api/mail/senders` with `Authorization: Bearer {MAIL_SYSTEM_API_KEY}`. It returns typed outcomes for connected, no sender assigned, invalid key, inactive External System or invalid scope, missing configuration, network failure and Mail System failure. It never returns the API key.

## 6. Create the host store

For Supabase, create the host's authenticated client using its normal session and RLS configuration, then call `createSupabaseMailModuleStore(authenticatedSupabaseClient)`. The adapter persists templates, revisions, routes, triggers and settings. Template save and revision snapshot creation happen atomically through the supplied SQL function.

## 7. Mount the administration console

Mount `MailModuleConsole` inside a page protected by the host application's own admin authorization. Set `canManage` only after the host has authorized the current user. The `onTestConnection` callback must execute server-side and call `verifyMailSystemConnection()`. Do not pass the API key or a privileged client object into the browser.

## 8. Connect host events and UI

Call `sendConfiguredMail()` or `dispatchMailEvent()` only from trusted host-server code. Resolve recipients from trusted host records; never let browser input choose arbitrary recipients or supply privileged event context. The host can add a small UI entry point (for example, an email action on a customer profile) that calls its own authenticated server action, which then invokes the add-on. The add-on does not create or own the host's customer profile page.

For lifecycle integration, call the optional Remote Staff functions from trusted host-server hooks after hire, role change, department transfer, suspension or termination. Billing remains authoritative for staff records and permission decisions; Mail System stores the Remote User representation and enforces only the explicitly delegated mailbox capabilities. Use unique event IDs and monotonically increasing source revisions. Keep signing keys in the host's server-side secret store.

## 9. Go live safely

1. Test the connection and confirm only the expected sender addresses appear.
2. Create a disabled template and preview it with representative data.
3. Configure routing rules and event triggers.
4. Implement trusted recipient resolvers for each event.
5. Send a controlled test message to an address you control.
6. Inspect central Mail System delivery logs.
7. Enable the module and then activate production triggers.

## Disable or uninstall

Disable the module first. Disable event triggers, revoke the External System API key in Mail System, remove host environment variables, then remove the add-on and its host database objects when no longer needed. Preserve or export template records first if they are required for audit/history.
