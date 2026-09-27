-- One-time initial OrbitFS licence key delivery.
-- Billing owns customer presentation/delivery; License Manager remains the key authority.

create table if not exists public.license_key_deliveries (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  license_id text not null,
  token_hash text not null unique,
  license_key text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists license_key_deliveries_user_idx
  on public.license_key_deliveries(auth_user_id,created_at desc);
create index if not exists license_key_deliveries_license_idx
  on public.license_key_deliveries(license_id,created_at desc);

alter table public.license_key_deliveries enable row level security;
revoke all on public.license_key_deliveries from anon,authenticated;

create or replace function public.consume_license_key_delivery(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  r public.license_key_deliveries%rowtype;
  v_key text;
begin
  select * into r
  from public.license_key_deliveries
  where token_hash=p_token_hash
  for update;

  if not found then
    return jsonb_build_object('ok',false,'code','INVALID_LINK');
  end if;
  if r.used_at is not null or r.license_key is null then
    return jsonb_build_object('ok',false,'code','LINK_ALREADY_USED');
  end if;
  if r.expires_at<=now() then
    update public.license_key_deliveries set license_key=null where id=r.id;
    return jsonb_build_object('ok',false,'code','LINK_EXPIRED');
  end if;

  v_key:=r.license_key;
  update public.license_key_deliveries
  set used_at=now(),license_key=null
  where id=r.id;

  return jsonb_build_object(
    'ok',true,
    'license_key',v_key,
    'license_id',r.license_id,
    'order_id',r.order_id,
    'used_at',now()
  );
end
$$;

revoke all on function public.consume_license_key_delivery(text) from public,anon,authenticated;
grant execute on function public.consume_license_key_delivery(text) to service_role;

insert into public.mail_templates(template_key,name,category,subject,html,text_body,from_account,enabled)
values(
  'license_key_issued',
  'OrbitFS licence key ready',
  'licensing',
  'Your OrbitFS licence key is ready',
  '<p>Hi {{customer_name}},</p><p>Your OrbitFS Base payment has been activated and your licence key is ready.</p><p><a href="{{license_key_url}}">Reveal your licence key</a></p><p>This link can reveal the key once and expires in {{expires_hours}} hours.</p><p>After the key activates an OrbitFS installation, that licence is bound to that one Base system and its add-ons until you unlock it.</p><p>Key rotations are shown directly when requested and are not emailed.</p>',
  E'Hi {{customer_name}},\n\nYour OrbitFS Base payment has been activated and your licence key is ready.\n\nReveal your licence key once: {{license_key_url}}\n\nThis link expires in {{expires_hours}} hours.\n\nAfter activation the licence is bound to one Base system and its add-ons until unlocked. Key rotations are not emailed.',
  'noreply@orbitfs.cc',
  true
)
on conflict(template_key) do update set
  name=excluded.name,
  category=excluded.category,
  subject=excluded.subject,
  html=excluded.html,
  text_body=excluded.text_body,
  from_account=excluded.from_account,
  enabled=true,
  updated_at=now();

insert into public.mail_automations(event_key,name,category,description,template_key,enabled,variables)
values(
  'license.key_issued',
  'Initial licence key delivery',
  'licensing',
  'Sent once after paid OrbitFS Base fulfilment. Rotation keys are deliberately excluded.',
  'license_key_issued',
  true,
  '["customer_name","license_key_url","expires_hours"]'::jsonb
)
on conflict(event_key) do update set
  name=excluded.name,
  category=excluded.category,
  description=excluded.description,
  template_key=excluded.template_key,
  enabled=true,
  variables=excluded.variables,
  updated_at=now();
