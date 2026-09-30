-- Harden OrbitFS theme management around the A/C surface naming contract.
-- A = Admin Panel, C = Customer Portal.
-- This is a forward migration; existing applied theme migrations are not rewritten.

update public.orbitfs_themes
set manifest=manifest || '{"family":"V3"}'::jsonb,
    updated_at=now()
where id in ('V3A','V3C');

update public.orbitfs_themes
set manifest=manifest || '{"family":"V5","extends":"V3A"}'::jsonb,
    updated_at=now()
where id='V5A' and surface='admin';

update public.orbitfs_themes
set manifest=manifest || '{"family":"V5","extends":"V3C"}'::jsonb,
    updated_at=now()
where id='V5C' and surface='customer';

create or replace function public.orbitfs_active_theme(p_surface text) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare
  active_id text;
  fallback_id text;
  t public.orbitfs_themes%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_surface not in ('admin','customer') then raise exception 'invalid surface'; end if;

  fallback_id:=case when p_surface='admin' then 'V5A' else 'V3C' end;

  select value #>> '{}' into active_id
    from public.app_settings
   where key=case when p_surface='admin' then 'themes.active_admin' else 'themes.active_customer' end;

  active_id:=coalesce(active_id,fallback_id);
  select * into t from public.orbitfs_themes where id=active_id and surface=p_surface;

  if not found then
    active_id:=fallback_id;
    select * into t from public.orbitfs_themes where id=active_id and surface=p_surface;
  end if;

  return jsonb_build_object(
    'id',t.id,
    'name',t.name,
    'surface',t.surface,
    'version',t.version,
    'description',t.description,
    'manifest',t.manifest,
    'is_builtin',t.is_builtin,
    'css_text',case when t.is_builtin then null else t.css_text end
  );
end $$;

create or replace function public.orbitfs_theme_apply(p_theme_id text) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare
  t public.orbitfs_themes%rowtype;
  setting_key text;
begin
  if not public.is_admin() then raise exception 'admin required'; end if;

  select * into t from public.orbitfs_themes where id=p_theme_id;
  if not found then raise exception 'theme not installed'; end if;

  if t.surface='admin' and right(t.id,1)<>'A' then
    raise exception 'admin theme IDs must end in A';
  end if;
  if t.surface='customer' and right(t.id,1)<>'C' then
    raise exception 'customer theme IDs must end in C';
  end if;

  setting_key:=case when t.surface='admin' then 'themes.active_admin' else 'themes.active_customer' end;

  insert into public.app_settings(key,value,category,public_read,updated_at)
  values(setting_key,to_jsonb(t.id),'themes',false,now())
  on conflict(key) do update set
    value=excluded.value,
    category=excluded.category,
    public_read=excluded.public_read,
    updated_at=now();

  return jsonb_build_object('ok',true,'theme_id',t.id,'surface',t.surface);
end $$;

create or replace function public.orbitfs_theme_import(p_manifest jsonb,p_css text) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare
  tid text;
  tname text;
  tsurface text;
  tversion text;
  extends_id text;
  existing_builtin boolean;
  base_surface text;
begin
  if not public.is_admin() then raise exception 'admin required'; end if;

  tid:=nullif(trim(p_manifest->>'id'),'');
  tname:=coalesce(nullif(trim(p_manifest->>'name'),''),tid);
  tsurface:=nullif(trim(p_manifest->>'surface'),'');
  tversion:=coalesce(nullif(trim(p_manifest->>'version'),''),'1.0.0');
  extends_id:=nullif(trim(p_manifest->>'extends'),'');

  if tid is null or tid !~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$' then
    raise exception 'invalid theme id';
  end if;
  if tsurface not in ('admin','customer') then
    raise exception 'invalid theme surface';
  end if;
  if tsurface='admin' and right(tid,1)<>'A' then
    raise exception 'admin theme IDs must end in A';
  end if;
  if tsurface='customer' and right(tid,1)<>'C' then
    raise exception 'customer theme IDs must end in C';
  end if;
  if coalesce(length(p_css),0)<20 then
    raise exception 'theme CSS is empty';
  end if;

  select is_builtin into existing_builtin from public.orbitfs_themes where id=tid;
  if coalesce(existing_builtin,false) then
    raise exception 'built-in theme IDs cannot be overwritten';
  end if;

  if extends_id is not null then
    select surface into base_surface from public.orbitfs_themes where id=extends_id;
    if base_surface is null then raise exception 'base theme is not installed'; end if;
    if base_surface<>tsurface then raise exception 'theme cannot extend a different surface'; end if;
    if extends_id=tid then raise exception 'theme cannot extend itself'; end if;
  end if;

  insert into public.orbitfs_themes(id,name,surface,version,description,manifest,css_text,is_builtin,updated_at)
  values(tid,tname,tsurface,tversion,coalesce(p_manifest->>'description',''),p_manifest,p_css,false,now())
  on conflict(id) do update set
    name=excluded.name,
    surface=excluded.surface,
    version=excluded.version,
    description=excluded.description,
    manifest=excluded.manifest,
    css_text=excluded.css_text,
    is_builtin=false,
    updated_at=now();

  return jsonb_build_object('ok',true,'theme_id',tid,'surface',tsurface);
end $$;

create or replace function public.orbitfs_theme_list() returns jsonb
language plpgsql security definer set search_path='public' as $$
begin
  if not public.is_admin() then raise exception 'admin required'; end if;

  return jsonb_build_object(
    'themes',coalesce((select jsonb_agg(to_jsonb(t) order by t.surface,t.id) from public.orbitfs_themes t),'[]'::jsonb),
    'active_admin',coalesce((select value #>> '{}' from public.app_settings where key='themes.active_admin'),'V5A'),
    'active_customer',coalesce((select value #>> '{}' from public.app_settings where key='themes.active_customer'),'V3C')
  );
end $$;
