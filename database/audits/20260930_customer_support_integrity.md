# Billing Store database integrity review — 2026-09-30

**Live project verified:** OrbitFS Billing Store (`bealqgenrcytjzjoikmk`).
This is a live structural and targeted workflow audit, **not** an assertion that every UI/API flow or every database security permission has been integration-tested. No customer rows or credentials are stored here.

## Incident: customer support ticket foreign-key error

The customer created through the new canonical `public.users` / `auth.users` flow had no `public.user_profiles` record. The live `support_tickets.user_id`, `support_ticket_messages.author_user_id`, and wallet foreign keys refer to `user_profiles(id)`. A valid browser login was therefore insufficient for ticket creation.

The forward-only `20260930_customer_profile_wallet_fk_repair.sql` restores missing profiles and missing wallet rows **without changing existing balances**, installs idempotent automatic profile/wallet provisioning for customer inserts, and fixes profile-to-customer syncing via canonical `user_id`. `20260930_customer_number_canonical_profile_sync.sql` also fixes customer-number propagation.

The rollback-only database test exercised `create_support_ticket` with a real matching customer identity and the enabled Sales Enquiries department, including its database triggers, and verified a ticket number was returned. The test deliberately rolled back and confirmed it left **zero** test tickets. It did not test delivery of email or browser attachment uploads.

## Wider structural audit

The live public schema contains **100 tables, 130 foreign keys and 29 custom triggers**. All public tables have RLS enabled; all public foreign keys are validated. Some of the **228 NOT NULL columns without defaults** intentionally require application-supplied values; these are not automatically errors. Inspected current code for registration, canonical/browser login, customer portal support creation, file uploads, verification and logout against affected live schema.

The read-only repeatable query [20260930_customer_support_integrity.sql](./20260930_customer_support_integrity.sql) passed **11 of 11** targeted checks after the repair: matching customer identity, provisioned profile, provisioned wallet, unique customer links, no orphan profiles, valid FKs, ticket numbering default, onboarding trigger, private attachment bucket, active support jobs and restricted housekeeping RPCs.

The un-applied customer-mail-subscriptions migration contained a truncated function and duplicated SQL. Its pending file was corrected, tested in a transaction that rolled back all changes, then applied successfully to the confirmed live project. Seven configured subscription categories were verified. The migration runner was updated to skip directly applied dated aliases. The production migration workflow is now **manual dispatch only**; no application deployment was triggered.

## Remaining risks and checks

- The public schema has **159** anonymous-callable SECURITY DEFINER functions after the mail migration. This is an exposure inventory, not evidence that 159 functions are exploitable: some implement deliberate guest flows or check permissions internally. Review grants and each function's authorization logic individually; do not indiscriminately revoke public access and break registration, support or commerce.
- The manual-only migration workflow itself has not been dispatch-tested after these changes. Earlier runs failed on the malformed pending mail migration and a guard that rejected edits to an un-applied file; their historical failures do not represent the current live schema.
- A real customer support submission, attachment upload and actual notification delivery must still be verified in the browser. The successful database rollback test does not cover third-party delivery or end-user UI.
- The [schema inventory](../backups/2026-09-30-billing-live-schema-inventory.json) predates these additional repairs. Use this report, the forward migrations, and live checks together; it is **not** a restorable full SQL backup.

All changes are forward-only. Historical migration records and existing customer balances were preserved.
