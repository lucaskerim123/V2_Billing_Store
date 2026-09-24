-- Make Billing/Store feature toggles operational at the database boundary.

create or replace function public.wallet_recharge_gateways() returns jsonb
language sql security definer set search_path='public' as $$
  select case
    when coalesce((select (value #>> '{}')::boolean from public.app_settings where key='billing.credit_topups_enabled'),true)=false
      then '[]'::jsonb
    else coalesce(jsonb_agg(jsonb_build_object(
      'code',code,'name',display_name,'description',description,'provider',provider,
      'fee_fixed_cents',fee_fixed_cents,'fee_percent',fee_percent,'public_config',public_config
    ) order by sort_order,display_name),'[]'::jsonb)
  end
  from public.payment_gateways
  where enabled=true
    and provider in ('stripe','paypal')
    and coalesce((select value #>> '{}' from public.app_settings where key='billing.currency'),'AUD')=any(currencies)
$$;

create or replace function public.create_wallet_recharge(p_amount_cents bigint) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare
  uid uuid:=auth.uid(); rid uuid; receipt text; currency text:='AUD';
  minc bigint:=500; maxc bigint:=100000; topups_enabled boolean:=true;
begin
  if uid is null then raise exception 'authentication required'; end if;
  select coalesce((value#>>'{}')::boolean,true) into topups_enabled from public.app_settings where key='billing.credit_topups_enabled';
  if coalesce(topups_enabled,true)=false then raise exception 'Wallet top-ups are disabled'; end if;
  select coalesce((select (value#>>'{}')::bigint from public.app_settings where key='billing.minimum_credit_topup_cents'),500) into minc;
  select coalesce((select (value#>>'{}')::bigint from public.app_settings where key='billing.maximum_credit_topup_cents'),100000) into maxc;
  select coalesce((select value#>>'{}' from public.app_settings where key='billing.currency'),'AUD') into currency;
  if p_amount_cents<minc or p_amount_cents>maxc then raise exception 'wallet recharge must be between % and % cents',minc,maxc; end if;
  receipt:='WAL-RCPT-'||lpad(nextval('public.wallet_recharge_number_seq')::text,6,'0');
  insert into public.wallet_recharges(receipt_number,auth_user_id,amount_cents,currency,status,metadata)
  values(receipt,uid,p_amount_cents,upper(currency),'pending',jsonb_build_object('source','account_settings'))
  returning id into rid;
  return jsonb_build_object('ok',true,'recharge_id',rid,'receipt_number',receipt,'amount_cents',p_amount_cents,'currency',upper(currency),'status','pending');
end $$;

create or replace function public.checkout_payment_gateways(p_currency text default 'AUD') returns jsonb
language sql security definer set search_path='public' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code',code,'name',display_name,'description',description,'provider',provider,
    'fee_fixed_cents',fee_fixed_cents,'fee_percent',fee_percent,
    'supports_recurring',supports_recurring,
    'instructions',case when provider='manual' then instructions else null end
  ) order by sort_order,display_name),'[]'::jsonb)
  from public.payment_gateways
  where enabled=true
    and p_currency=any(currencies)
    and (provider<>'account_credit' or coalesce((select (value#>>'{}')::boolean from public.app_settings where key='billing.allow_account_credit'),true))
    and (provider<>'manual' or coalesce((select (value#>>'{}')::boolean from public.app_settings where key='billing.allow_manual_payments'),true))
$$;

create or replace function public.set_cart_coupon(p_code text) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare uid uuid:=auth.uid(); cid uuid; coupons_enabled boolean:=true;
begin
  if uid is null then raise exception 'authentication required'; end if;
  select coalesce((value#>>'{}')::boolean,true) into coupons_enabled from public.app_settings where key='products.allow_coupons';
  if coalesce(coupons_enabled,true)=false and nullif(btrim(coalesce(p_code,'')),'') is not null then raise exception 'coupons are disabled'; end if;
  cid:=public.get_or_create_cart();
  update public.shopping_carts
     set coupon_code=case when coalesce(coupons_enabled,true) then nullif(upper(btrim(coalesce(p_code,''))),'') else null end,
         updated_at=now()
   where id=cid and auth_user_id=uid;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.guard_coupon_setting() returns trigger
language plpgsql set search_path='public' as $$
begin
  if coalesce((select (value#>>'{}')::boolean from public.app_settings where key='products.allow_coupons'),true)=false then
    raise exception 'coupons are disabled';
  end if;
  return new;
end $$;
drop trigger if exists trg_coupon_setting_guard on public.coupon_redemptions;
create trigger trg_coupon_setting_guard before insert on public.coupon_redemptions
for each row execute function public.guard_coupon_setting();

create or replace function public.guard_cart_product_settings() returns trigger
language plpgsql set search_path='public' as $$
declare component text; allow_addons boolean:=true; allow_quantity boolean:=true;
begin
  select lower(coalesce(license_product_key,'')) into component from public.products where id=new.product_id;
  select coalesce((value#>>'{}')::boolean,true) into allow_addons from public.app_settings where key='products.allow_addons';
  select coalesce((value#>>'{}')::boolean,true) into allow_quantity from public.app_settings where key='products.allow_quantity';
  if coalesce(allow_addons,true)=false and component not in ('orbitfs_base','orbitfs_panel') then
    raise exception 'add-on products are currently disabled';
  end if;
  if coalesce(allow_quantity,true)=false and coalesce(new.quantity,1)>1 then
    raise exception 'product quantities are disabled';
  end if;
  return new;
end $$;
drop trigger if exists trg_cart_product_settings on public.shopping_cart_items;
create trigger trg_cart_product_settings before insert or update on public.shopping_cart_items
for each row execute function public.guard_cart_product_settings();

create or replace function public.guard_order_item_product_settings() returns trigger
language plpgsql set search_path='public' as $$
declare component text; allow_addons boolean:=true; allow_quantity boolean:=true;
begin
  component:=lower(coalesce(new.license_product_key,''));
  select coalesce((value#>>'{}')::boolean,true) into allow_addons from public.app_settings where key='products.allow_addons';
  select coalesce((value#>>'{}')::boolean,true) into allow_quantity from public.app_settings where key='products.allow_quantity';
  if coalesce(allow_addons,true)=false and component not in ('orbitfs_base','orbitfs_panel') then
    raise exception 'add-on products are currently disabled';
  end if;
  if coalesce(allow_quantity,true)=false and coalesce(new.quantity,1)>1 then
    raise exception 'product quantities are disabled';
  end if;
  return new;
end $$;
drop trigger if exists trg_order_item_product_settings on public.order_items;
create trigger trg_order_item_product_settings before insert or update on public.order_items
for each row execute function public.guard_order_item_product_settings();
