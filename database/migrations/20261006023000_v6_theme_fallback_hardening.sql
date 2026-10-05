-- Keep V6 as the application fallback without rewriting prior theme migrations.
-- V3/V5 themes remain explicitly selectable compatibility themes.

update public.orbitfs_themes
set
  description='OrbitFS V6 Admin visual system using the shared admin functional structure without inheriting V5A visual styling.',
  manifest=(coalesce(manifest,'{}'::jsonb)-'extends') ||
    '{"id":"V6A","name":"OrbitFS V6 Admin","entry":"theme.css","family":"V6","surface":"admin","version":"6.0.0"}'::jsonb,
  css_text=null,
  is_builtin=true,
  updated_at=now()
where id='V6A' and surface='admin';

create or replace function public.orbitfs_active_theme(p_surface text) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare
  active_id text;
  fallback_id text;
  t public.orbitfs_themes%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_surface not in ('admin','customer') then raise exception 'invalid surface'; end if;

  fallback_id:=case when p_surface='admin' then 'V6A' else 'V6C' end;

  select value #>> '{}' into active_id
    from public.app_settings
   where key=case when p_surface='admin' then 'themes.active_admin' else 'themes.active_customer' end;

  active_id:=coalesce(nullif(active_id,''),fallback_id);
  select * into t from public.orbitfs_themes where id=active_id and surface=p_surface;

  if not found then
    active_id:=fallback_id;
    select * into t from public.orbitfs_themes where id=active_id and surface=p_surface;
  end if;

  if not found then
    raise exception 'V6 fallback theme % is not registered',fallback_id;
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

grant execute on function public.orbitfs_active_theme(text) to authenticated;

create or replace function public.orbitfs_theme_list() returns jsonb
language plpgsql security definer set search_path='public' as $$
begin
  if not public.is_admin() then raise exception 'admin required'; end if;

  return jsonb_build_object(
    'themes',coalesce((select jsonb_agg(to_jsonb(t) order by t.surface,t.id) from public.orbitfs_themes t),'[]'::jsonb),
    'active_admin',coalesce(nullif((select value #>> '{}' from public.app_settings where key='themes.active_admin'),''),'V6A'),
    'active_customer',coalesce(nullif((select value #>> '{}' from public.app_settings where key='themes.active_customer'),''),'V6C')
  );
end $$;

grant execute on function public.orbitfs_theme_list() to authenticated;
