-- OrbitFS unified auth compatibility fix.
-- customer_credentials must belong to the canonical OrbitFS user, not the legacy
-- customers.auth_user_id column. The unified identity migration made public.users
-- authoritative, while auth_user_id remains legacy compatibility data.

alter table public.customer_credentials
  drop constraint if exists customer_credentials_customer_identity_fkey;

alter table public.customer_credentials
  add constraint customer_credentials_user_fkey
  foreign key (user_id) references public.users(id) on delete cascade;

-- Keep legacy customer rows attached to the canonical user where possible.
update public.customers c
set user_id=c.auth_user_id
where c.user_id is null
  and c.auth_user_id is not null
  and exists(select 1 from public.users u where u.id=c.auth_user_id);

comment on constraint customer_credentials_user_fkey on public.customer_credentials
is 'Customer credentials belong to the canonical OrbitFS public.users identity.';
