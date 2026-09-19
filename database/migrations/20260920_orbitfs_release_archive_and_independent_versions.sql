-- Allow Base and Update releases to use independent version namespaces.
-- Example: Base v1.0.3 and Update v1.0.1 can coexist.
alter table public.orbitfs_release_bundles drop constraint if exists orbitfs_release_bundles_version_key;
alter table public.orbitfs_release_bundles add constraint orbitfs_release_bundles_channel_version_key unique (channel,version);

-- Keep archived records out of normal customer release listings while retaining them for admin history.
alter table public.orbitfs_release_bundles add column if not exists archived_at timestamptz;
alter table public.orbitfs_release_bundles add column if not exists archived_by uuid;
create index if not exists orbitfs_release_bundles_archived_idx on public.orbitfs_release_bundles(archived_at,channel,updated_at desc);
