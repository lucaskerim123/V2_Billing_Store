-- Billing Store production integrity audit (read-only).
-- Project: bealqgenrcytjzjoikmk. No user data or secrets are exported.
-- Run against the confirmed Billing Store database after schema migrations.
with metrics as (
  select 'customer_auth_identity' as check_name,
    count(*) filter (where c.user_id is not null and (a.id is null or u.id is null or (c.auth_user_id is not null and c.auth_user_id<>c.user_id)))::bigint as issues
  from public.customers c left join public.users u on u.id=c.user_id left join auth.users a on a.id=c.user_id
  union all
  select 'customer_profiles',count(*)::bigint from public.customers c
    join public.users u on u.id=c.user_id join auth.users a on a.id=u.id
    left join public.user_profiles p on p.id=u.id and p.user_id=u.id
    where p.id is null
  union all
  select 'customer_wallets',count(*)::bigint from public.customers c
    join public.user_profiles p on p.id=c.user_id
    left join public.account_balances b on b.user_id=p.id where b.user_id is null
  union all
  select 'orphaned_profiles',count(*)::bigint from public.user_profiles p
    left join auth.users a on a.id=p.id
    left join public.users u on u.id=p.user_id
    where a.id is null or (p.user_id is not null and u.id is null)
  union all
  select 'duplicate_customer_user_links',count(*)::bigint from (
    select user_id from public.customers where user_id is not null
    group by user_id having count(*)>1
  ) duplicate_links
  union all
  select 'unvalidated_public_foreign_keys',count(*)::bigint from pg_constraint
    where contype='f' and connamespace='public'::regnamespace and not convalidated
  union all
  select 'missing_support_ticket_number_default',count(*)::bigint
    from information_schema.columns where table_schema='public'
      and table_name='support_tickets' and column_name='ticket_number' and column_default is null
  union all
  select 'missing_customer_onboarding_trigger',
    case when exists(select 1 from pg_trigger where tgrelid='public.customers'::regclass
       and tgname='customer_profile_onboarding' and tgenabled<>'D' and not tgisinternal)
      then 0::bigint else 1::bigint end
  union all
  select 'missing_private_support_bucket',
    case when exists(select 1 from storage.buckets where id='support-attachments'
      and public=false and file_size_limit=26214400) then 0::bigint else 1::bigint end
  union all
  select 'missing_active_support_jobs',
    2::bigint-count(*)::bigint from cron.job
    where jobname in ('orbitfs-support-auto-close','orbitfs-guest-support-expiry') and active
  union all
  select 'unauthorized_support_housekeeping_grants',
    (has_function_privilege('anon','public.process_support_auto_close()','EXECUTE')::int
    +has_function_privilege('authenticated','public.process_support_auto_close()','EXECUTE')::int
    +has_function_privilege('anon','public.process_expired_guest_support_tickets()','EXECUTE')::int
    +has_function_privilege('authenticated','public.process_expired_guest_support_tickets()','EXECUTE')::int)::bigint
)
select check_name,issues,case when issues=0 then 'PASS' else 'FAIL' end status
from metrics order by check_name;

-- Informational full-public-schema inventory; a NOT NULL column without a
-- default may be intentionally supplied by the application, not an error.
select
 (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p')) public_tables,
 (select count(*) from pg_constraint where contype='f' and connamespace='public'::regnamespace) public_foreign_keys,
 (select count(*) from pg_trigger t join pg_namespace n on n.oid=t.tgrelid::regclass::oid
   where not t.tgisinternal and t.tgrelid in
     (select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public')) public_custom_triggers,
 (select count(*) from information_schema.columns where table_schema='public'
     and is_nullable='NO' and column_default is null and is_identity='NO') explicitly_supplied_required_columns;
