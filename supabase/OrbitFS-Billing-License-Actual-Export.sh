#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="${PROJECT_REF:-}"
DB_URL="${DB_URL:-}"

if [[ -z "$DB_URL" ]]; then
  read -r -p "Supabase Postgres connection string: " DB_URL
fi

OUT="OrbitFS-Billing-Store-Export-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"

supabase db dump --db-url "$DB_URL" --schema public --file "$OUT/01_schema.sql"

TABLES=(
  app_settings system_settings staff_groups support_departments
  support_department_staff support_kb_categories support_message_templates
  support_premade_messages mail_templates mail_automations mail_settings
  payment_gateways payment_gateway_setups enforcement_settings
  license_api_settings orbitfs_release_system_settings orbitfs_themes
  role_definitions role_permissions option_sets
)

ARGS=(dump --db-url "$DB_URL" --schema public --data-only --use-copy)
for t in "${TABLES[@]}"; do
  ARGS+=(--table "public.$t")
done
ARGS+=(--file "$OUT/02_default_configuration_data.sql")
supabase "${ARGS[@]}"

cat > "$OUT/README.txt" <<'EOF'
OrbitFS V2 Billing Store Database Export

01_schema.sql = actual public schema dump: tables, constraints, indexes,
sequences, functions/RPCs, triggers and RLS policies.

02_default_configuration_data.sql = actual reusable configuration data only:
settings, staff groups/permissions, support departments/templates, mail
configuration/templates, payment gateway definitions/setup metadata, local integration mirrors/release-publication settings, themes and related defaults.

Customer accounts, orders, invoices, payments, tickets, audit logs, sessions,
local License Manager binding mirrors/installations/runtime logs, webhook events and other runtime
data are deliberately excluded from the data file.

Restore 01_schema.sql first, then 02_default_configuration_data.sql.
Configure new Auth/provider secrets separately.
EOF

echo "DONE: $OUT"
