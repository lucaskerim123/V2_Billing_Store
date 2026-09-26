-- OrbitFS lifecycle jobs and reversible install state.
-- Adds durable undeploy/uninstall tracking without deleting historical installation records.

alter table public.orbitfs_installations
  drop constraint if exists orbitfs_installations_state_check;

alter table public.orbitfs_installations
  add constraint orbitfs_installations_state_check
  check (state in (
    'pending','awaiting_supabase','preparing_database','awaiting_vercel',
    'configuring','deploying','ready','updating','failed',
    'undeploying','uninstalling','uninstalled'
  ));

create table if not exists public.orbitfs_lifecycle_jobs (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.orbitfs_installations(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('undeploy','uninstall')),
  status text not null default 'planned' check (status in ('planned','running','completed','failed','partial')),
  current_step text,
  options jsonb not null default '{}'::jsonb,
  plan jsonb not null default '{}'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists orbitfs_lifecycle_jobs_install_idx
  on public.orbitfs_lifecycle_jobs(installation_id,created_at desc);

alter table public.orbitfs_lifecycle_jobs enable row level security;

drop policy if exists "owner lifecycle jobs read" on public.orbitfs_lifecycle_jobs;
create policy "owner lifecycle jobs read"
on public.orbitfs_lifecycle_jobs for select to authenticated
using (auth_user_id=auth.uid());

drop policy if exists "staff lifecycle jobs read" on public.orbitfs_lifecycle_jobs;
create policy "staff lifecycle jobs read"
on public.orbitfs_lifecycle_jobs for select to authenticated
using (public.has_permission('licenses.view'));

create or replace function public.orbitfs_lifecycle_jobs_touch_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin new.updated_at:=now(); return new; end
$$;

drop trigger if exists orbitfs_lifecycle_jobs_touch on public.orbitfs_lifecycle_jobs;
create trigger orbitfs_lifecycle_jobs_touch
before update on public.orbitfs_lifecycle_jobs
for each row execute function public.orbitfs_lifecycle_jobs_touch_updated_at();

create or replace function public.ensure_orbitfs_installation(p_binding_id uuid)
returns public.orbitfs_installations
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  b public.license_bindings%rowtype;
  result public.orbitfs_installations%rowtype;
  caller uuid:=auth.uid();
  base_allowed boolean:=false;
  cfg public.orbitfs_release_system_settings%rowtype;
  reusable_id uuid;
  next_state text;
begin
  select * into cfg from public.orbitfs_release_system_settings where id='primary';
  if not coalesce(cfg.enabled,false) or not coalesce(cfg.customer_deploy_enabled,false) then raise exception 'OrbitFS deployment system is currently disabled'; end if;
  select * into b from public.license_bindings where id=p_binding_id and archived_at is null;
  if not found then raise exception 'Licence not found'; end if;
  if caller is null then raise exception 'Authentication required'; end if;
  if b.auth_user_id<>caller and not public.has_permission('licenses.edit') then raise exception 'Not allowed to create this OrbitFS installation'; end if;
  base_allowed:=b.license_product_key='orbitfs_base' or coalesce((b.components->>'orbitfs_base')::boolean,false) or coalesce((b.components->>'orbitfs_panel')::boolean,false);
  if not base_allowed then raise exception 'This licence does not include OrbitFS Base'; end if;

  select * into result
  from public.orbitfs_installations
  where license_binding_id=b.id and component_key='orbitfs_base';

  if found then
    if result.state='uninstalled' then
      next_state:=case
        when result.supabase_project_ref is null then 'awaiting_supabase'
        when result.database_initialized_at is null then 'preparing_database'
        else 'awaiting_vercel'
      end;
      update public.orbitfs_installations
      set installation_id='ofs_'||replace(gen_random_uuid()::text,'-',''),
          state=next_state,
          vercel_project_id=null,
          vercel_project_name=null,
          vercel_deployment_id=null,
          deployment_url=null,
          production_url=null,
          health_status='unknown',
          last_health_at=null,
          last_error=null,
          metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{lifecycle,lastReinstallAt}',to_jsonb(now()::text),true),
          updated_at=now()
      where id=result.id returning * into result;
    elsif result.state='pending' then
      update public.orbitfs_installations set state='awaiting_supabase',updated_at=now() where id=result.id returning * into result;
    end if;
    return result;
  end if;

  select i.id into reusable_id
  from public.orbitfs_installations i
  left join public.license_bindings oldb on oldb.id=i.license_binding_id
  where i.auth_user_id=b.auth_user_id and i.component_key='orbitfs_base' and (oldb.id is null or oldb.archived_at is not null)
  order by case when i.release_version is not null or i.state='ready' then 50 when i.vercel_project_id is not null then 40 when i.database_initialized_at is not null then 30 when i.supabase_project_ref is not null then 20 else 10 end desc,i.updated_at desc
  limit 1;
  if reusable_id is not null then
    update public.orbitfs_installations
    set license_binding_id=b.id,order_id=b.order_id,order_item_id=b.order_item_id,updated_at=now()
    where id=reusable_id returning * into result;
    return result;
  end if;

  insert into public.orbitfs_installations(auth_user_id,license_binding_id,order_id,order_item_id,component_key,installation_id,state)
  values(b.auth_user_id,b.id,b.order_id,b.order_item_id,'orbitfs_base','ofs_'||replace(gen_random_uuid()::text,'-',''),'awaiting_supabase')
  returning * into result;
  return result;
end
$function$;

revoke all on function public.ensure_orbitfs_installation(uuid) from public;
grant execute on function public.ensure_orbitfs_installation(uuid) to authenticated;
