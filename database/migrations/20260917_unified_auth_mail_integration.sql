-- Canonical OrbitFS account mail integration.
-- Account registration verification and password recovery are delivered through OrbitFS Mail.
-- Resend remains only the configured outbound transport.

alter table public.orbitfs_password_reset_tokens
  add column if not exists requested_by uuid references public.users(id) on delete set null;

create index if not exists orbitfs_password_reset_tokens_requested_by_idx
  on public.orbitfs_password_reset_tokens(requested_by,created_at desc);

-- Keep the existing OrbitFS Mail templates/automations authoritative. These upserts
-- only ensure the account events are enabled and point at the existing templates.
insert into public.mail_automations(event_key,name,category,description,template_key,enabled,variables)
values
  ('account.email_verification','Account email verification','account','Send the OrbitFS account verification link.','account.email_verification',true,'["customer_name","verification_url","expires_hours"]'::jsonb),
  ('account.password_reset','Password reset','account','Send the OrbitFS password reset link.','account_password_reset',true,'["customer_name","reset_url","expires_minutes"]'::jsonb)
on conflict (event_key) do update set
  name=excluded.name,
  category=excluded.category,
  description=excluded.description,
  template_key=excluded.template_key,
  enabled=true,
  variables=excluded.variables,
  updated_at=now();
