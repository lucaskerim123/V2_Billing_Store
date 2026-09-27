-- Durable, idempotent execution ledger for Base install/update/redeploy/rollback.
-- Installation release history remains the immutable outcome log; this table tracks in-flight work.
create table if not exists public.orbitfs_deployment_operations (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.orbitfs_installations(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('deploy','base_update','redeploy','rollback')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  current_release_id text,
  requested_release_id text,
  release_channel text,
  state text not null default 'requested' check (state in (
    'requested','authorising','validated','deploying','migrating','verifying','promoting',
    'completed','failed','authority_sync_pending'
  )),
  vercel_project_id text,
  vercel_deployment_id text,
  migration_head_before text,
  migration_head_after text,
  authority_sync_pending boolean not null default false,
  error_code text,
  error_detail text,
  result jsonb not null default '{}'::jsonb,
  detail jsonb not null default '{}'::jsonb,
  heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (installation_id,idempotency_key)
);

create unique index if not exists orbitfs_one_active_deployment_operation
  on public.orbitfs_deployment_operations(installation_id)
  where state in ('requested','authorising','validated','deploying','migrating','verifying','promoting');

create index if not exists orbitfs_deployment_operations_user_created_idx
  on public.orbitfs_deployment_operations(auth_user_id,created_at desc);

create index if not exists orbitfs_deployment_operations_installation_created_idx
  on public.orbitfs_deployment_operations(installation_id,created_at desc);

alter table public.orbitfs_deployment_operations enable row level security;
revoke all on public.orbitfs_deployment_operations from anon, authenticated;
grant all on public.orbitfs_deployment_operations to service_role;

comment on table public.orbitfs_deployment_operations is
  'Execution ledger for idempotent OrbitFS Base lifecycle operations. Does not replace immutable installation release history.';
