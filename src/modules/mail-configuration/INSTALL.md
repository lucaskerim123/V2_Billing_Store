# Installation and setup

## 1. Copy the module

Copy the complete `mail-configuration-module` folder into the host application's source tree. Keep it as a distinct folder so it can be upgraded or transferred independently. Do not copy the Mail System's Next.js application files.

## 2. Install host dependencies

The host needs React 18 or later for the optional console and a Supabase JS client if using the supplied adapter. The adapter accepts an existing Supabase client structurally and does not bundle a second Supabase SDK. The host must already be configured for TypeScript and JSX if it imports the React console.

## 3. Apply the host database schema

Run these files against the **host application's database**, in this order:

1. `schema.sql`
2. `supabase-functions.sql`

The SQL creates host-owned templates, immutable revisions, routes, triggers and module settings. It starts with the module disabled. The functions use SECURITY INVOKER; they do not bypass row-level security.

The schema enables RLS and intentionally does not install permissive policies. Before mounting the console, create policies that restrict reads and writes to the host application's authorized administrators and tenant. Ensure the authenticated role can select, insert, update and delete only the rows it is permitted to manage. Do not solve RLS failures by using a service-role key in the browser.

## 4. Configure the central Mail System connection

Set these environment variables in the host application's **server runtime**:

```env
MAIL_SYSTEM_URL=https://your-mail-system-domain
MAIL_SYSTEM_API_KEY=your-external-system-api-key
```

Use the Mail System origin, without an `/api` suffix. Keep both variables server-only. Never prefix them with `NEXT_PUBLIC_`, render them into HTML, pass them as component props, or store them in browser storage.

`MAIL_SYSTEM_API_KEY` must be the key issued for this host's External System in the central Mail System. The External System must be active. The key must have `mail:send` or `mail:admin` scope for the sender-discovery endpoint. Send-only keys require assigned active sender mailboxes; admin-scoped keys discover active mailboxes across the system. A user login token or a general user API key is not a substitute for this External System integration key.

## 5. Verify the connection

The module's `verifyMailSystemConnection()` reads the two environment variables on the server and calls:

- `GET {MAIL_SYSTEM_URL}/api/mail/senders`
- Header: `Authorization: Bearer {MAIL_SYSTEM_API_KEY}`

The setup result is explicit:

| Result | Meaning / action |
|---|---|
| Connected | Key accepted and one or more permitted active senders discovered. |
| No sender assigned | Key is accepted, but no active sender mailbox is assigned to the External System. |
| Invalid API key | Mail System returned 401; check the key value, revocation and whitespace. |
| External System or scope invalid | Mail System returned 403; activate the External System and issue a key with `mail:send` or `mail:admin`. |
| Configuration missing | Set `MAIL_SYSTEM_URL` and `MAIL_SYSTEM_API_KEY` in the host's server environment. |
| Network error | Check host outbound access, DNS, TLS and the Mail System URL. |
| Mail System unavailable | The endpoint responded with a server error; inspect central Mail System logs. |

The verification endpoint returns only active mailboxes allowed by the API key. Admin scope can discover active mailboxes system-wide; it does not expose message data.

## 6. Create the host store

For Supabase, create the host's authenticated client using the host's normal session and RLS configuration, then:

```ts
import { createSupabaseMailModuleStore } from "./mail-configuration-module/supabase-store";

const store = createSupabaseMailModuleStore(authenticatedSupabaseClient);
```

The adapter persists templates, revisions, routes, triggers and settings. Template save and revision snapshot creation happen in one database function/transaction. The host remains responsible for authenticated client creation and tenant-aware RLS.

## 7. Mount the administration console

Mount `MailModuleConsole` inside a page protected by the host application's own admin authorization. Set `canManage` only after the host has authorized the current user.

The `onTestConnection` callback must execute server-side:

```ts
"use server";

import { verifyMailSystemConnection } from "./mail-configuration-module/client";

export async function testMailSystemConnection() {
  return verifyMailSystemConnection();
}
```

Pass that server action as `onTestConnection`. Do not pass `MAIL_SYSTEM_API_KEY` or a configured client object into the browser. The console reports connection state and permitted sender addresses without displaying the secret.

## 8. Send from trusted host code

Call `sendConfiguredMail` or `dispatchMailEvent` only from trusted server-side host code. Resolve recipient addresses from trusted host records. Never let browser input choose arbitrary recipients or supply privileged event context. The module checks that the selected sender is assigned to the API key; the central Mail System checks it again.

## 9. Go live safely

1. Test the connection and confirm the expected sender addresses appear.
2. Create a disabled template and preview it with representative data.
3. Configure routing rules and event triggers.
4. Implement trusted recipient resolvers for each event.
5. Send a controlled test message to an address you control.
6. Inspect central Mail System delivery logs.
7. Enable the module and then activate production triggers.

## Disable or uninstall

Disable the module first. Disable event triggers, revoke the External System API key in the central Mail System, remove the host environment variables, then remove the module folder and its host database objects when no longer needed. Preserve or export template records first if they are required for audit/history.


## Billing Remote Staff integration

The Billing build workspace contains the upgraded Remote Staff integration files. Copy only the selected workspace into the Billing application when it has been reviewed and promoted; do not copy both workspaces.

Grant the Billing External System key only the scopes it needs: `remote:staff:sync` for hire/promotion/transfer/status sync, `remote:staff:terminate` for immediate termination, and `remote:identity:exchange` for human Remote User sessions. Keep existing `mail:send` only if Billing also sends mail. Do not grant `mail:admin` for Remote Staff.

In Mail System Administration → Remote Staff & Delegated Access, enable the External System delegation, define the permitted role, department and group codes, mailbox IDs, access profile IDs and per-mailbox capability ceilings. Register the public JWK used by Billing. Configure the exact issuer and audience expected in actor assertions. Store the corresponding private signing key only in Billing's server-side secret store.

Call `syncRemoteStaff` after each hire, promotion, demotion, department transfer or leave/suspension status change. Use a unique event ID and a strictly increasing source revision per employee. Call `terminateRemoteStaff` for termination. Do not reuse old event IDs or source revisions. If a response reports `pending_review`, an administrator must fix the missing mapping; do not invent access in Billing.

The Remote Staff connector does not add a host-side employee database. Billing remains authoritative for its own employee records. Mail System remains authoritative for Remote User identity state, access mappings, mailbox grants, sessions and audit.
