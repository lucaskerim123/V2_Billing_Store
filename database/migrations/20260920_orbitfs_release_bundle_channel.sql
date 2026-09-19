alter table public.orbitfs_release_bundles
  add column if not exists release_channel text not null default 'stable'
    check (release_channel ~ '^[a-z0-9][a-z0-9_-]{0,31}$');

create index if not exists orbitfs_release_bundles_release_channel_idx
  on public.orbitfs_release_bundles(release_channel,status,updated_at desc);
