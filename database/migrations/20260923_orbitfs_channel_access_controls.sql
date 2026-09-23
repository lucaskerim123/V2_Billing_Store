-- OrbitFS customer channel access policy mirror.
-- License Manager remains authoritative; Billing Store mirrors these controls and
-- sends all access mutations back through the License Manager API.
alter table if exists public.orbitfs_release_channels
  add column if not exists access_request_enabled boolean not null default false;
alter table if exists public.orbitfs_release_channels
  add column if not exists self_join_enabled boolean not null default false;
