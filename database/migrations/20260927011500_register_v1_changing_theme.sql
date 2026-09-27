-- Register the transitional V1_Changing customer theme.
-- The theme files are bundled with the application; this row makes the theme
-- visible to the database-backed Theme Manager and marks it active.

insert into public.orbitfs_themes(
  id,
  name,
  surface,
  version,
  description,
  manifest,
  css_text,
  is_builtin,
  updated_at
)
values (
  'V1_Changing',
  'OrbitFS V1 Changing',
  'customer',
  '1.0.0',
  'Transitional OrbitFS customer theme. Rebuilds customer surfaces progressively, beginning with the ZIP-derived Base Deployer.',
  '{"id":"V1_Changing","name":"OrbitFS V1 Changing","entry":"theme.css","family":"V1_Changing","surface":"customer","version":"1.0.0"}'::jsonb,
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

insert into public.app_settings(key,value,category,public_read,updated_at)
values('themes.active_customer','"V1_Changing"'::jsonb,'themes',false,now())
on conflict(key) do update set
  value=excluded.value,
  category=excluded.category,
  public_read=excluded.public_read,
  updated_at=now();
