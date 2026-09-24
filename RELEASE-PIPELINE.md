# OrbitFS release pipeline

License Master is authoritative for release records and source capture. Base source is `lucaskerim123/V1-vercel-base` / `base-release`; existing-installation updates are `lucaskerim123/V1-vercel-engine` / `UPDATE_RELEASE`.

Billing Store receives Master releases, applies final rollout visibility and customer-facing metadata, then publishes through License Master. My OrbitFS consumes published releases and uses the existing deployment control plane for customer deploy/update/rollback.


## Release channels

Billing Store owns customer-facing channel assignment. Every active customer has Stable as the baseline channel. Open channels are automatically eligible for customers; closed channels such as a closed Beta, Development, or custom channel require an explicit customer assignment in the Billing Store.

License Master remains authoritative for channel definitions, release records, technical validation, promotion and artifact eligibility. Billing Store mirrors channel definitions, assigns customers to channels, and hands promotion requests to License Master.

Promotion creates a new channel-specific release record linked to the source release. It preserves the exact immutable artifact, checksum, source commit, technical approval and validation result; it does not rebuild or re-upload the artifact. The promoted record remains unpublished until Billing Store performs the final customer-facing publication step.

The same channel entitlement model applies to Base and Update releases. Customer update discovery uses the channels available to the customer's account and never relies on the legacy rollout field as an access-control mechanism.


The legacy `rollout` field is presentation metadata only. It must not grant or deny release access. Customer eligibility is determined by the installation release channel and License Master channel policy/access assignments.
