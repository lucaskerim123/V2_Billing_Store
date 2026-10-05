-- Register V6A as a built-in Admin theme without activating it.
insert into public.orbitfs_themes(
  id,name,surface,version,description,manifest,css_text,is_builtin,updated_at
)
values(
  'V6A',
  'OrbitFS V6 Admin',
  'admin',
  '6.0.0',
  'OrbitFS V6 Admin starter theme. V6 visual foundation layered over the existing V5A admin functionality.',
  '{"id":"V6A","name":"OrbitFS V6 Admin","entry":"theme.css","family":"V6","surface":"admin","version":"6.0.0","extends":"V5A"}'::jsonb,
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
