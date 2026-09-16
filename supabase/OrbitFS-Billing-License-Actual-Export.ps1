param(
  [string]$ProjectRef = "xwbjfhpgsvsjaykelufa",
  [string]$DbUrl = ""
)

$ErrorActionPreference = "Stop"

if (-not $DbUrl) {
  Write-Host "Enter the Supabase Postgres connection string for the rebuilt OrbitFS Store project."
  Write-Host "Use the Session Pooler connection string from Supabase -> Connect."
  $DbUrl = Read-Host "DB URL"
}

$Out = Join-Path (Get-Location) ("OrbitFS-Billing-License-Export-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $Out | Out-Null

$Schema = Join-Path $Out "01_schema.sql"
$Data = Join-Path $Out "02_default_configuration_data.sql"
$Roles = Join-Path $Out "03_roles.sql"

Write-Host "Exporting the actual public schema, functions, triggers, RLS policies, indexes, sequences and related database objects..."
supabase db dump --db-url $DbUrl --schema public --file $Schema

Write-Host "Exporting only the reusable billing/license configuration data..."
$keep = @(
  "app_settings",
  "system_settings",
  "staff_groups",
  "support_departments",
  "support_department_staff",
  "support_kb_categories",
  "support_message_templates",
  "support_premade_messages",
  "mail_templates",
  "mail_automations",
  "mail_settings",
  "payment_gateways",
  "payment_gateway_setups",
  "enforcement_settings",
  "license_api_settings",
  "orbitfs_release_system_settings",
  "orbitfs_themes",
  "role_definitions",
  "role_permissions",
  "option_sets"
)

$args = @(
  "dump",
  "--db-url", $DbUrl,
  "--schema", "public",
  "--data-only",
  "--use-copy"
)
foreach ($t in $keep) {
  $args += "--table"
  $args += ("public." + $t)
}
$args += "--file"
$args += $Data
supabase @args

Write-Host "Writing a restore/readme file..."
@"
OrbitFS Billing + License Database Export
=========================================

Source project: $ProjectRef

01_schema.sql
  Exact public-schema dump from the source database. This includes tables,
  columns, constraints, indexes, sequences, functions/RPCs, triggers and RLS
  policies as supported by Supabase's db dump.

02_default_configuration_data.sql
  Data-only export restricted to reusable system/configuration tables.
  Customer accounts, orders, invoices, payments, support tickets, audit logs,
  sessions, license runtime/binding/installations, webhook events, mail
  delivery history and other runtime/customer data are NOT exported.

03_roles.sql
  Placeholder for database roles if needed on a self-hosted target. Supabase
  manages its platform roles separately; do not import platform-managed roles
  blindly.

IMPORTANT
---------
This is a real database export process, not a seed/deployment wrapper.
The resulting SQL files are generated directly from the rebuilt OrbitFS Store
billing database at the time this script is run.

Restore order:
  1. Restore 01_schema.sql into the new Postgres/Supabase database.
  2. Restore 02_default_configuration_data.sql.
  3. Configure new Supabase/Auth secrets and external provider secrets.
  4. Do NOT copy production auth users or runtime/customer data.

The schema contains the full billing + license-system database structure even
though the data export is intentionally restricted to reusable configuration.
"@ | Set-Content -Encoding UTF8 (Join-Path $Out "README.txt")

Write-Host ""
Write-Host "DONE"
Write-Host "Export directory: $Out"
Write-Host "Schema: $Schema"
Write-Host "Configuration data: $Data"
