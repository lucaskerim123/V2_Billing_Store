# Integration package contract

Place each add-on in `src/integrations/<id>/`. The core Integration Manager is in `src/lib/integrations/`; it is not an add-on. Discovery validates each package manifest and declared files. `npm run dev` and `npm run build` generate a static import registry before Next.js starts/builds, so Next can bundle module code without unsafe runtime filesystem imports.

Each package uses `orbitfs-billing-integration-v1`, `distribution: "bundled"`, and `serverOnly: true`. Entrypoints are statically imported from the package. An `adminPages` contribution can provide one page at `/admin/integrations/<id>`; an `adminMenu` contribution adds navigation only while the module is enabled. Both are checked against the installed/enabled database state and the declared staff permission.

An optional `server` entrypoint may export async `onInstall`, `onEnable`, `onDisable`, and `onUninstall` hooks, a `handleRequest(request, context)` handler for `/api/integrations/<id>/*`, and a `runScheduled(context)` handler. The host dispatches service requests only while the module is enabled and invokes scheduled handlers from the protected daily Vercel cron endpoint (set `CRON_SECRET`). Hooks must be idempotent. The host invokes the relevant hook before committing the lifecycle transition; a thrown error blocks the transition. Use these hooks to register/unregister module-owned external services. Never put credentials in client components or manifest files.

Persist module configuration and owned records through `/api/admin/integrations/<id>/data`. The data API is server-side, restricted to staff with `integrations.manage`, and stores module-owned settings and records under the module's `app_integrations.config` JSON object. Uninstall calls the central lifecycle RPC, then removes the module's registry row (including its config); the independent audit history is retained. Do not create module-owned tables for ordinary settings/data unless a separately reviewed migration explicitly defines their uninstall cleanup.

Billing-owned events, orders, customers, invoices, and other core records are not module-owned and must never be deleted by module uninstall. Module routes and services must independently authorize their callers. Environment requirements are server-only and are checked before enabling.

Mail remains a future add-on package; this change does not copy or modify the separate Mail System repository or Master Database System. No production database mutation or deployment is performed by this code change.
