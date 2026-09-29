begin;

alter table if exists public.license_master_connection
  add column if not exists fallback_url text,
  add column if not exists failover_enabled boolean not null default true,
  add column if not exists failover_mode text not null default 'automatic_limp',
  add column if not exists last_primary_failure_at timestamptz,
  add column if not exists last_fallback_at timestamptz;

alter table if exists public.license_master_connection
  drop constraint if exists license_master_connection_fallback_url_check;
alter table if exists public.license_master_connection
  add constraint license_master_connection_fallback_url_check check (
    fallback_url is null
    or fallback_url = 'https://orbitfs-fallback.stubengine.com/api/v1'
  );

alter table if exists public.license_master_connection
  drop constraint if exists license_master_connection_failover_mode_check;
alter table if exists public.license_master_connection
  add constraint license_master_connection_failover_mode_check check (
    failover_mode in ('disabled','automatic_limp')
  );

update public.license_master_connection
set fallback_url=coalesce(fallback_url,'https://orbitfs-fallback.stubengine.com/api/v1'),
    failover_enabled=coalesce(failover_enabled,true),
    failover_mode=coalesce(nullif(failover_mode,''),'automatic_limp');

comment on column public.license_master_connection.fallback_url is
  'Registered availability-only limp-mode endpoint. It is never authoritative.';
comment on column public.license_master_connection.failover_enabled is
  'Allows safe read/runtime availability requests to use the registered limp fallback after primary transport failure.';

commit;
