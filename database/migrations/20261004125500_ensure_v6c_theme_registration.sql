-- Ensure the built-in V6C Customer Portal theme is registered without activating it.
-- This is a forward-safe upsert and does not change themes.active_customer.

insert into public.orbitfs_themes(
  id,name,surface,version,description,manifest,css_text,is_builtin,updated_at
)
values (
  'V6C',
  'OrbitFS V6 Customer',
  'customer',
  '6.0.0',
  'Standalone OrbitFS V6 customer portal visual system based on the supplied 12ui design. V6C does not inherit V3C or V5C.',
  '{"id":"V6C","name":"OrbitFS V6 Customer","entry":"theme.css","family":"V6","surface":"customer","version":"6.0.0","standalone":true}'::jsonb,
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
