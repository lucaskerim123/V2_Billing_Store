-- Dedicated OrbitFS Billing Store API keys (OBS-). Values are never stored.
create table if not exists public.orbitfs_billing_api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 120),
  key_hash text not null unique check (length(key_hash)=64),
  key_last4 text not null check (length(key_last4)=4),
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active','revoked')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.orbitfs_billing_api_keys enable row level security;
revoke all on public.orbitfs_billing_api_keys from anon, authenticated;
grant select, insert, update on public.orbitfs_billing_api_keys to service_role;
create index if not exists orbitfs_billing_api_keys_active_idx on public.orbitfs_billing_api_keys (status) where status='active';
