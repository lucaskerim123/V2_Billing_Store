-- Repair OrbitFS deployer Vault reference storage for rebuilt/partially migrated Billing Store databases.
-- Idempotent and intentionally private: customer/provider secrets remain in Supabase Vault.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.orbitfs_release_secret_refs (
  key text primary key,
  secret_id uuid not null,
  updated_at timestamptz not null default now()
);

create table if not exists private.orbitfs_provider_connection_secrets (
  connection_id uuid primary key references public.orbitfs_provider_connections(id) on delete cascade,
  access_token_secret_id uuid,
  refresh_token_secret_id uuid,
  updated_at timestamptz not null default now()
);

create table if not exists private.orbitfs_installation_secret_refs (
  installation_id uuid primary key references public.orbitfs_installations(id) on delete cascade,
  secret_refs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

revoke all on all tables in schema private from public, anon, authenticated;
