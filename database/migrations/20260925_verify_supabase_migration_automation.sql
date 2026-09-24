-- Safe end-to-end migration automation probe.
-- This intentionally changes no application data; it fails if the workflow links to the wrong database.
do $$
begin
  if to_regclass('public.app_settings') is null
     or to_regclass('public.support_tickets') is null
     or to_regclass('public.orbitfs_installations') is null then
    raise exception 'Wrong database or incomplete Billing Store schema';
  end if;
end $$;
