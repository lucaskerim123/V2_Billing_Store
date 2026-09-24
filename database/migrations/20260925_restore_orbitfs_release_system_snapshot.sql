-- Restores the admin snapshot RPC used by Billing Store delivery controls.
-- This intentionally exposes only Billing Store runtime state. License Manager remains
-- authoritative for licensing and technical release/deployment authorization.

create or replace function public.admin_orbitfs_release_system_snapshot()
returns jsonb
language sql
security definer
set search_path=public
as $$
select case when public.has_permission('licenses.view') then
  jsonb_build_object(
    'settings',to_jsonb(s),
    'supabase_client_secret_configured',false,
    'vercel_client_secret_configured',false,
    'installations',(select count(*) from public.orbitfs_installations),
    'connected_supabase',(select count(*) from public.orbitfs_provider_connections where provider='supabase' and status='connected'),
    'connected_vercel',(select count(*) from public.orbitfs_provider_connections where provider='vercel' and status='connected')
  ) else '{}'::jsonb end
from public.orbitfs_release_system_settings s
where s.id='primary';
$$;

revoke all on function public.admin_orbitfs_release_system_snapshot() from public;
grant execute on function public.admin_orbitfs_release_system_snapshot() to authenticated;