# License Master Product Authority

The OrbitFS License Master V2 is the authoritative product and licence catalogue. Billing/Store is a client of the Master and must not become a second source of truth for OrbitFS product definitions.

## Canonical products

- `orbitfs_base` — OrbitFS Base System
- `orbitfs_mcp` — OrbitFS MCP
- `orbitfs_apex` — OrbitFS Apex System
- `orbitfs_studio` — OrbitFS Studio

The Master catalogue controls product name, slug, description, active/public/purchasable state, component key, runtime, engine/base requirements, installation limits, release policy, pricing, currency, billing interval, payment provider IDs, features and entitlement defaults.

## Billing integration

Billing requires these server-only environment variables:

- `MASTER_API_URL` — production License Master URL. Use `https://incendiarynetworks.cc/api` (the client normalizes an optional trailing `/api`).
- `BILLING_API_TOKEN` — server-only License Master managed API credential with the `license.issue` scope (or `license.manage`).
- `DEPLOYER_API_TOKEN` — server-only License Master managed API credential for deployment operations when those operations are used.
- `MASTER_API_TIMEOUT_MS` — optional request timeout.

The Store calls the Master product endpoint at `/api/v1/products`. The Master catch-all routes this path to the database-backed product catalogue (`license_products`). `/api/products` remains available as the legacy equivalent.

The public Billing landing page reads its product catalogue from the Master. Product detail pages use `/api/orbitfs/catalog`, which joins authoritative Master data with the local Billing product record only to obtain the Billing database product ID and local checkout configuration/options. Master name, slug, description, price, currency, availability and component metadata override the local mirror.

Before an order/invoice is created, the selected product is synchronised from the Master into the local Billing product row. If the Master product is inactive or not purchasable, checkout is blocked. If the Billing mirror is missing, checkout fails instead of silently creating a different product.

## Rules

1. Create and edit OrbitFS products in License Master.
2. Do not manually change OrbitFS product name, slug, price, currency or licence component identity in Billing as a source-of-truth operation.
3. Billing may retain a local product row because its checkout schema requires a local product ID and local product options.
4. The local row is a mirror/cache and is synchronised from Master before checkout.
5. Licence issuance, validation, activation, component entitlement and installation authority remain with License Master.
6. Billing owns customers, orders, invoices, payment state and commercial fulfilment.
7. Never expose `BILLING_API_TOKEN` or `DEPLOYER_API_TOKEN` to browser code.
