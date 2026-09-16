-- Token tables owned by the Billing Store identity model.
create table if not exists public.orbitfs_email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  request_ip inet,
  created_at timestamptz not null default now()
);
create index if not exists orbitfs_email_verification_tokens_user_idx on public.orbitfs_email_verification_tokens(user_id,created_at desc);

create table if not exists public.orbitfs_password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  request_ip inet,
  created_at timestamptz not null default now()
);
create index if not exists orbitfs_password_reset_tokens_user_idx on public.orbitfs_password_reset_tokens(user_id,created_at desc);

alter table public.orbitfs_email_verification_tokens enable row level security;
alter table public.orbitfs_password_reset_tokens enable row level security;
revoke all on public.orbitfs_email_verification_tokens from anon,authenticated;
revoke all on public.orbitfs_password_reset_tokens from anon,authenticated;

-- auth_user_id is now a legacy compatibility field. New application identities do not require
-- a corresponding row in auth.users.
alter table public.customers drop constraint if exists customers_auth_user_id_fkey;
alter table public.customers alter column auth_user_id drop not null;
