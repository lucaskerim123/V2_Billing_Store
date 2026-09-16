# OrbitFS Billing Store

This repository is the storefront and billing application for OrbitFS. It owns customers, orders, invoices, payments, downloads, and support. The independent OrbitFS License Master remains the only license authority: signing keys and license issuance never belong in this application.

## Local setup

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env.local` and fill in the Supabase and Master values.
3. Apply the SQL in `database/migrations/` to the Supabase project in order (or use the project’s normal migration workflow).
4. Install dependencies and run the development server:

```bash
npm ci
npm run dev
```

The browser can use the publishable Supabase key. `SUPABASE_SERVICE_ROLE_KEY`, `BILLING_API_TOKEN`, `DEPLOYER_API_TOKEN`, and `CRON_SECRET` are server-only secrets and must not be prefixed with `NEXT_PUBLIC_`. The same License Master managed API key may be placed in both `BILLING_API_TOKEN` and `DEPLOYER_API_TOKEN` when that key was created with the required licensing/release and deployment scopes.

## Checks

```bash
npm run lint
npm run typecheck
npm run build
```

## Vercel free-tier deployment

Create a Vercel project linked to this repository, keep the repository root as the project root, and use the Next.js preset with `npm ci` and `npm run build`. Add the variables from `.env.example` to the required Vercel environments. The checked-in `vercel.json` schedules mail reconciliation once per day, which is compatible with Vercel Hobby limits; the endpoint rejects requests unless `CRON_SECRET` is configured and matches the bearer token.

Use pull requests for review and merge deployable batches to `main`; do not use incidental agent branches as production deployment targets. Vercel's `ignoreCommand` skips deployments when a push changes only documentation or workflow files. CI is scoped to application changes, runs once per PR/main ref with cancellation for superseded runs, and does not invoke a second Vercel deployment. When several agents are working, batch related changes into one PR before pushing instead of pushing every intermediate commit.

The Store can run while Master is unavailable. License-dependent operations fail closed and report the Master error; the Store never creates or signs licenses locally.

See [`VERCEL_DEPLOYMENT.md`](./VERCEL_DEPLOYMENT.md) for the deployment checklist and [`docs/MASTER_SPLIT_ARCHITECTURE.md`](./docs/MASTER_SPLIT_ARCHITECTURE.md) for the authority boundary.
