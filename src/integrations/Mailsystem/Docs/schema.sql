-- Generic application-owned mail configuration. Run against each host application's database.
create table if not exists app_mail_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  display_name text not null,
  subject text not null default '',
  body_text text,
  body_html text,
  variables jsonb not null default '[]'::jsonb,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_mail_template_revisions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references app_mail_templates(id) on delete cascade,
  revision integer not null check (revision > 0),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (template_id, revision)
);

create table if not exists app_mail_routes (
  id uuid primary key default gen_random_uuid(),
  route_key text not null unique,
  sender_address text not null,
  priority integer not null default 0,
  conditions jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists app_mail_routes_active_priority_idx on app_mail_routes(active, priority desc);

create table if not exists app_mail_triggers (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  template_key text not null references app_mail_templates(template_key),
  route_key text references app_mail_routes(route_key) on delete set null,
  recipient_mapping jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists app_mail_triggers_active_event_idx on app_mail_triggers(active, event_key);

create table if not exists app_mail_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Start disabled. The host can enable it after configuring a permitted sender.
insert into app_mail_settings(key, value)
values (
  'module',
  jsonb_build_object(
    'enabled', false,
    'defaultSender', null,
    'appearance', jsonb_build_object(
      'primaryColor', '#253858',
      'accentColor', '#3978d4',
      'surfaceColor', '#ffffff',
      'textColor', '#172033',
      'borderColor', '#d9e0ea',
      'borderRadius', '12px',
      'fontFamily', 'inherit',
      'title', 'Mail settings',
      'subtitle', 'Configure application email'
    )
  )
)
on conflict (key) do nothing;

create or replace function mail_configuration_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_mail_templates_set_updated_at on app_mail_templates;
create trigger app_mail_templates_set_updated_at before update on app_mail_templates
for each row execute function mail_configuration_set_updated_at();

drop trigger if exists app_mail_routes_set_updated_at on app_mail_routes;
create trigger app_mail_routes_set_updated_at before update on app_mail_routes
for each row execute function mail_configuration_set_updated_at();

drop trigger if exists app_mail_triggers_set_updated_at on app_mail_triggers;
create trigger app_mail_triggers_set_updated_at before update on app_mail_triggers
for each row execute function mail_configuration_set_updated_at();

drop trigger if exists app_mail_settings_set_updated_at on app_mail_settings;
create trigger app_mail_settings_set_updated_at before update on app_mail_settings
for each row execute function mail_configuration_set_updated_at();

-- No permissive policies: host app must add admin and tenant-isolation policies.
alter table app_mail_templates enable row level security;
alter table app_mail_template_revisions enable row level security;
alter table app_mail_routes enable row level security;
alter table app_mail_triggers enable row level security;
alter table app_mail_settings enable row level security;
