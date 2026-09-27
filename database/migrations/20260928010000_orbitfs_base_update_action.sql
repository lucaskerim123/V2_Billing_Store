-- Keep Base installation/update/redeploy operations distinct from normal Engine/add-on updates.
alter table public.orbitfs_installation_releases
  drop constraint if exists orbitfs_installation_releases_action_check;

alter table public.orbitfs_installation_releases
  add constraint orbitfs_installation_releases_action_check
  check (action in ('deploy','base_update','update','rollback','redeploy'));
