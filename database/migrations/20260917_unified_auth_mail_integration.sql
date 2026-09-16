-- Canonical OrbitFS account mail integration.
-- Account registration verification and password recovery are delivered through OrbitFS Mail.
-- Resend remains only the configured outbound transport.

alter table public.orbitfs_password_reset_tokens
  add column if not exists requested_by uuid references public.users(id) on delete set null;

create index if not exists orbitfs_password_reset_tokens_requested_by_idx
  on public.orbitfs_password_reset_tokens(requested_by,created_at desc);

-- Keep the canonical account events present in the OrbitFS Mail automation layer.
-- Existing template/sender configuration remains authoritative in mail_* tables.
insert into public.mail_automations(event_key,template_key,enabled,created_at,updated_at)
values
  ('account.email_verification','account.email_verification',true,now(),now()),
  ('account.password_reset','account.password_reset',true,now(),now())
on conflict (event_key) do update set
  template_key=excluded.template_key,
  enabled=true,
  updated_at=now();
