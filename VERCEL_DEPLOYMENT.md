# V2 Billing Store — Vercel deployment

## Project
Deploy this repository as a Next.js application on any Vercel account/team that you control.

The Store is portable between Vercel accounts. It does not depend on the old License API or the old Supabase project. The Store's database is whatever Supabase project you configure with the environment variables below.

## Required environment variables
Set these in Vercel for Production, Preview, and Development as appropriate:

`NEXT_PUBLIC_SUPABASE_URL` — the new Supabase project used by this Store

`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — publishable/anon key for that project

`SUPABASE_SERVICE_ROLE_KEY` — server-only service role key for Store database workflows

License Master API authority is fixed at `https://incendiarynetworks.cc/api`; `MASTER_API_URL` is not required.

`MASTER_API_TIMEOUT_MS` — optional request timeout, default 10000

`BILLING_API_TOKEN` — server-only Store credential for License Master licensing, entitlements, releases and licence control

`DEPLOYER_API_TOKEN` — server-only deployment/update credential for License Master deployment operations

`CRON_SECRET` — random secret used by the scheduled mail reconciliation endpoint

`SITE_URL` or `NEXT_PUBLIC_ORBITFS_STORE_URL` — canonical public Store origin

Payment/provider secrets used by the Store must also be configured from the names referenced by the application; none should be committed to GitHub. Never expose server-only credentials as `NEXT_PUBLIC_*` variables.

The same License Master managed API key may be used for both `BILLING_API_TOKEN` and `DEPLOYER_API_TOKEN` when it was created with the required scopes. `MASTER_API_TOKEN` is a License Master-side machine-key fallback and is not required in Billing Store.

## Architecture
The Store owns customers, orders, billing, payments, support, customer provider connections, customer deployment state and customer/admin control surfaces.

The independent OrbitFS License Master owns licence issuance, validation, licence authority, products/entitlements and authoritative release/deployment control.

All Store-to-Master authority operations go through the License Master V2 API. The Store never contains a licence signing private key and never becomes the licensing authority.

## License flow
Paid Store orders call License Master V2 through `BILLING_API_TOKEN` for licence issuance. The returned Master licence key/id are recorded against the Store-side order workflow. Validation and licence control are also delegated to Master through its API.

If License Master is unavailable, paid orders can remain pending licence issuance rather than silently becoming locally-authorized licences.

## Release flow
License Master is the authoritative release source. Billing Store reads published Master releases through the API and exposes only the releases allowed by its Store-side publication/handoff workflow. Customers then deploy through their connected provider credentials.

## Customer Vercel/Supabase boundary
Customer provider credentials are stored server-side and selected per authenticated customer. Deployment requests use the customer's connected Vercel token/team and customer's selected Supabase project. The Store's own Vercel account is never used as the customer's deployment target.

## Vercel
Use the repository root as the project root and the Next.js framework preset.

Install command: `npm ci`

Build command: `npm run build`

Keep the Vercel production branch set to `main`.

Do not commit `.env.local`, Supabase service-role keys, License Master API tokens, payment secrets or customer provider credentials.

The repository can be imported into a different Vercel account/team without changing application code. After import, add the values from `.env.example` and this document. No old License API URL, old Supabase URL, or old database credentials are required.

## Free-tier cron
`vercel.json` schedules `/api/cron/mail-automations` once daily at 03:00 UTC. The route requires `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY`.
