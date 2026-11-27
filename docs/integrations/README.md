# Billing Store Integration Manager

The Integration Manager is a permanent core feature in Billing Store. Individual add-ons live separately under `src/integrations/<id>/`; the manager and host runtime live under `src/lib/integrations/`.

## Package discovery and execution

- The only add-on installation destination is `src/integrations/`. It is intentionally empty in this build apart from its Git keep-file. Do not copy or develop the Mail module here.
- A valid package is discovered from its `manifest.json`. Invalid or incomplete packages are ignored by discovery and rejected by the build-time runtime generator.
- `npm run dev` and `npm run build` generate static imports before Next.js starts/builds. This is required for Next.js to bundle package entrypoints safely; module top-level code must have no side effects.
- Install registers a package. Enable runs its optional `onEnable` hook and exposes its admin page, navigation and service handler. Disable runs `onDisable` and blocks the page, navigation, service handler and scheduled work without deleting configuration. Uninstall runs `onUninstall`, deletes the registration and cascades all module data stored in the integration data store.
- Optional `server` entrypoint hooks are `onInstall`, `onEnable`, `onDisable`, `onUninstall`, `handleRequest`, and `runScheduled`. Hooks must be idempotent; failures block the requested state transition.
- Module-owned configuration and records use `/api/admin/integrations/<id>/data`. Module service requests are dispatched through `/api/integrations/<id>/*` only while enabled. Module handlers remain responsible for caller-level authentication and authorization.
- Scheduled module work is dispatched daily through `/api/internal/integrations/scheduled`; Vercel must have `CRON_SECRET` configured.

## Billing-owned events

Business events are defined in `src/lib/billing-email-events.ts` and exist independently of integrations. The read-only authenticated endpoint `GET /api/admin/integrations/events` exposes stable event keys, descriptions and variable names. Sensitive token values are never included.

Billing Store owns event creation and trusted event payloads. An integration may configure handling for existing events, but cannot create, rename, or own Billing business events.

## Ownership boundaries

Billing Store owns customers, orders, subscriptions, payments, business workflows, event definitions, event payloads, authentication and authorisation. Modules must not delete or redefine Billing-owned records. Uninstall cleanup is limited to the module's registration and data in `app_integration_data`, plus external resources explicitly removed by `onUninstall`.

## Database and deployment

The migration `database/migrations/20261128090000_integration_manager_lifecycle.sql` creates the integration registry, module-owned data store, staff read policy and lifecycle RPC. It has been committed as code only and has not been applied to any Supabase database. Confirm the target database/ownership before applying it.

Production deployment remains manual-only. This work does not deploy, merge the PR, or modify the separate Master Database System or Mail System repositories.
