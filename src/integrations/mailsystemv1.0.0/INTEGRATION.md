# Host integration contract

This document defines the boundary between the Billing Mail Configuration add-on and an external host such as Billing Store. The host may still be under development: the add-on does not require its final page layout, manager implementation or database schema to exist before the integration contract can be reviewed.

## Ownership

| Concern | Owner |
|---|---|
| Staff, customers, accounts, roles, groups and departments | Host application |
| Host authentication, authorization, tenant boundaries and admin navigation | Host application |
| Event occurrence and trusted event context | Host application |
| Recipient resolution from host records | Host application |
| Templates, revisions, sender routes, triggers and module settings | Host application database, managed through this add-on |
| Mail transport, sender mailboxes, External System API credentials and delivery logs | Central Mail System |
| Remote User identity state, delegated access mappings, mailbox grants and revocable sessions | Central Mail System, based on host-authoritative staff sync |

The add-on does not import host application code or assume host-specific table names. The host calls its exported functions through server-side adapters.

## Install boundary

Install only this package/folder. Do not install the parent `mail-configuration-module` workspace, the Mail System application, or any sibling workspace. The add-on is not a replacement for the host's manager or permission system.

## Admin console

The host renders `MailModuleConsole` inside its own admin area and supplies:
- a host-authenticated Supabase client or another `MailModuleStore` implementation;
- `canManage`, derived from the host's own permission checks;
- a server-side `onTestConnection` callback;
- any host-specific wrapper styling or navigation.

The add-on must not decide who is a Billing administrator. It receives the authorization decision from the host. Never expose `MAIL_SYSTEM_API_KEY`, a service-role key or signing secrets to the browser.

## Event integration

The host calls `dispatchMailEvent` from a trusted server-side event handler. The host supplies the event key, trusted context and recipient resolver. The resolver reads the host's own records and returns recipient addresses; it must not trust recipient addresses supplied by the browser.

```ts
import { dispatchMailEvent } from "billing-mail-configuration";

export async function onBillingEvent(event: TrustedBillingEvent) {
  return dispatchMailEvent({
    store: mailModuleStore,
    eventKey: "billing.invoice.created",
    context: {
      invoiceId: event.invoiceId,
      customerId: event.customerId,
      amount: event.amount,
      currency: event.currency,
    },
    resolveRecipients: async (_mapping, context) => {
      const customer = await billingRepository.getCustomer(String(context.customerId));
      if (!customer?.email) throw new Error("Customer email is unavailable.");
      return customer.email;
    },
  });
}
```

Use event keys and context fields agreed between the host and its own event handlers. Configure the matching template, route and trigger in the add-on console. A disabled module, disabled trigger or missing template must fail closed or return a skipped result as documented by the dispatcher.

## Contextual UI integration

A host may add a small action to an existing customer, invoice or staff profile. That UI calls a host-authenticated server action. The server action validates the host record and permissions, then calls `sendConfiguredMail` with a trusted recipient resolver. The add-on does not create the profile page, own the customer record or accept arbitrary browser-selected recipients.

## Remote Staff integration (optional)

For applications that want Mail System mailbox access to reflect their own staff lifecycle, call `syncRemoteStaff` and `terminateRemoteStaff` from trusted host-server lifecycle hooks. The host remains authoritative for staff identity, employment status and role/department/group codes. Mail System applies only the access explicitly delegated by its administrators.

The host must:
- provision an External System key with only the required Remote Staff scopes;
- provide unique event IDs and monotonically increasing source revisions;
- keep actor-assertion signing keys in server-side secret storage;
- call termination when employment ends and never represent termination as an ordinary status update;
- handle `pending_review` and unmapped assignments without guessing or granting access.

The optional `RemoteStaffAdmin` component is presentation only. Its callbacks must call host-protected server actions. It does not own staff records or permission decisions.

## Integration sequence

1. Install the add-on without changing the host's existing manager.
2. Implement the host store and RLS policies.
3. Mount the console behind the host's existing admin authorization.
4. Configure and verify the central Mail System External System connection.
5. Add one event integration using trusted context and recipient resolution.
6. Add contextual profile actions only where useful.
7. Add Remote Staff lifecycle sync only if the host needs delegated Mail System access.
8. Test with the module and triggers disabled first; enable only after review.
