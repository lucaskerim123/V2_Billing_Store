-- Keep built-in Theme Manager metadata aligned with the filesystem manifests.
-- Forward-only metadata sync after the V3/V5 theme manager consolidation.

update public.orbitfs_themes
set
  name='OrbitFS V3 Admin',
  version='3.0.0',
  description='Compact dark OrbitFS administration theme with indigo-led accents and semantic billing/support/licensing states.',
  manifest=manifest || '{"id":"V3A","name":"OrbitFS V3 Admin","version":"3.0.0","surface":"admin","entry":"theme.css","family":"V3"}'::jsonb,
  is_builtin=true,
  updated_at=now()
where id='V3A' and surface='admin';

update public.orbitfs_themes
set
  name='OrbitFS V3 Customer',
  version='3.0.0',
  description='Compact customer portal theme derived from V3A with matching graphite surfaces, indigo/cyan accents and billing-focused record displays.',
  manifest=manifest || '{"id":"V3C","name":"OrbitFS V3 Customer","version":"3.0.0","surface":"customer","entry":"theme.css","family":"V3"}'::jsonb,
  is_builtin=true,
  updated_at=now()
where id='V3C' and surface='customer';

update public.orbitfs_themes
set
  name='OrbitFS V5 Admin',
  version='5.0.0',
  description='Current OrbitFS admin design, layered over the stable V3A admin baseline.',
  manifest=manifest || '{"id":"V5A","name":"OrbitFS V5 Admin","version":"5.0.0","surface":"admin","entry":"theme.css","family":"V5","extends":"V3A"}'::jsonb,
  is_builtin=true,
  updated_at=now()
where id='V5A' and surface='admin';

update public.orbitfs_themes
set
  name='OrbitFS V5 Customer',
  version='5.0.0',
  description='OrbitFS V5 customer theme. Starts with the approved website-derived Base Deployer and Instance Control Panel while other customer surfaces remain on the V3C baseline.',
  manifest=manifest || '{"id":"V5C","name":"OrbitFS V5 Customer","version":"5.0.0","surface":"customer","entry":"theme.css","family":"V5","extends":"V3C"}'::jsonb,
  is_builtin=true,
  updated_at=now()
where id='V5C' and surface='customer';
