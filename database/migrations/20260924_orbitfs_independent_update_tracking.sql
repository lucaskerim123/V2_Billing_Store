-- Track independent Update releases without overwriting the installed Base release identity.

alter table public.orbitfs_installations
  add column if not exists applied_update_version text,
  add column if not exists applied_update_id text,
  add column if not exists applied_update_sha256 text,
  add column if not exists applied_update_source_commit text,
  add column if not exists applied_update_at timestamptz;

alter table public.orbitfs_installation_releases
  add column if not exists release_type text not null default 'base',
  add column if not exists components jsonb not null default '[]'::jsonb,
  add column if not exists panel_deployment_id text,
  add column if not exists engine_deployment_id text,
  add column if not exists base_release_version text;

alter table public.orbitfs_installation_releases
  drop constraint if exists orbitfs_installation_releases_release_type_check;
alter table public.orbitfs_installation_releases
  add constraint orbitfs_installation_releases_release_type_check
  check (release_type in ('base','update'));

update public.orbitfs_installation_releases
set release_type = case when action='update' then 'update' else 'base' end
where release_type is null or release_type not in ('base','update');

update public.orbitfs_installation_releases
set panel_deployment_id=vercel_deployment_id
where panel_deployment_id is null
  and vercel_deployment_id is not null
  and coalesce(components,'[]'::jsonb) in ('[]'::jsonb,'["base"]'::jsonb)
  and action <> 'update';

create index if not exists orbitfs_installation_releases_type_idx
  on public.orbitfs_installation_releases(installation_id,release_type,created_at desc);
create index if not exists orbitfs_installation_releases_panel_idx
  on public.orbitfs_installation_releases(installation_id,panel_deployment_id,created_at desc)
  where panel_deployment_id is not null;
