-- Product-independent checkout. Dependency rules come from License Manager product validation policy.
CREATE OR REPLACE FUNCTION public.checkout_cart(p_pay_with_credit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid:=auth.uid(); cid uuid; sumry jsonb; subtotal bigint; discount bigint; total bigint; cust uuid; ord uuid; inv uuid; ordno text; invno text; order_prefix text:='ORB-'; invoice_prefix text:='INV-'; due_days integer:=7; r record; oi uuid; c public.coupons%rowtype; coupon text; has_base boolean; base_product_key text; payres jsonb; currency_code text; currency_count integer; is_gift boolean; gift_email text;
begin
 if uid is null then raise exception 'authentication required'; end if; if not public.account_can_order(uid) then raise exception 'account is not allowed to place new orders'; end if;
 cid:=public.get_or_create_cart(); if not exists(select 1 from public.shopping_cart_items where cart_id=cid) then raise exception 'basket is empty'; end if;
 select count(distinct p.currency),min(p.currency) into currency_count,currency_code from public.shopping_cart_items i join public.products p on p.id=i.product_id where i.cart_id=cid; if currency_count>1 then raise exception 'basket contains products in multiple currencies'; end if; if currency_code is null then raise exception 'basket currency unavailable'; end if;
 select p.license_product_key into base_product_key
 from public.products p
 where p.active=true
   and coalesce(p.metadata->'license_validation_policy'->>'license_strategy','standalone')='base'
 order by p.name
 limit 1;
 has_base:=base_product_key is not null and (
   exists(select 1 from public.products p join public.shopping_cart_items i on i.product_id=p.id
     where i.cart_id=cid and p.license_product_key=base_product_key
       and not coalesce((i.configuration->>'gift')::boolean,false))
   or exists(select 1 from public.products p
     where p.license_product_key=base_product_key and public.user_has_active_product(uid,p.id))
 );
 for r in select i.*,p.name,p.slug,p.price_cents,p.currency,p.metadata,p.license_product_key from public.shopping_cart_items i join public.products p on p.id=i.product_id where i.cart_id=cid loop
  is_gift:=coalesce((r.configuration->>'gift')::boolean,false);
  gift_email:=lower(trim(coalesce(r.configuration->>'gift_recipient_email','')));
  if is_gift then
    if gift_email='' or gift_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then raise exception 'enter a valid gift recipient email for %',r.name; end if;
  else
    if not coalesce((r.metadata->>'allow_repeat_purchase')::boolean,false) and public.user_has_active_product(uid,r.product_id) then raise exception 'you already own active product %',r.name; end if;
    if coalesce(r.metadata->'license_validation_policy'->>'license_strategy','standalone')='component' and not has_base then
      raise exception '% requires the configured base product licence. Add the base product to the basket or activate an existing base service first.',r.name;
    end if;
    if exists(select 1 from public.invoices x join public.order_items xoi on xoi.order_id=x.order_id where x.auth_user_id=uid and xoi.product_id=r.product_id and x.status in ('unpaid','partial','overdue')) then raise exception 'an unpaid invoice already exists for %',r.name; end if;
  end if;
 end loop;
 sumry:=public.cart_summary(); subtotal:=(sumry->>'subtotal_cents')::bigint; discount:=(sumry->>'discount_cents')::bigint; total:=(sumry->>'total_cents')::bigint; coupon:=sumry->>'coupon_code';
 select coalesce((select (value#>>'{}')::int from public.app_settings where key='invoice.due_days'),7) into due_days; select coalesce((select trim(both '\"' from value::text) from public.app_settings where key='billing.order_prefix'),'ORB-') into order_prefix; select coalesce((select trim(both '\"' from value::text) from public.app_settings where key='invoice.prefix'),'INV-') into invoice_prefix; select id into cust from public.customers where auth_user_id=uid limit 1;
 ordno:=order_prefix||lpad(nextval('public.order_number_seq')::text,6,'0'); insert into public.orders(order_number,customer_id,auth_user_id,status,payment_status,fulfillment_status,subtotal_cents,total_cents,currency,metadata) values(ordno,cust,uid,case when total=0 then 'active' else 'pending_payment' end,case when total=0 then 'paid_free' else 'unpaid' end,'pending',subtotal,total,currency_code,jsonb_build_object('basket_checkout',true,'coupon_code',coupon,'contains_gifts',exists(select 1 from public.shopping_cart_items i where i.cart_id=cid and coalesce((i.configuration->>'gift')::boolean,false)))) returning id into ord;
 invno:=invoice_prefix||lpad(nextval('public.invoice_number_seq')::text,6,'0'); insert into public.invoices(invoice_number,order_id,auth_user_id,status,subtotal_cents,discount_cents,total_cents,paid_cents,currency,due_at,paid_at) values(invno,ord,uid,case when total=0 then 'paid' else 'unpaid' end,subtotal,discount,total,0,currency_code,case when total=0 then now() else now()+make_interval(days=>due_days) end,case when total=0 then now() else null end) returning id into inv;
 for r in select i.*,p.name,p.slug,p.price_cents,p.license_product_key from public.shopping_cart_items i join public.products p on p.id=i.product_id where i.cart_id=cid order by case when p.license_product_key=base_product_key then 0 else 1 end,p.name loop
   insert into public.order_items(order_id,product_id,product_name,product_slug,license_product_key,quantity,unit_price_cents,total_cents,configuration,service_status) values(ord,r.product_id,r.name,r.slug,r.license_product_key,r.quantity,coalesce(r.price_cents,0),coalesce(r.price_cents,0)*r.quantity,r.configuration,case when coalesce((r.configuration->>'gift')::boolean,false) then 'pending_gift' else 'pending' end) returning id into oi;
   insert into public.invoice_items(invoice_id,order_item_id,description,quantity,unit_price_cents,total_cents) values(inv,oi,r.name,r.quantity,coalesce(r.price_cents,0),coalesce(r.price_cents,0)*r.quantity);
   if coalesce((r.configuration->>'gift')::boolean,false) then
     insert into public.gift_deliveries(source_order_id,source_order_item_id,purchaser_user_id,recipient_email,status,metadata) values(ord,oi,uid,lower(trim(r.configuration->>'gift_recipient_email')),'pending',jsonb_build_object('product_id',r.product_id,'product_name',r.name)) on conflict(source_order_item_id) do nothing;
   end if;
 end loop;
 if coupon is not null then select * into c from public.coupons where lower(code)=lower(coupon) limit 1; if c.id is not null then insert into public.coupon_redemptions(coupon_id,invoice_id,auth_user_id,discount_cents) values(c.id,inv,uid,discount); end if; end if;
 delete from public.shopping_cart_items where cart_id=cid; update public.shopping_carts set coupon_code=null,updated_at=now() where id=cid;
 if total=0 then perform public.grant_paid_order_entitlements(ord,uid); elsif p_pay_with_credit then payres:=public.pay_invoice_with_credit(inv); end if;
 return jsonb_build_object('order_id',ord,'order_number',ordno,'invoice_id',inv,'invoice_number',invno,'subtotal_cents',subtotal,'discount_cents',discount,'total_cents',total,'currency',currency_code,'paid',total=0 or coalesce(payres->>'status','')='paid','contains_gifts',exists(select 1 from public.gift_deliveries where source_order_id=ord));
end $function$
;
