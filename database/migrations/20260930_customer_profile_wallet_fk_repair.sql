-- Forward-only repair: canonical Billing Store customer records must have
-- the legacy auth-backed profile expected by customer portal/FK-dependent flows.
-- Do not create Auth users, change keys, modify applied migrations or touch balances.
create or replace function public.ensure_billing_customer_profile(p_user_id uuid)
returns void language plpgsql security definer
set search_path=public,pg_temp as $$
declare u public.users%rowtype; c public.customers%rowtype;
begin
  if p_user_id is null then raise exception 'missing canonical customer identity'; end if;
  select * into u from public.users where id=p_user_id;
  if not found then raise exception 'canonical user missing'; end if;
  if not exists(select 1 from auth.users a where a.id=p_user_id) then
    raise exception 'customer requires a matching browser Auth user';
  end if;
  select * into c from public.customers where user_id=p_user_id order by created_at limit 1;
  if not found then raise exception 'canonical customer record missing'; end if;
  insert into public.user_profiles
    (id,user_id,role,status,display_name,first_name,last_name,
     email_verified_at,customer_number,created_at,updated_at)
  values
    (u.id,u.id,'user',
     case when u.status in ('active','suspended','pending') then u.status else 'pending' end,
     coalesce(nullif(c.display_name,''),nullif(u.display_name,''),nullif(c.name,'')),
     coalesce(c.first_name,u.first_name),coalesce(c.last_name,u.last_name),
     coalesce(u.email_verified_at,c.email_verified_at),c.customer_number,
     now(),now())
  on conflict(id) do nothing;
  -- Wallet creation is idempotent and must never change existing funds.
  insert into public.account_balances(user_id)
  values(p_user_id) on conflict(user_id) do nothing;
end $$;
revoke all on function public.ensure_billing_customer_profile(uuid) from public,anon,authenticated;
grant execute on function public.ensure_billing_customer_profile(uuid) to service_role;

create or replace function public.customer_profile_onboarding_trigger()
returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$
begin
  if new.user_id is not null
     and exists(select 1 from auth.users a where a.id=new.user_id)
  then
    perform public.ensure_billing_customer_profile(new.user_id);
  end if;
  return new;
end $$;
revoke all on function public.customer_profile_onboarding_trigger() from public,anon,authenticated;

drop trigger if exists customer_profile_onboarding on public.customers;
create trigger customer_profile_onboarding
after insert or update of user_id,auth_user_id on public.customers
for each row execute function public.customer_profile_onboarding_trigger();

-- Restore profile-to-customer synchronization for the current canonical user id,
-- retaining the legacy auth_user_id compatibility lookup.
CREATE OR REPLACE FUNCTION public.sync_customer_from_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 update public.customers
 set
   name=coalesce(nullif(new.display_name,''),nullif(trim(concat_ws(' ',new.first_name,new.last_name)),''),name),
   display_name=new.display_name,
   first_name=new.first_name,
   last_name=new.last_name,
   company_name=new.company_name,
   phone=new.phone,
   address_line1=new.address_line1,
   address_line2=new.address_line2,
   city=new.city,
   state_region=new.state_region,
   postal_code=new.postal_code,
   country_code=new.country_code,
   timezone=new.timezone,
   currency=new.currency,
   language=new.language,
   status=case
     when new.banned_at is not null and (new.ban_expires_at is null or new.ban_expires_at>now()) then 'banned'
     else coalesce(new.status,'active')
   end,
   customer_number=coalesce(new.customer_number,customer_number),
   email_verified_at=coalesce(new.email_verified_at,email_verified_at),
   updated_at=now()
 where auth_user_id=new.id or user_id=new.id;
 return new;
end
$function$;

-- Heal existing confirmed linked customer accounts without deleting/updating
-- existing profiles, identity rows, or wallet balances.
do $$
declare account record;
begin
  for account in
    select distinct c.user_id
    from public.customers c
    join public.users u on u.id=c.user_id
    join auth.users a on a.id=u.id
    where not exists(select 1 from public.user_profiles p where p.id=u.id and p.user_id=u.id)
  loop
    perform public.ensure_billing_customer_profile(account.user_id);
  end loop;
end $$;
-- Also heal only genuinely missing wallet rows (no balance reset).
insert into public.account_balances(user_id)
select p.id from public.user_profiles p
join public.customers c on c.user_id=p.id
where not exists(select 1 from public.account_balances b where b.user_id=p.id)
on conflict(user_id) do nothing;
