-- Inner deployment is the shared customer environment used by all OrbitFS products.
-- An active Engine add-on licence (MCP, APEX or Studio) may authorize creation of the single shared environment.
-- The API verifies that authoritative add-on entitlement with License Manager before invoking this RPC.
-- Keep component_key='orbitfs_base' for compatibility with the existing deployment/runtime
-- tables and Base release execution path; it is a storage/runtime key, not the entitlement gate.

create or replace function public.service_ensure_orbitfs_inner_installation(
  p_auth_user_id uuid,
  p_binding_id uuid
)
returns public.orbitfs_installations
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.license_bindings%rowtype;
  result public.orbitfs_installations%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_auth_user_id is null or p_binding_id is null then
    raise exception 'auth user and licence binding are required';
  end if;

  select * into b
  from public.license_bindings
  where id = p_binding_id
    and auth_user_id = p_auth_user_id
    and archived_at is null;

  if not found then
    raise exception 'Licence binding not found';
  end if;

  -- One Inner deployment / Shared Engine per customer account.
  select * into result
  from public.orbitfs_installations
  where auth_user_id = p_auth_user_id
    and component_key = 'orbitfs_base'
  order by created_at asc
  limit 1;

  if found then
    return result;
  end if;

  insert into public.orbitfs_installations (
    auth_user_id,
    license_binding_id,
    order_id,
    order_item_id,
    component_key,
    installation_id,
    state,
    metadata
  ) values (
    b.auth_user_id,
    b.id,
    b.order_id,
    b.order_item_id,
    'orbitfs_base',
    'ofs_' || replace(gen_random_uuid()::text, '-', ''),
    'pending',
    jsonb_build_object(
      'deploymentModel', 'inner_shared_engine',
      'entitlementBootstrapBindingId', b.id,
      'entitlementBootstrapLicenseId', b.license_id
    )
  )
  returning * into result;

  return result;
end;
$$;

revoke all on function public.service_ensure_orbitfs_inner_installation(uuid,uuid) from public;
revoke all on function public.service_ensure_orbitfs_inner_installation(uuid,uuid) from anon;
revoke all on function public.service_ensure_orbitfs_inner_installation(uuid,uuid) from authenticated;
grant execute on function public.service_ensure_orbitfs_inner_installation(uuid,uuid) to service_role;
