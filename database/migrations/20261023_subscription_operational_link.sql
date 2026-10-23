-- Subscription admin deep link resolves to a real order route.
create or replace function public.orbitfs_subscription_notification() returns trigger language plpgsql security definer set search_path='public' as $$
declare value text;title_text text;sev text;
begin
 if TG_OP='UPDATE' and old.status is not distinct from new.status then return new;end if;
 value:=lower(coalesce(new.status,''));
 if value in ('past_due','failed','payment_failed','unpaid') then title_text:='Subscription requires payment';sev:='warning';
 elsif value in ('cancelled','canceled','terminated') then title_text:='Subscription cancelled';sev:='warning';
 elsif value in ('active','renewed') then title_text:='Subscription active';sev:='success';
 else return new;end if;
 perform public.orbitfs_notify_transaction(new.auth_user_id,'subscription.'||value,title_text,'Your subscription status is now '||value||'.',sev,'subscription',new.id,'/portal/settings',case when new.order_id is null then '/admin/orders' else '/admin/orders/'||new.order_id::text end,'orders.view');
 return new;
exception when others then raise warning 'OrbitFS subscription notification failed: %',sqlerrm;return new;end $$;
