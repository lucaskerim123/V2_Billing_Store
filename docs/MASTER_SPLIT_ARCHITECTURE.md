# OrbitFS Billing Store / License Master Architecture

## System boundary

`V2_Billing_Store` is the OrbitFS customer and administration application. It contains the Customer Portal and Admin Portal and owns commercial state: customers, orders, invoices, payments and fulfilment.

`OrbitFS-License-Master-V2` is a standalone authority and API. It owns licensing data, licence issuance, entitlements, installation bindings, release metadata and deployment/update jobs. The Store never writes directly to Master tables.

## Billing and licence issuance

The Billing Store **issues licences through the License Master API** after an order is paid and accepted. The Store does not locally manufacture or persist a second licensing authority.

```text
Customer places order
        -> payment succeeds
        -> order accepted / fulfilment starts
        -> V2_Billing_Store calls License Master API
        -> License Master creates/issues licence
        -> licence ID/key/details returned
        -> Store attaches licence to order/customer
        -> deployment/update controls become available
```

If License Master is temporarily unavailable, the paid order remains paid and fulfilment remains pending licence issuance. The Store retries the API operation when the Master is available.

## V2 Billing Store layout

### Customer Portal — frontend

- Customer account
- Orders / invoices / payment history
- Licence details and controls
- **Base Deployer** frontend
- **Update Releaser** frontend
- Downloads and support

### Admin Portal — frontend + Store-side orchestration

- Customers
- Orders / invoices / payments
- Licence controls through Master API
- **Base Deployer** frontend/middle layer
- **Update Releaser** frontend/middle layer
- Provisioning and fulfilment
- Release visibility/review controls

The Store-side middle layer authenticates the customer/admin request, checks Store ownership/permissions, calls the appropriate License Master API, and returns the result to the UI.

## Base Deployer

The Base Deployer is split between the Store UI/orchestration layer and the License Master deployment backend.

```text
V1-vercel-base
   -> base-release
   -> License Master Base Deployment Backend
   -> captured/approved Base release
   -> V2 Billing Store Base Deployer UI/middle
   -> customer Vercel/Supabase deployment
```

The Base deployment backend receives the `base-release` produced by `V1-vercel-base`. The customer never receives source-repository access. Deployment uses the customer's authorised Vercel/Supabase connection and the approved release.

## Update Releaser

The Update Releaser is likewise split between the Store UI/orchestration layer and the License Master update-release backend.

```text
V1-vercel-engine
   -> updates_release
   -> License Master Update Release Backend
   -> release metadata/package/eligibility
   -> V2 Billing Store Update Releaser UI/middle
   -> eligible customer sees update
   -> customer selects Deploy Update
   -> existing installation is updated in place
```

Updates are for existing installations. A normal update does not replace the customer's Vercel project or Supabase database and must preserve customer data.

## License Master API responsibilities

The Store uses server-side authenticated API calls for:

- licence issuance/reissuance/rotation
- licence validation and controls
- product and entitlement lookup
- release lookup and eligibility
- base deployment jobs
- update deployment jobs
- deployment status and synchronisation

The Master remains independently deployable and does not depend on the Store UI being available.

## Repository responsibilities

| Repository/system | Responsibility |
|---|---|
| `V2_Billing_Store` | Customer Portal, Admin Portal, ordering, billing, fulfilment, Base Deployer frontend/middle, Update Releaser frontend/middle |
| `OrbitFS-License-Master-V2` | License API, licence authority/data, Base Deployer backend, Update Release backend, release catalogue, deployment/update jobs |
| `V1-vercel-base` | Produces the `base-release` consumed by the Master Base Deployment backend |
| `V1-vercel-engine` | Produces the `updates_release` consumed by the Master Update Release backend |

## Authority rule

**Billing Store presents, sells, fulfils and orchestrates. License Master issues/validates licences and controls licensing/deployment authority. Customer systems execute the resulting deployment or update.**
