-- Reconcile Billing Store identities after a database move where public/business
-- rows were restored but Supabase auth.users was intentionally not copied.
-- The login bridge creates a fresh Auth user only after the canonical OrbitFS
-- password has been verified, then calls this function to move every declared
-- public FK reference atomically without deleting business history.

create or replace function public.link_recent_orbitfs_customer_auth(
  p_old_user_id uuid,
  p_new_auth_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path='public','auth'
as $$
declare
  old_user public.users%rowtype;
  new_auth_email text;
  ref record;
begin
  if p_old_user_id is null
     or p_new_auth_user_id is null
     or p_old_user_id = p_new_auth_user_id then
    raise exception 'invalid account migration identifiers';
  end if;

  select *
    into old_user
    from public.users
   where id = p_old_user_id
   for update;

  if not found then
    raise exception 'original OrbitFS user not found';
  end if;

  if old_user.status <> 'active' then
    raise exception 'inactive accounts cannot migrate';
  end if;

  if exists(select 1 from auth.users where id=p_old_user_id) then
    raise exception 'existing Auth identity must not be migrated';
  end if;

  select email
    into new_auth_email
    from auth.users
   where id=p_new_auth_user_id;

  if new_auth_email is null
     or lower(new_auth_email) <> lower(old_user.email) then
    raise exception 'Auth identity email does not match verified OrbitFS account';
  end if;

  if exists(select 1 from public.users where id=p_new_auth_user_id) then
    raise exception 'target OrbitFS identity already exists';
  end if;

  -- Free canonical unique values while preserving the original row until every
  -- reference has been moved successfully.
  update public.users
     set email='migration-'||p_old_user_id::text||'@invalid.orbitfs.local',
         username=null,
         updated_at=now()
   where id=p_old_user_id;

  insert into public.users
  select (
    jsonb_populate_record(
      null::public.users,
      to_jsonb(old_user) || jsonb_build_object(
        'id',p_new_auth_user_id,
        'updated_at',now()
      )
    )
  ).*;

  -- Move every public FK that points at Supabase Auth. These include orders,
  -- invoices, licence bindings, installations, provider connections, support,
  -- notifications and lifecycle/deployment records. The new Auth user already
  -- exists, so each update is immediately FK-valid.
  for ref in
    select distinct
      ns.nspname as table_schema,
      cls.relname as table_name,
      att.attname as column_name
    from pg_constraint con
    join pg_class cls on cls.oid=con.conrelid
    join pg_namespace ns on ns.oid=cls.relnamespace
    join pg_class fcls on fcls.oid=con.confrelid
    join pg_namespace fns on fns.oid=fcls.relnamespace
    join unnest(con.conkey) with ordinality ck(attnum,ord) on true
    join pg_attribute att on att.attrelid=cls.oid and att.attnum=ck.attnum
    where con.contype='f'
      and ns.nspname='public'
      and fns.nspname='auth'
      and fcls.relname='users'
      and array_length(con.conkey,1)=1
  loop
    execute format(
      'update %I.%I set %I=$1 where %I=$2',
      ref.table_schema,ref.table_name,ref.column_name,ref.column_name
    ) using p_new_auth_user_id,p_old_user_id;
  end loop;

  -- Move every public FK that points at the canonical public.users identity.
  for ref in
    select distinct
      ns.nspname as table_schema,
      cls.relname as table_name,
      att.attname as column_name
    from pg_constraint con
    join pg_class cls on cls.oid=con.conrelid
    join pg_namespace ns on ns.oid=cls.relnamespace
    join pg_class fcls on fcls.oid=con.confrelid
    join pg_namespace fns on fns.oid=fcls.relnamespace
    join unnest(con.conkey) with ordinality ck(attnum,ord) on true
    join pg_attribute att on att.attrelid=cls.oid and att.attnum=ck.attnum
    where con.contype='f'
      and ns.nspname='public'
      and fns.nspname='public'
      and fcls.relname='users'
      and array_length(con.conkey,1)=1
  loop
    execute format(
      'update %I.%I set %I=$1 where %I=$2',
      ref.table_schema,ref.table_name,ref.column_name,ref.column_name
    ) using p_new_auth_user_id,p_old_user_id;
  end loop;

  -- Compatibility fields that intentionally are not backed by an FK.
  if to_regclass('public.mail_event_outbox') is not null then
    update public.mail_event_outbox
       set auth_user_id=p_new_auth_user_id
     where auth_user_id=p_old_user_id;
  end if;

  delete from public.users where id=p_old_user_id;

  insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
  values(
    null,
    'auth.identity.linked',
    'user',
    p_new_auth_user_id::text,
    jsonb_build_object(
      'previous_canonical_user_id',p_old_user_id,
      'method','password_verified_history_preserving_auth_reconciliation'
    )
  );

  return p_new_auth_user_id;
end
$$;

revoke all on function public.link_recent_orbitfs_customer_auth(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.link_recent_orbitfs_customer_auth(uuid,uuid)
  to service_role;
