-- Register OrbitFS V5 theme family without removing the stable V3 fallbacks.
-- V5A is the current admin redesign. V5C begins the new customer redesign with
-- the website-derived Base Deployer / Instance Control Panel.
-- This migration intentionally does not auto-enable V5C for customers.

insert into public.orbitfs_themes(
  id,name,surface,version,description,manifest,css_text,is_builtin,updated_at
)
values
(
  'V5A',
  'OrbitFS V5 Admin',
  'admin',
  '5.0.0',
  'Current OrbitFS admin design layered over the stable V3A admin baseline.',
  '{"id":"V5A","name":"OrbitFS V5 Admin","entry":"theme.css","family":"V5","surface":"admin","version":"5.0.0"}'::jsonb,
  null,
  true,
  now()
),
(
  'V5C',
  'OrbitFS V5 Customer',
  'customer',
  '5.0.0',
  'OrbitFS V5 customer design. Begins with the approved website-derived Base Deployer and Instance Control Panel while other customer surfaces retain the stable V3C baseline.',
  '{"id":"V5C","name":"OrbitFS V5 Customer","entry":"theme.css","family":"V5","surface":"customer","version":"5.0.0"}'::jsonb,
  null,
  true,
  now()
)
on conflict(id) do update set
  name=excluded.name,
  surface=excluded.surface,
  version=excluded.version,
  description=excluded.description,
  manifest=excluded.manifest,
  css_text=null,
  is_builtin=true,
  updated_at=now();

-- The admin surface is already operating on the V5A visual layer.
insert into public.app_settings(key,value,category,public_read,updated_at)
values('themes.active_admin','"V5A"'::jsonb,'themes',false,now())
on conflict(key) do update set
  value=excluded.value,
  category=excluded.category,
  public_read=excluded.public_read,
  updated_at=now();

-- Retire the temporary V1_Changing registry identity. Customer theme selection
-- returns to the stable V3C baseline until V5C is explicitly selected.
update public.app_settings
   set value='"V3C"'::jsonb,
       category='themes',
       public_read=false,
       updated_at=now()
 where key='themes.active_customer'
   and value #>> '{}'='V1_Changing';

delete from public.orbitfs_themes where id='V1_Changing';

-- Built-in theme IDs are owned by application code and cannot be overwritten
-- through the imported-theme RPC.
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
  if tid in ('V3A','V3C','V5A','V5C') then raise exception 'built-in theme IDs cannot be overwritten'; end if;
  if coalesce(length(p_css),0)<20 then raise exception 'theme CSS is empty'; end if;
  insert into public.orbitfs_themes(id,name,surface,version,description,manifest,css_text,is_builtin,updated_at)
  values(tid,tname,tsurface,tversion,coalesce(p_manifest->>'description',''),p_manifest,p_css,false,now())
  on conflict(id) do update set
    name=excluded.name,surface=excluded.surface,version=excluded.version,
    description=excluded.description,manifest=excluded.manifest,css_text=excluded.css_text,updated_at=now();
  return jsonb_build_object('ok',true,'theme_id',tid,'surface',tsurface);
end $$;
