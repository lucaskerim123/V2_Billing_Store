-- Core Integration Manager persistence and destructive uninstall contract.
create table if not exists public.app_integrations (
  integration_id text primary key check (integration_id ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  display_name text not null,
  version text not null,
  installed boolean not null default false,
  enabled boolean not null default false,
  installed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint app_integrations_enabled_requires_install check (not enabled or installed)
);
create table if not exists public.app_integration_data (
  integration_id text not null references public.app_integrations(integration_id) on delete cascade,
  data_key text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (integration_id, data_key)
);
alter table public.app_integrations enable row level security;
alter table public.app_integration_data enable row level security;
revoke all on public.app_integrations, public.app_integration_data from anon, authenticated;
grant select, insert, update, delete on public.app_integrations, public.app_integration_data to service_role;

create or replace function public.admin_set_integration_state(
  p_integration_id text, p_installed boolean, p_enabled boolean, p_action text,
  p_display_name text default null, p_version text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_access record; v_access_json jsonb; v_permissions jsonb; v_allowed boolean := false;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_integration_id !~ '^[a-z0-9][a-z0-9-]{1,47}$' then raise exception 'Invalid integration id' using errcode = '22023'; end if;
  if p_action not in ('install','enable','disable','uninstall') then raise exception 'Invalid integration action' using errcode = '22023'; end if;
  if (p_action = 'enable' and (not p_installed or not p_enabled))
     or (p_action in ('install','disable','uninstall') and p_enabled)
     or (p_action = 'uninstall' and p_installed)
     or (p_action <> 'uninstall' and not p_installed) then
    raise exception 'Invalid integration lifecycle transition' using errcode = '22023';
  end if;
  select * into v_access from public.get_my_staff_access() limit 1;
  v_access_json := to_jsonb(v_access);
  v_permissions := coalesce(v_access_json->'permissions','{}'::jsonb);
  v_allowed := coalesce((v_access_json->>'all')::boolean,false)
    or coalesce((v_permissions->>'all')::boolean,false)
    or coalesce((v_permissions->>'integrations.manage')::boolean,false)
    or (jsonb_typeof(v_permissions) = 'array' and v_permissions ? 'integrations.manage')
    or v_permissions ? '*';
  if not v_allowed then raise exception 'Integration Manager permission required' using errcode = '42501'; end if;
  if p_action = 'uninstall' then
    delete from public.app_integrations where integration_id = p_integration_id;
    return jsonb_build_object('ok',true,'integration_id',p_integration_id,'action',p_action,'installed',false,'enabled',false,'cleaned',true);
  end if;
  insert into public.app_integrations(integration_id,display_name,version,installed,enabled,installed_at,updated_at)
  values (p_integration_id,coalesce(nullif(p_display_name,''),initcap(replace(p_integration_id,'-',' '))),coalesce(nullif(p_version,''),'unknown'),p_installed,p_enabled,now(),now())
  on conflict (integration_id) do update set display_name=excluded.display_name,version=excluded.version,
    installed=excluded.installed,enabled=excluded.enabled,
    installed_at=case when excluded.installed and not app_integrations.installed then now() else app_integrations.installed_at end,
    updated_at=now();
  return jsonb_build_object('ok',true,'integration_id',p_integration_id,'action',p_action,'installed',p_installed,'enabled',p_enabled,'cleaned',false);
end; $$;
revoke all on function public.admin_set_integration_state(text,boolean,boolean,text,text,text) from public, anon;
grant execute on function public.admin_set_integration_state(text,boolean,boolean,text,text,text) to authenticated, service_role;
