# OrbitFS release pipeline

License Master is authoritative for release records and source capture. Base source is `lucaskerim123/V1-vercel-base` / `base-release`; existing-installation updates are `lucaskerim123/V1-vercel-engine` / `release-updates`.

Billing Store receives Master releases, applies final rollout visibility and customer-facing metadata, then publishes through License Master. My OrbitFS consumes published releases and uses the existing deployment control plane for customer deploy/update/rollback.


## Release channels

Billing Store owns customer-facing channel assignment. Every active customer has Stable as the baseline channel. Open channels are automatically eligible for customers; closed channels such as a closed Beta, Development, or custom channel require an explicit customer assignment in the Billing Store.

License Master remains authoritative for channel definitions, release records, technical validation, promotion and artifact eligibility. Billing Store mirrors channel definitions, assigns customers to channels, and hands promotion requests to License Master.

A release keeps the same release ID, artifact, manifest and checksum when promoted. Promotion changes the release channel and is audited by License Master; it does not rebuild or re-upload the artifact.

The same channel entitlement model applies to Base and Update releases. Customer update discovery uses the channels available to the customer's account and never relies on the legacy rollout field as an access-control mechanism.
