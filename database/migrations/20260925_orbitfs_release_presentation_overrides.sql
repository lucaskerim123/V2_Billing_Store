-- Billing Store customer-facing presentation overrides for remote OrbitFS releases.
-- Technical release authority remains in License Manager; this table only stores portal copy.

create table if not exists public.orbitfs_release_presentation_overrides (
  release_id text primary key,
  release_type text not null check (release_type in ('base','update')),
  title text,
  description text,
  changelog text,
  customer_notes text,
  updated_at timestamptz not null default now()
);

alter table public.orbitfs_release_presentation_overrides enable row level security;
revoke all on public.orbitfs_release_presentation_overrides from anon, authenticated;

create index if not exists orbitfs_release_presentation_overrides_updated_idx
  on public.orbitfs_release_presentation_overrides(updated_at desc);
