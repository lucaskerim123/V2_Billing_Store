-- OrbitFS release-channel access and promotion support in Billing Store.
-- Billing Store owns customer assignment; License Master remains authoritative for
-- channel definitions, release state and technical approval.

alter table public.orbitfs_release_channels
  add column if not exists access_mode text not null default 'closed'
    check (access_mode in ('open','closed'));

update public.orbitfs_release_channels
set access_mode = case
  when channel = 'stable' then 'open'
  else access_mode
end
where channel = 'stable';

create index if not exists orbitfs_release_channel_access_user_idx
  on public.orbitfs_release_channel_access(user_id,channel_id);

create index if not exists orbitfs_release_channel_access_channel_idx
  on public.orbitfs_release_channel_access(channel_id,user_id);

create table if not exists public.orbitfs_release_channel_access_audit (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.orbitfs_release_channels(id) on delete cascade,
  user_id uuid not null,
  action text not null check (action in ('grant','revoke')),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object')
);

create index if not exists orbitfs_release_channel_access_audit_user_idx
  on public.orbitfs_release_channel_access_audit(user_id,created_at desc);

create index if not exists orbitfs_release_channel_access_audit_channel_idx
  on public.orbitfs_release_channel_access_audit(channel_id,created_at desc);

alter table public.orbitfs_release_channel_access_audit enable row level security;
revoke all on public.orbitfs_release_channel_access_audit from public,authenticated;

-- Stable is the baseline customer channel. Explicit beta/dev/custom grants are
-- additive; the application always includes Stable for active customers.
