-- Restore browser Supabase Auth session compatibility for recent canonical-only customers.
-- Restricted to the service role after an already authenticated OrbitFS password login.
create or replace function public.link_recent_orbitfs_customer_auth(p_old_user_id uuid,p_new_auth_user_id uuid)
returns uuid language plpgsql security definer set search_path='public','auth' as $$
declare old_user public.users%rowtype; new_auth_email text;
        ref record; unexpected_reference boolean;
begin
  if p_old_user_id is null or p_new_auth_user_id is null or p_old_user_id=p_new_auth_user_id then
    raise exception 'invalid account migration identifiers';
  end if;
  select * into old_user from public.users where id=p_old_user_id for update;
  if not found then raise exception 'original OrbitFS user not found'; end if;
  if old_user.status <> 'active' then raise exception 'inactive accounts cannot migrate'; end if;
  if exists(select 1 from auth.users where id=p_old_user_id) then raise exception 'existing Auth identity must not be migrated'; end if;
  select email into new_auth_email from auth.users where id=p_new_auth_user_id;
  if new_auth_email is null or lower(new_auth_email)<>lower(old_user.email) then
    raise exception 'Auth identity email does not match verified OrbitFS account';
  end if;
  if exists(select 1 from public.users where id=p_new_auth_user_id) then raise exception 'target OrbitFS identity already exists'; end if;
  -- Only migrate new, unmapped customers without business records or staff privileges.
  if not exists(select 1 from public.customers where user_id=p_old_user_id)
     or exists(select 1 from public.staff_access where user_id=p_old_user_id)
     or exists(select 1 from public.staff_members where user_id=p_old_user_id)
     or exists(select 1 from public.orders where auth_user_id=p_old_user_id)
     or exists(select 1 from public.invoices where auth_user_id=p_old_user_id)
     or exists(select 1 from public.support_tickets where user_id=p_old_user_id)
     or exists(select 1 from public.orbitfs_installations where auth_user_id=p_old_user_id)
  then raise exception 'account has existing business records and requires manual identity reconciliation'; end if;
  if exists(select 1 from public.customers where auth_user_id=p_old_user_id) then
    raise exception 'customer has an existing legacy Auth identity';
  end if;
  -- Do not migrate accounts with any other UUID references. This inventory
  -- guard protects future tables as well as the known billing/release models.
  for ref in
    select c.table_schema,c.table_name,c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema=c.table_schema and t.table_name=c.table_name
     where c.table_schema='public' and c.data_type='uuid' and t.table_type='BASE TABLE'
       and (c.table_name,c.column_name) not in (
        ('users','id'),
        ('customers','user_id'),('customer_credentials','user_id'),
        ('customer_sessions','user_id'),
        ('orbitfs_email_verification_tokens','user_id'),
        ('orbitfs_password_reset_tokens','user_id'),
        ('orbitfs_password_reset_tokens','requested_by'),
        ('mail_event_outbox','auth_user_id'),('user_profiles','user_id')
       )
  loop
    execute format('select exists(select 1 from %I.%I where %I=$1)',
      ref.table_schema,ref.table_name,ref.column_name)
      into unexpected_reference using p_old_user_id;
    if unexpected_reference then
      raise exception 'account has an unhandled reference: %.%',ref.table_name,ref.column_name;
    end if;
  end loop;
  -- Preserve original user row until every supported FK reference has moved.
  update public.users set email='migration-'||p_old_user_id::text||'@invalid.orbitfs.local',
     username=null where id=p_old_user_id;
  insert into public.users
    select (jsonb_populate_record(null::public.users,
      to_jsonb(old_user)||jsonb_build_object('id',p_new_auth_user_id))).*;
  update public.customer_credentials set user_id=p_new_auth_user_id where user_id=p_old_user_id;
  update public.customers set user_id=p_new_auth_user_id,auth_user_id=p_new_auth_user_id
   where user_id=p_old_user_id;
  update public.customer_sessions
    set user_id=p_new_auth_user_id,revoked_at=coalesce(revoked_at,now())
    where user_id=p_old_user_id;
  update public.orbitfs_email_verification_tokens set user_id=p_new_auth_user_id
    where user_id=p_old_user_id;
  update public.orbitfs_password_reset_tokens set user_id=p_new_auth_user_id
    where user_id=p_old_user_id;
  update public.orbitfs_password_reset_tokens set requested_by=p_new_auth_user_id
    where requested_by=p_old_user_id;
  update public.mail_event_outbox set auth_user_id=p_new_auth_user_id
    where auth_user_id=p_old_user_id;
  update public.user_profiles set user_id=p_new_auth_user_id where user_id=p_old_user_id;
  delete from public.users where id=p_old_user_id;
  insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
  values(null,'auth.identity.linked','user',p_new_auth_user_id::text,
    jsonb_build_object('previous_canonical_user_id',p_old_user_id,
                       'method','password_verified_browser_auth_compatibility'));
  return p_new_auth_user_id;
end $$;
revoke all on function public.link_recent_orbitfs_customer_auth(uuid,uuid) from public,anon,authenticated;
grant execute on function public.link_recent_orbitfs_customer_auth(uuid,uuid) to service_role;
