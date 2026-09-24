-- Customer deployment maintenance controls for Base and Update execution.
-- Billing Store owns the customer-facing availability gate; License Manager remains
-- the technical deployment authority.

alter table public.orbitfs_release_system_settings
  add column if not exists maintenance_mode boolean not null default false,
  add column if not exists maintenance_message text not null default 'OrbitFS deployment services are temporarily unavailable while maintenance is in progress.';

create or replace function public.admin_update_orbitfs_release_system(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare outrow public.orbitfs_release_system_settings%rowtype;
begin
  if not (public.has_permission('licenses.manage') or public.has_permission('licenses.edit') or public.has_permission('license_api.manage')) then raise exception 'permission denied'; end if;
  update public.orbitfs_release_system_settings set
    enabled=case when p_patch?'enabled' then (p_patch->>'enabled')::boolean else enabled end,
    maintenance_mode=case when p_patch?'maintenance_mode' then (p_patch->>'maintenance_mode')::boolean else maintenance_mode end,
    maintenance_message=case when p_patch?'maintenance_message' then coalesce(nullif(btrim(p_patch->>'maintenance_message'),''),maintenance_message) else maintenance_message end,
    customer_deploy_enabled=case when p_patch?'customer_deploy_enabled' then (p_patch->>'customer_deploy_enabled')::boolean else customer_deploy_enabled end,
    customer_updates_enabled=case when p_patch?'customer_updates_enabled' then (p_patch->>'customer_updates_enabled')::boolean else customer_updates_enabled end,
    customer_rollbacks_enabled=case when p_patch?'customer_rollbacks_enabled' then (p_patch->>'customer_rollbacks_enabled')::boolean else customer_rollbacks_enabled end,
    allow_existing_supabase_project=case when p_patch?'allow_existing_supabase_project' then (p_patch->>'allow_existing_supabase_project')::boolean else allow_existing_supabase_project end,
    allow_create_supabase_project=case when p_patch?'allow_create_supabase_project' then (p_patch->>'allow_create_supabase_project')::boolean else allow_create_supabase_project end,
    supabase_oauth_enabled=case when p_patch?'supabase_oauth_enabled' then (p_patch->>'supabase_oauth_enabled')::boolean else supabase_oauth_enabled end,
    vercel_oauth_enabled=case when p_patch?'vercel_oauth_enabled' then (p_patch->>'vercel_oauth_enabled')::boolean else vercel_oauth_enabled end,
    supabase_client_id=case when p_patch?'supabase_client_id' then nullif(btrim(p_patch->>'supabase_client_id'),'') else supabase_client_id end,
    vercel_client_id=case when p_patch?'vercel_client_id' then nullif(btrim(p_patch->>'vercel_client_id'),'') else vercel_client_id end,
    vercel_install_url=case when p_patch?'vercel_install_url' then nullif(btrim(p_patch->>'vercel_install_url'),'') else vercel_install_url end,
    supabase_scopes=case when p_patch?'supabase_scopes' then coalesce(nullif(btrim(p_patch->>'supabase_scopes'),''),supabase_scopes) else supabase_scopes end,
    default_supabase_region=case when p_patch?'default_supabase_region' then coalesce(nullif(btrim(p_patch->>'default_supabase_region'),''),default_supabase_region) else default_supabase_region end,
    panel_project_prefix=case when p_patch?'panel_project_prefix' then coalesce(nullif(btrim(p_patch->>'panel_project_prefix'),''),panel_project_prefix) else panel_project_prefix end,
    schema_version=case when p_patch?'schema_version' then coalesce(nullif(btrim(p_patch->>'schema_version'),''),schema_version) else schema_version end,
    schema_bucket=case when p_patch?'schema_bucket' then coalesce(nullif(btrim(p_patch->>'schema_bucket'),''),schema_bucket) else schema_bucket end,
    schema_path=case when p_patch?'schema_path' then coalesce(nullif(btrim(p_patch->>'schema_path'),''),schema_path) else schema_path end,
    health_path=case when p_patch?'health_path' then coalesce(nullif(btrim(p_patch->>'health_path'),''),health_path) else health_path end,
    release_channel=case when p_patch?'release_channel' then coalesce(nullif(btrim(p_patch->>'release_channel'),''),release_channel) else release_channel end,
    metadata=case when p_patch?'metadata' and jsonb_typeof(p_patch->'metadata')='object' then p_patch->'metadata' else metadata end,
    updated_by=auth.uid(), updated_at=now()
  where id='primary' returning * into outrow;
  return to_jsonb(outrow);
end $$;
revoke all on function public.admin_update_orbitfs_release_system(jsonb) from public;
grant execute on function public.admin_update_orbitfs_release_system(jsonb) to authenticated;

create or replace function public.orbitfs_release_public_settings()
returns jsonb language sql security definer set search_path=public as $$
select jsonb_build_object(
 'enabled',enabled,
 'maintenance_mode',maintenance_mode,
 'maintenance_message',maintenance_message,
 'customer_deploy_enabled',customer_deploy_enabled,
 'customer_updates_enabled',customer_updates_enabled,
 'customer_rollbacks_enabled',customer_rollbacks_enabled,
 'allow_existing_supabase_project',allow_existing_supabase_project,
 'allow_create_supabase_project',allow_create_supabase_project,
 'supabase_oauth_enabled',supabase_oauth_enabled,
 'vercel_oauth_enabled',vercel_oauth_enabled,
 'schema_version',schema_version,
 'release_channel',release_channel
) from public.orbitfs_release_system_settings where id='primary';
$$;
revoke all on function public.orbitfs_release_public_settings() from public;
grant execute on function public.orbitfs_release_public_settings() to authenticated;

create or replace function public.ensure_orbitfs_installation(p_binding_id uuid)
returns public.orbitfs_installations language plpgsql security definer set search_path=public as $$
declare b public.license_bindings%rowtype; result public.orbitfs_installations%rowtype; caller uuid:=auth.uid(); base_allowed boolean:=false; cfg public.orbitfs_release_system_settings%rowtype;
begin
  select * into cfg from public.orbitfs_release_system_settings where id='primary';
  if not coalesce(cfg.enabled,false) or coalesce(cfg.maintenance_mode,false) or not coalesce(cfg.customer_deploy_enabled,false) then
    raise exception '%', case when coalesce(cfg.maintenance_mode,false) then coalesce(nullif(cfg.maintenance_message,''),'OrbitFS deployment maintenance is active') else 'OrbitFS deployment system is currently disabled' end;
  end if;
  select * into b from public.license_bindings where id=p_binding_id and archived_at is null;
  if not found then raise exception 'Licence not found'; end if;
  if caller is null then raise exception 'Authentication required'; end if;
  if b.auth_user_id<>caller and not public.has_permission('licenses.edit') then raise exception 'Not allowed to create this OrbitFS installation'; end if;
  base_allowed:=b.license_product_key='orbitfs_base' or coalesce((b.components->>'orbitfs_base')::boolean,false) or coalesce((b.components->>'orbitfs_panel')::boolean,false);
  if not base_allowed then raise exception 'This licence does not include OrbitFS Base'; end if;
  select * into result from public.orbitfs_installations where license_binding_id=b.id and component_key='orbitfs_base';
  if found then
    if result.state='pending' then update public.orbitfs_installations set state='awaiting_supabase',updated_at=now() where id=result.id returning * into result; end if;
    return result;
  end if;
  insert into public.orbitfs_installations(auth_user_id,license_binding_id,order_id,order_item_id,component_key,installation_id,state)
  values(b.auth_user_id,b.id,b.order_id,b.order_item_id,'orbitfs_base','ofs_'||replace(gen_random_uuid()::text,'-',''),'awaiting_supabase') returning * into result;
  return result;
end $$;
revoke all on function public.ensure_orbitfs_installation(uuid) from public;
grant execute on function public.ensure_orbitfs_installation(uuid) to authenticated;
