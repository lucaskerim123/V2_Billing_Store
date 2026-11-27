# Billing Store — Mail integration

## Source and install boundary

Feature source: `remipetrovich-design/Mail-system/mail-configuration-module/Billing`.

The nested Billing workspace declares itself build-only and explicitly says not to discover, install or publish it directly. The Billing Store package is therefore host-adapted: it uses the installable parent module's configuration, console, store and delivery implementation, plus the Billing-only Remote Staff client/types/admin component. The Mail System repository is read-only for this integration work.

## Ownership

Billing Store owns its templates, immutable template revisions, variables, event triggers, recipient resolution, sender-routing rules, module enable/disable state, appearance, admin authentication and host database.

The central Mail System owns mail transports, domains, sender mailboxes, External System API credentials/scopes, delivery processing and central delivery logs.

The integration uses the server-only `MAIL_SYSTEM_URL` and `MAIL_SYSTEM_API_KEY`. They must never be prefixed with `NEXT_PUBLIC_`, passed to client components, rendered into HTML or stored in browser storage.

## Capabilities

- Connection verification and permitted sender discovery.
- Template creation, preview, immutable revision history and restore.
- Priority-based conditional sender routing.
- Event-trigger configuration and trusted recipient resolution.
- Manager-controlled install, enable, disable and uninstall.
- Billing Remote Staff provisioning and termination using trusted server API calls.
- Server-side event dispatch through the registered integration.

The existing Billing Store `sendAutomation` entrypoint now delegates to the Mail integration. Existing trusted event producers can therefore use the same event keys, provided the integration is installed/enabled and an active trigger and template are configured. Invoice-paid lifecycle notifications use the same dispatcher. Dispatches with a related record ID are deduplicated by the host-side dispatch ledger. No Mail cron has been re-enabled.

## Required server configuration

- `MAIL_SYSTEM_URL`: HTTPS origin of the central Mail System, without an `/api` suffix.
- `MAIL_SYSTEM_API_KEY`: External System key issued for Billing Store.

The key must be active and have `mail:send` with sender mailbox assignments, or `mail:admin` for active sender discovery. Remote Staff actions additionally require `remote:staff:sync` and `remote:staff:terminate` scopes. The Mail System must have Remote Staff delegation configured with allowed role, department and group codes.

The admin console tests the connection server-side and displays only the verification result and permitted sender addresses. It never returns the API key.

## Remote Staff

Billing Store remains the source of truth for staff status, roles, departments and group assignments. Trusted Billing server code synchronizes staff changes and group/department changes to the Mail System when the integration is enabled. Removing a Billing staff member requests Remote User termination. The Remote Staff panel also supports manual synchronization and termination. The Mail System recalculates mailbox capabilities and revokes Remote User sessions/grants on termination.

The module exposes an identity-exchange client, but this admin integration does not yet mint actor assertions. That flow requires the Mail System's registered public JWK, a Billing-only private signing key, issuer/audience configuration and the exact assertion claim contract. Do not generate assertions in the browser or invent claims.

## Data and state behaviour

- Install registers the bundled integration; it does not fetch code.
- Enable/disable is stored centrally and mirrored to the Mail module's enabled setting.
- Uninstall disables and unregisters the module but retains templates, revisions, routing, triggers, dispatch history and Mail System data.
- The database migration is stored in the central Master Database System. It must be applied through the separate manual Billing Storefront migration workflow before the live admin page can operate.
- Production deployment remains manual-only.
