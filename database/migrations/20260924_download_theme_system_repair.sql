-- Restore settings-backed download and theme infrastructure that existed in the
-- live Billing Store schema but was not represented by the ordered migration set.

insert into public.app_settings(key,value,category,public_read,updated_at) values
('downloads.enabled','true'::jsonb,'downloads',false,now()),
('downloads.require_paid_invoice','true'::jsonb,'downloads',false,now()),
('downloads.show_checksums','true'::jsonb,'downloads',true,now()),
('themes.active_admin','"V3A"'::jsonb,'themes',false,now()),
('themes.active_customer','"V3C"'::jsonb,'themes',false,now())
on conflict(key) do nothing;

create table if not exists public.orbitfs_themes (
  id text primary key,
  name text not null,
  surface text not null check(surface in ('admin','customer')),
  version text not null default '1.0.0',
  description text not null default '',
  manifest jsonb not null default '{}'::jsonb,
  css_text text,
  is_builtin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.orbitfs_themes(id,name,surface,version,description,manifest,css_text,is_builtin,updated_at)
values
('V3A','V3A','admin','1.0.0','OrbitFS compact dark admin theme with graphite surfaces, indigo actions and semantic billing/status colours.','{"id":"V3A","entry":"theme.css","family":"V3","surface":"admin"}'::jsonb,null,true,now()),
('V3C','V3C','customer','1.0.0','OrbitFS compact dark customer portal theme derived from V3A with customer-focused navigation and billing/service displays.','{"id":"V3C","entry":"theme.css","family":"V3","surface":"customer"}'::jsonb,null,true,now())
on conflict(id) do update set
  name=excluded.name,
  surface=excluded.surface,
  version=excluded.version,
  description=excluded.description,
  manifest=excluded.manifest,
  is_builtin=true,
  updated_at=now();

create or replace function public.orbitfs_active_theme(p_surface text) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare active_id text; t public.orbitfs_themes%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_surface not in ('admin','customer') then raise exception 'invalid surface'; end if;
  select value #>> '{}' into active_id
    from public.app_settings
   where key=case when p_surface='admin' then 'themes.active_admin' else 'themes.active_customer' end;
  active_id:=coalesce(active_id,case when p_surface='admin' then 'V3A' else 'V3C' end);
  select * into t from public.orbitfs_themes where id=active_id and surface=p_surface;
  if not found then
    active_id:=case when p_surface='admin' then 'V3A' else 'V3C' end;
    select * into t from public.orbitfs_themes where id=active_id;
  end if;
  return jsonb_build_object('id',t.id,'name',t.name,'surface',t.surface,'version',t.version,'is_builtin',t.is_builtin,'css_text',case when t.is_builtin then null else t.css_text end);
end $$;

create or replace function public.orbitfs_theme_apply(p_theme_id text) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare t public.orbitfs_themes%rowtype; setting_key text;
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  select * into t from public.orbitfs_themes where id=p_theme_id;
  if not found then raise exception 'theme not installed'; end if;
  setting_key:=case when t.surface='admin' then 'themes.active_admin' else 'themes.active_customer' end;
  insert into public.app_settings(key,value,category,public_read)
  values(setting_key,to_jsonb(t.id),'themes',false)
  on conflict(key) do update set value=excluded.value,updated_at=now();
  return jsonb_build_object('ok',true,'theme_id',t.id,'surface',t.surface);
end $$;

create or replace function public.orbitfs_theme_import(p_manifest jsonb,p_css text) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare tid text; tname text; tsurface text; tversion text;
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  tid:=nullif(trim(p_manifest->>'id'),'');
  tname:=coalesce(nullif(trim(p_manifest->>'name'),''),tid);
  tsurface:=nullif(trim(p_manifest->>'surface'),'');
  tversion:=coalesce(nullif(trim(p_manifest->>'version'),''),'1.0.0');
  if tid is null or tsurface not in ('admin','customer') then raise exception 'invalid theme manifest'; end if;
  if tid in ('V3A','V3C') then raise exception 'built-in theme IDs cannot be overwritten'; end if;
  if coalesce(length(p_css),0)<20 then raise exception 'theme CSS is empty'; end if;
  insert into public.orbitfs_themes(id,name,surface,version,description,manifest,css_text,is_builtin,updated_at)
  values(tid,tname,tsurface,tversion,coalesce(p_manifest->>'description',''),p_manifest,p_css,false,now())
  on conflict(id) do update set
    name=excluded.name,surface=excluded.surface,version=excluded.version,
    description=excluded.description,manifest=excluded.manifest,css_text=excluded.css_text,updated_at=now();
  return jsonb_build_object('ok',true,'theme_id',tid,'surface',tsurface);
end $$;

create or replace function public.orbitfs_theme_list() returns jsonb
language plpgsql security definer set search_path='public' as $$
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  return jsonb_build_object(
    'themes',coalesce((select jsonb_agg(to_jsonb(t) order by t.surface,t.id) from public.orbitfs_themes t),'[]'::jsonb),
    'active_admin',coalesce((select value #>> '{}' from public.app_settings where key='themes.active_admin'),'V3A'),
    'active_customer',coalesce((select value #>> '{}' from public.app_settings where key='themes.active_customer'),'V3C')
  );
end $$;
