-- Persist the customer's selected OrbitFS release channel on each installation.
-- Access remains controlled by orbitfs_release_channel_access/open channels.

alter table public.orbitfs_installations
  add column if not exists release_channel text not null default 'stable'
  check (release_channel ~ '^[a-z0-9][a-z0-9_-]{0,31}$');

create index if not exists orbitfs_installations_release_channel_idx
  on public.orbitfs_installations(release_channel);


-- Allow a customer to cleanly reset a provider OAuth connection. Tokens are removed from Vault before the connection record is deleted.
create or replace function public.service_disconnect_orbitfs_provider_connection(
  p_user_id uuid,
  p_provider text
) returns boolean language plpgsql security definer set search_path=public,private,vault as $$
declare cid uuid; a uuid; r uuid;
begin
  if auth.role()<>'service_role' then raise exception 'service role required'; end if;
  if p_provider not in ('supabase','vercel') then raise exception 'unsupported provider'; end if;
  select id into cid from public.orbitfs_provider_connections where auth_user_id=p_user_id and provider=p_provider;
  if cid is null then return false; end if;
  select access_token_secret_id,refresh_token_secret_id into a,r from private.orbitfs_provider_connection_secrets where connection_id=cid;
  if a is not null then perform vault.delete_secret(a); end if;
  if r is not null then perform vault.delete_secret(r); end if;
  delete from private.orbitfs_provider_connection_secrets where connection_id=cid;
  delete from public.orbitfs_provider_connections where id=cid;
  return true;
end $$;
revoke all on function public.service_disconnect_orbitfs_provider_connection(uuid,text) from public;

-- Only the server-side service role may execute the reset function.
grant execute on function public.service_disconnect_orbitfs_provider_connection(uuid,text) to service_role;
