-- Scope OBS integration keys by active Billing endpoint (shared Billing database).
alter table public.orbitfs_billing_api_keys
  add column if not exists target_profile text not null default 'both';
alter table public.orbitfs_billing_api_keys
  drop constraint if exists orbitfs_billing_api_keys_target_profile_check;
alter table public.orbitfs_billing_api_keys
  add constraint orbitfs_billing_api_keys_target_profile_check
  check (target_profile in ('main','fallback','both'));
comment on column public.orbitfs_billing_api_keys.target_profile
  is 'Main, Fallback or Both; enforced at API authentication based on deployment mode.';
