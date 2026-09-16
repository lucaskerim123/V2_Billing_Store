-- Existing staff identities remain the same users; customer access is additive.
insert into public.customers (user_id,auth_user_id,email,name,display_name,first_name,last_name,status,email_verified_at,metadata,updated_at)
select u.id,null,u.email,u.display_name,u.display_name,u.first_name,u.last_name,'active',u.email_verified_at,
       jsonb_build_object('account_capabilities',jsonb_build_array('customer','staff'),'created_by_architecture_migration',true),now()
from public.users u join public.staff_access s on s.user_id=u.id and s.enabled=true
left join public.customers c on c.user_id=u.id where c.id is null on conflict do nothing;
