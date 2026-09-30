-- Canonical customer-number propagation: support both the current user_id
-- and the legacy auth_user_id identity, without overwriting other profile data.
create or replace function public.sync_customer_number_to_profile()
returns trigger language plpgsql security definer set search_path='public' as $$
begin
  if new.customer_number is not null then
    update public.user_profiles
       set customer_number=new.customer_number
     where id=coalesce(new.user_id,new.auth_user_id)
       and customer_number is distinct from new.customer_number;
  end if;
  return new;
end $$;
