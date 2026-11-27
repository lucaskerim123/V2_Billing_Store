# Billing Store Integration Manager

The Integration Manager belongs to V2 Billing Store only. It is a permanent admin feature; individual integrations are separate, registered modules.

## Runtime model

- Put each Billing Store integration in `src/integrations/<integration-id>/` at the repository root under `src/` (for example, `src/integrations/mail/`). The folder name must match the manifest `id`.
- Every integration folder must contain `manifest.json` using the `orbitfs-billing-integration-v1` format. The Integration Manager scans `src/integrations/` at server startup/build import time and automatically lists valid manifests; no separate hard-coded registry entry is needed.
- The manifest declares display name, version, publisher, required environment variables, features and relative entrypoint paths. Entrypoints must stay inside the integration folder.
- Discovery reads metadata only. It never dynamically imports or executes code declared by a manifest. Integration code is bundled with the Billing Store application and must be connected through reviewed host-side code/routes before it can run.
- Install/uninstall changes the persistent registration state. It does not download or execute code.
- Enable/disable changes runtime availability. Disabling stops Billing Store event dispatch and leaves integration configuration and data intact.
- A new executable integration is added as a separately maintained module, given a manifest and registry entry, tested, then included in a manually authorised production deployment.
- The manager does not execute arbitrary JavaScript from uploaded packages.

This first version uses a hard-coded trusted publisher/source allowlist for bundled modules. It does not yet accept external signed packages. Before adding downloadable packages, implement Ed25519 verification over a canonical manifest and artifact digest, pin the trusted public key in the host, and keep the private signing key outside the application repository. Do not treat a manifest field or a self-supplied hash as a cryptographic signature.

## Database ownership

Integration state, audit history and integration-owned Billing data are sourced in `lucaskerim123/Master-Database-System`, under the Billing Storefront service database. Billing Store repositories must not contain authoritative database migrations.

Live Billing Store database migrations remain manual-only. A source migration commit only validates and builds the database artifact; it does not apply the migration to the shared live Supabase project.

## Current registration

The first discovered integration is Mail System. Its host-adapted package lives in `src/integrations/mail`. See [Mail integration](./mail.md).
