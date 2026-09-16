-- Finalise the canonical OrbitFS account model.
-- Supabase Auth is infrastructure only; public.users is the application identity.
-- The old custom token tables are superseded by the orbitfs_* token tables.

drop table if exists public.email_verification_tokens cascade;
drop table if exists public.password_reset_tokens cascade;

alter table public.customer_credentials drop column if exists canonical_user_id;
alter table public.customer_sessions drop column if exists canonical_user_id;

comment on column public.customers.auth_user_id is
  'Legacy Supabase Auth compatibility field. Canonical application identity is public.users.id via customers.user_id.';
