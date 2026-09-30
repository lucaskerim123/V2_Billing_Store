# Billing Store database baseline — 2026-09-30

Source: OrbitFS Billing Store Supabase project `bealqgenrcytjzjoikmk`.
Captured live schema inventory: [2026-09-30-billing-live-schema-inventory.json](./2026-09-30-billing-live-schema-inventory.json).

The inventory was read directly from the confirmed live project before the customer support ticket test. It includes the names of **all 100 public tables**, public views, live support columns and sequence default, support RPC signatures, support RLS policy names, triggers, storage-bucket metadata and support cron schedules. No customer rows, auth users, ticket contents, passwords, provider tokens or settings values are included.

**Important:** This is a *live schema inventory*, **not** a full SQL dump or independent disaster-recovery backup. It does not contain all public table column definitions, SQL bodies, indexes, constraints or sequence values. Do not try to execute the JSON to restore a database. Existing migration files remain untouched. The JSON captures what was actually deployed, whereas migration files describe intended historical changes.

For a complete restorable schema-only backup, use the repository's existing `supabase/OrbitFS-Billing-License-Actual-Export.sh` export workflow on a trusted machine with a database connection to this **specific** project, or run the standalone command below using the Supabase CLI:

```bash
# Obtain DB_URL securely from Supabase > OrbitFS Billing Store > Connect.
# Check the hostname/project before running. Do not commit or echo the URL.
mkdir -p database/backups/local-schema
supabase db dump --db-url "$DB_URL" --schema public --file database/backups/local-schema/01_schema.sql
```

Review generated SQL for embedded sensitive values in function bodies/defaults before committing. Store full data backups in an encrypted private backup location, **not GitHub**. Keep Auth, storage object bytes, extension/managed schemas and Supabase platform configuration in mind: a public-schema SQL dump alone does not restore those.

Support verification after the latest fixes: submit a new ticket from the customer portal; confirm it receives a ticket number, appears in customer and staff queues, allows a private attachment upload, routes correctly, and triggers the expected notifications. Escalation/expiry can be tested separately.