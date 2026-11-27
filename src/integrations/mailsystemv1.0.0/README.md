# Billing Mail Configuration add-on

A portable, installable add-on for external applications, initially targeting Billing Store. It is maintained entirely in this folder and can be installed or copied into a host application's source tree without copying the Mail System application.

## Responsibility boundary

The **host application** owns its users, staff and customer records; authentication and permissions; tenant isolation; database; templates and immutable revisions; event triggers; recipient resolution; sender routing rules; module enable/disable state; appearance; and admin navigation. The add-on supplies the mail configuration UI, persistence adapter, routing and trigger engine, rendering, connection client, and optional Remote Staff connector.

The **central Mail System** owns mail transports, domains, sender mailboxes, API credentials/scopes, delivery processing, Remote User access enforcement, and central delivery/audit logs. The add-on connects to it using server-only `MAIL_SYSTEM_URL` and `MAIL_SYSTEM_API_KEY` values. Credentials are never exposed to browser code.

Billing Store is the first intended host, not a hard-coded dependency. The add-on does not import Billing Store code, create Billing Store routes, assume its database schema, or own its users/permissions. Its integration points accept host-provided authenticated storage, authorization decisions, event context and trusted recipient resolvers.

## Included

- Installable TypeScript package with independent build output and package exports.
- Supabase persistence adapter and host-owned schema/functions for templates, revisions, routes, triggers and settings.
- Server-only Mail System API client and connection verification.
- Template authoring, variable discovery, preview, revision history and restore.
- Priority-based conditional sender routing and event triggers.
- Trusted host-side recipient resolution.
- Embeddable React administration console and appearance controls.
- Optional Remote Staff provisioning, termination, signed actor identity exchange and admin component.
- Contract and behavior tests.

## Install

Install the package in the host application or copy this folder as a standalone module. See [INSTALL.md](./INSTALL.md) for dependencies, environment variables, database setup and authorization requirements. See [INTEGRATION.md](./INTEGRATION.md) for the host adapter boundary and Billing Store integration examples.

The host must mount the console inside its own authorized admin area. The module does not create public routes, bypass host permissions, or make assumptions about the host's unfinished manager UI.

## Configuration

The central connection requires server-only `MAIL_SYSTEM_URL` and `MAIL_SYSTEM_API_KEY`. Register the host as an External System in Mail System and grant only the scopes and sender assignments it needs. The module starts disabled; templates, routes and triggers must be reviewed and explicitly enabled by host administrators.
