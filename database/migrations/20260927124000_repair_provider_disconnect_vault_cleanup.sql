-- Repair provider disconnect for Supabase Vault installations that do not expose vault.delete_secret(uuid).
-- Published migrations remain immutable; this forward migration replaces only the RPC definition.

create or replace function public.service_disconnect_orbitfs_provider_connection(
  p_user_id uuid,
  p_provider text
) returns boolean
language plpgsql
security definer
set search_path=public,private,vault
as $$
declare
  cid uuid;
  access_secret uuid;
  refresh_secret uuid;
begin
  if auth.role()<>'service_role' then
    raise exception 'service role required';
  end if;

  if p_provider not in ('supabase','vercel') then
    raise exception 'unsupported provider';
  end if;

  select id
    into cid
  from public.orbitfs_provider_connections
  where auth_user_id=p_user_id
    and provider=p_provider;

  if cid is null then
    return false;
  end if;

  select access_token_secret_id,refresh_token_secret_id
    into access_secret,refresh_secret
  from private.orbitfs_provider_connection_secrets
  where connection_id=cid;

  if access_secret is not null then
    if to_regprocedure('vault.delete_secret(uuid)') is not null then
      execute 'select vault.delete_secret($1)' using access_secret;
    else
      delete from vault.secrets where id=access_secret;
    end if;
  end if;

  if refresh_secret is not null and refresh_secret is distinct from access_secret then
    if to_regprocedure('vault.delete_secret(uuid)') is not null then
      execute 'select vault.delete_secret($1)' using refresh_secret;
    else
      delete from vault.secrets where id=refresh_secret;
    end if;
  end if;

  delete from private.orbitfs_provider_connection_secrets where connection_id=cid;
  delete from public.orbitfs_provider_connections where id=cid;

  return true;
end
$$;

revoke all on function public.service_disconnect_orbitfs_provider_connection(uuid,text) from public, anon, authenticated;
grant execute on function public.service_disconnect_orbitfs_provider_connection(uuid,text) to service_role;
