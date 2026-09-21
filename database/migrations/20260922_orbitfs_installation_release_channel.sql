-- Persist the customer's selected OrbitFS release channel on each installation.
-- Access remains controlled by orbitfs_release_channel_access/open channels.

alter table public.orbitfs_installations
  add column if not exists release_channel text not null default 'stable'
  check (release_channel ~ '^[a-z0-9][a-z0-9_-]{0,31}$');

create index if not exists orbitfs_installations_release_channel_idx
  on public.orbitfs_installations(release_channel);
