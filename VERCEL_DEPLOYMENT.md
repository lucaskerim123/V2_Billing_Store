# V2 Billing Store — Vercel deployment

## Project
Deploy this repository as a Next.js application on any Vercel account/team that you control.

The Store itself is not tied to a particular Vercel account. Customer Vercel deployments are separate: the customer connects their own Vercel account/team and the Store uses that connection when deploying OrbitFS.

## Required environment variables
Set these in Vercel for Production, Preview, and Development as appropriate:

`NEXT_PUBLIC_SUPABASE_URL`

`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

`SUPABASE_SERVICE_ROLE_KEY`

`MASTER_API_URL` — URL of the independent License Master authority

`MASTER_API_TIMEOUT_MS` — optional request timeout, default 10000

`BILLING_API_TOKEN` — server-only Store credential for License Master licensing, entitlements, releases and licence control

`DEPLOYER_API_TOKEN` — server-only deployment/update credential for License Master deployment operations when that external deployment authority is enabled

`CRON_SECRET`

`SITE_URL` or `NEXT_PUBLIC_ORBITFS_STORE_URL` — canonical public Store origin for generated links

Never expose any of the server-only credentials as `NEXT_PUBLIC_*` variables.

`MASTER_API_TOKEN` is a License Master-side privileged secret. Do not put it in the Billing Store environment.

## Architecture
The Store owns customers, orders, billing, payments, support, customer provider connections, customer deployment state and the customer/admin control surfaces.

The independent OrbitFS License Master owns licence issuance, validation, licence authority, products/entitlements and the authoritative release/deployment control plane.

The Store is a commercial/control plane and License Master is the authoritative licensing plane. The Store must never contain a licence signing private key or become the licence authority.

## Customer Vercel/Supabase boundary
Customer provider credentials are stored server-side and are selected per authenticated customer. Deployment requests use the customer's connected Vercel token/team and customer's selected Supabase project. The Store's own Vercel account is never used as the customer's deployment target.

A customer can therefore connect a different Vercel account/team from every other customer without changing the Store deployment.

## Token boundary
Normal Store licensing calls use `BILLING_API_TOKEN`. Deployment/update calls use `DEPLOYER_API_TOKEN` when routed through License Master. Provider deployment credentials for customer Vercel/Supabase are separate customer connections and must never be sent to the browser.

## Vercel
Use the repository root as the project root and the Next.js framework preset.

Build command: `npm run build`

Install command: `npm ci`

Do not commit `.env.local` or any service token.

Keep the Vercel production branch set to `main`. The repository can be imported into a different Vercel account/team without changing application code; configure the environment variables for that deployment.

## Free-tier cron
`vercel.json` schedules `/api/cron/mail-automations` once daily at 03:00 UTC. Vercel sends the configured cron secret as a bearer token; the route also requires `SUPABASE_SERVICE_ROLE_KEY` and returns an explicit configuration error when either secret is missing.

## External integrations
The Store is designed to continue operating as its own application when License Master is unavailable. Paid orders can remain pending licence issuance until the authority is reachable. Customer deployment state is owned by the Store, while authoritative licence decisions remain external.

Release publication follows the License Master → Billing Store → customer flow: License Master prepares authoritative release data, Billing Store controls customer visibility/publication, and the customer portal exposes the published release for deployment to the customer's connected Vercel/Supabase environment.
