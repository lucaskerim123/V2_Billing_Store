-- Customer-specific OrbitFS release-channel access.
-- Billing Store owns who may consume a release channel; License Master remains
-- the release/artifact authority.

create table if not exists public.orbitfs_release_channels (
  id uuid primary key default gen_random_uuid(),
  channel text not null unique,
  label text not null,
  description text not null default '',
  enabled boolean not null default true,
  customer_visible boolean not null default true,
  default_for_new_customers boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orbitfs_release_channels_name_check check (channel ~ '^[a-z0-9][a-z0-9_-]{0,31}$')
);

create table if not exists public.orbitfs_release_channel_access (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.orbitfs_release_channels(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  unique(channel_id,user_id)
);

insert into public.orbitfs_release_channels(channel,label,description,enabled,customer_visible,default_for_new_customers)
values
 ('stable','Stable','Production releases for normal customers.',true,true,true),
 ('beta','Beta','Pre-release builds for assigned beta customers.',true,true,false),
 ('dev','Development','Development releases for explicitly assigned customers.',true,true,false)
on conflict(channel) do nothing;

alter table public.orbitfs_release_channels enable row level security;
alter table public.orbitfs_release_channel_access enable row level security;

revoke all on public.orbitfs_release_channels from public,authenticated;
revoke all on public.orbitfs_release_channel_access from public,authenticated;
