# OrbitFS Base Release Runbook — Billing Store

The Billing Store is the commercial and customer control plane. It owns products, orders, payments, customer portal, support and deployment orchestration. The License Master remains the authority for licences, entitlements, installation identity, release metadata and release artifacts.

## 1. Required production configuration

Server-only:

- `SUPABASE_SERVICE_ROLE_KEY`
- License Master API authority is fixed at `https://api.incendiarynetworks.cc` in `src/lib/master-api.ts`.
- `BILLING_API_TOKEN` — License Master credential for licence/release operations
- `DEPLOYER_API_TOKEN` — License Master credential for deployment/update operations
- `MASTER_API_TIMEOUT_MS` (optional; defaults to 10000 ms)
- `PANEL_RELEASE_PUBLISHER_TOKEN` if an internal publisher endpoint is enabled
- `CRON_SECRET`

Browser-safe:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Never put the Master tokens, publisher token, Supabase service-role key, provider access/refresh tokens, installation secrets or database passwords in `NEXT_PUBLIC_*` variables.

## 2. Master API connection gate

The Store must be able to call the production License Master before enabling release/deployment actions. Treat a missing Master URL or token as a configuration error, not as an anonymous/fallback mode.

The Store must use the Master API for authoritative licence/release operations. Local Store tables may hold customer/order/deployment state and cached references, but they must not become a second source of truth for licence validity.

## 3. Base release gate

A published Base release must exist in License Master with:

- component `orbitfs_base`
- version
- source commit
- schema version
- SHA-256
- artifact size/file count
- release channel and rollout
- changelog/customer notes
- compatibility information

The Store must retrieve the artifact through the authenticated Master API. Do not expose a raw Master artifact endpoint to customers without the authentication/signing mechanism intended by the Master API.

## 4. Customer deployment gate

A customer deployment is valid only when all of the following are true:

1. Customer is authenticated.
2. Customer owns/has entitlement for `orbitfs_base`.
3. Installation belongs to that customer.
4. Customer has connected the required provider account(s).
5. The selected Supabase project is not the Store database.
6. The selected Base release is published and compatible with the installation schema.
7. Deployment settings permit the requested action.
8. Deployment events are recorded.
9. The installation is synchronised back to License Master.

## 5. Customer database

The Store must never initialise OrbitFS against its own Store database. A customer installation gets its own Supabase project/database. The database schema used for a Base release must be reproducible and versioned; do not depend on an undocumented hand-edited database state.

If an existing customer Supabase project is selected, validate that the project is reachable and safe to use before writing installation state. If the administrator has disabled existing-project selection, reject the operation clearly.

## 6. Vercel deployment

The customer connects the Vercel account/team used for their OrbitFS installation. The Store uses the customer's provider connection to create/update the customer's Vercel project. Store credentials and provider tokens remain server-side.

The deployed Panel must receive only the environment/configuration it needs. Never inject Store service-role credentials or the Store Master API tokens into the customer deployment.

## 7. Initial Base deployment sequence

`Paid order → Base entitlement → Customer portal → My OrbitFS → connect Vercel/Supabase → select/create customer Supabase project → initialise customer schema → obtain published Base release → deploy Panel → health check → create/bind installation → sync deployment state to License Master → customer opens Panel`

A failed step must leave an explicit failed/pending state rather than pretending deployment succeeded.

## 8. Updates and rollback

Updates use the same installation and release identity rules as initial deployment. Before applying an update, verify schema compatibility and that the target release is published and permitted by the release system settings.

Rollback must target a known-good release. Do not mutate old release records to hide the bad deployment. Record deployment events and keep the previous release/version visible to administrators.

## 9. Admin configuration

Release/deployment controls should be database-backed and configurable. The administrator must be able to enable/disable the release system, customer deployments, customer updates and customer rollbacks, and configure supported Supabase/project behaviour and release channel without editing application source code.

Do not silently bypass a disabled capability in a route or background worker.

## 10. Final Base release checklist

- Production Master API reachable.
- Master tokens configured server-side.
- Published `orbitfs_base` release exists.
- Artifact download uses authenticated Master API access.
- Customer entitlement is checked before deployment.
- Store database is excluded as a customer database target.
- Fresh customer database can be initialised from the release's supported schema.
- Vercel connection works.
- Base Panel deploys to the customer's Vercel project.
- Installation record is created and linked to the customer.
- Master deployment/licence state is synchronised.
- Customer can open the deployed Panel.
- Update path is blocked when schema/release compatibility fails.
- Rollback path targets a known-good release.
- Deployment failures are visible in admin/customer state and deployment events.
- No server-only secret is present in browser code or customer environment variables.
