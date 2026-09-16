-- Store-owned authentication tokens. Supabase Auth is not the application identity store.
create table if not exists public.orbitfs_email_verification_tokens (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
 token_hash text not null unique, expires_at timestamptz not null, used_at timestamptz, request_ip inet, created_at timestamptz not null default now()
);
create index if not exists orbitfs_email_verification_tokens_user_idx on public.orbitfs_email_verification_tokens(user_id,created_at desc);
create table if not exists public.orbitfs_password_reset_tokens (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
 token_hash text not null unique, expires_at timestamptz not null, used_at timestamptz, request_ip inet, created_at timestamptz not null default now(), requested_by uuid references public.users(id) on delete set null
);
create index if not exists orbitfs_password_reset_tokens_user_idx on public.orbitfs_password_reset_tokens(user_id,created_at desc);
create index if not exists orbitfs_password_reset_tokens_requested_by_idx on public.orbitfs_password_reset_tokens(requested_by,created_at desc);
alter table public.orbitfs_email_verification_tokens enable row level security;
alter table public.orbitfs_password_reset_tokens enable row level security;
revoke all on public.orbitfs_email_verification_tokens from anon,authenticated;
revoke all on public.orbitfs_password_reset_tokens from anon,authenticated;

insert into public.mail_automations(event_key,name,category,description,template_key,enabled,variables)
values
('account.email_verification','Account email verification','account','Send the OrbitFS account verification link.','account.email_verification',true,'["customer_name","verification_url","expires_hours"]'::jsonb),
('account.password_reset','Password reset','account','Send the OrbitFS password reset link.','account_password_reset',true,'["customer_name","reset_url","expires_minutes"]'::jsonb)
on conflict(event_key) do update set name=excluded.name,category=excluded.category,description=excluded.description,template_key=excluded.template_key,enabled=true,variables=excluded.variables,updated_at=now();
