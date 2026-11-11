-- Store checkout derives product dependencies from the License Manager policy
-- mirrored into products.metadata. Independent products remain independent.
CREATE OR REPLACE FUNCTION public.cart_summary() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
 uid uuid:=auth.uid();
 cid uuid;
 subtotal bigint:=0;
 discount bigint:=0;
 eligible bigint:=0;
 tax bigint:=0;
 taxable bigint:=0;
 tax_enabled boolean:=false;
 tax_rate numeric:=0;
 c public.coupons%rowtype;
 used_count integer;
 items jsonb:='[]'::jsonb;
 r record;
 line bigint;
 coupon text;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
 cid:=public.get_or_create_cart();
 SELECT coupon_code INTO coupon FROM public.shopping_carts WHERE id=cid;

 FOR r IN
  SELECT i.*,p.name,p.slug,p.price_cents,p.currency,p.metadata,p.license_product_key
  FROM public.shopping_cart_items i
  JOIN public.products p ON p.id=i.product_id
  WHERE i.cart_id=cid
  ORDER BY CASE
   WHEN lower(coalesce(p.metadata->'license_validation_policy'->>'license_strategy','standalone'))='base' THEN 0
   ELSE 1
  END,p.name
 LOOP
  line:=coalesce(r.price_cents,0)*r.quantity;
  subtotal:=subtotal+line;
  items:=items||jsonb_build_array(jsonb_build_object(
   'id',r.id,'product_id',r.product_id,'name',r.name,'slug',r.slug,
   'quantity',r.quantity,'configuration',r.configuration,
   'line_total_cents',line,'currency',r.currency,
   'license_product_key',r.license_product_key
  ));
 END LOOP;

 IF coalesce((SELECT (value#>>'{}')::boolean FROM public.app_settings WHERE key='products.allow_coupons'),true)=false THEN
  coupon:=null;
 END IF;

 IF coupon IS NOT NULL AND subtotal>0 THEN
  SELECT * INTO c
  FROM public.coupons
  WHERE lower(code)=lower(coupon)
   AND active=true
   AND (starts_at IS NULL OR starts_at<=now())
   AND (ends_at IS NULL OR ends_at>=now())
   AND subtotal>=min_order_cents;

  IF FOUND THEN
   SELECT coalesce(sum(coalesce(p.price_cents,0)*i.quantity),0) INTO eligible
   FROM public.shopping_cart_items i
   JOIN public.products p ON p.id=i.product_id
   WHERE i.cart_id=cid
    AND (cardinality(c.product_ids)=0 OR p.id=ANY(c.product_ids));

   SELECT count(*) INTO used_count FROM public.coupon_redemptions WHERE coupon_id=c.id;
   IF c.max_redemptions IS NOT NULL AND used_count>=c.max_redemptions THEN
    RAISE EXCEPTION 'coupon redemption limit reached';
   END IF;

   SELECT count(*) INTO used_count
   FROM public.coupon_redemptions
   WHERE coupon_id=c.id AND auth_user_id=uid;
   IF used_count>=c.per_user_limit THEN RAISE EXCEPTION 'coupon already used'; END IF;
   IF eligible<=0 THEN RAISE EXCEPTION 'coupon does not apply to products in this basket'; END IF;

   IF c.discount_type='percent' THEN
    discount:=least(eligible,round(eligible*(c.discount_value::numeric/100)));
   ELSE
    discount:=least(eligible,c.discount_value);
   END IF;
  ELSE
   RAISE EXCEPTION 'invalid or unavailable coupon';
  END IF;
 END IF;

 taxable:=greatest(0,subtotal-discount);
 SELECT coalesce((value#>>'{}')::boolean,false) INTO tax_enabled
 FROM public.app_settings WHERE key='billing.tax_enabled';
 SELECT coalesce((value#>>'{}')::numeric,0) INTO tax_rate
 FROM public.app_settings WHERE key='billing.tax_rate';
 IF coalesce(tax_enabled,false) AND tax_rate>0 THEN
  tax:=round(taxable*(tax_rate/100));
 END IF;

 RETURN jsonb_build_object(
  'cart_id',cid,'items',items,'subtotal_cents',subtotal,
  'discount_cents',discount,'tax_cents',tax,
  'total_cents',taxable+tax,'coupon_code',coupon,
  'item_count',jsonb_array_length(items)
 );
END $$;

CREATE OR REPLACE FUNCTION public.checkout_cart(p_pay_with_credit boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
 uid uuid:=auth.uid();
 cid uuid;
 sumry jsonb;
 subtotal bigint;
 discount bigint;
 tax bigint:=0;
 total bigint;
 cust uuid;
 ord uuid;
 inv uuid;
 ordno text;
 invno text;
 order_prefix text:='ORB-';
 invoice_prefix text:='INV-';
 due_days integer:=7;
 r record;
 oi uuid;
 c public.coupons%rowtype;
 coupon text;
 payres jsonb;
 currency_code text;
 currency_count integer;
 is_gift boolean;
 gift_email text;
 strategy text;
 required_base_key text;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
 IF NOT public.account_can_order(uid) THEN RAISE EXCEPTION 'account is not allowed to place new orders'; END IF;

 cid:=public.get_or_create_cart();
 IF NOT EXISTS(SELECT 1 FROM public.shopping_cart_items WHERE cart_id=cid) THEN
  RAISE EXCEPTION 'basket is empty';
 END IF;

 SELECT count(DISTINCT p.currency),min(p.currency)
 INTO currency_count,currency_code
 FROM public.shopping_cart_items i
 JOIN public.products p ON p.id=i.product_id
 WHERE i.cart_id=cid;
 IF currency_count>1 THEN RAISE EXCEPTION 'basket contains products in multiple currencies'; END IF;
 IF currency_code IS NULL THEN RAISE EXCEPTION 'basket currency unavailable'; END IF;

 FOR r IN
  SELECT i.*,p.name,p.slug,p.price_cents,p.currency,p.metadata,p.license_product_key
  FROM public.shopping_cart_items i
  JOIN public.products p ON p.id=i.product_id
  WHERE i.cart_id=cid
 LOOP
  is_gift:=coalesce((r.configuration->>'gift')::boolean,false);
  gift_email:=lower(trim(coalesce(r.configuration->>'gift_recipient_email','')));

  IF is_gift THEN
   IF gift_email='' OR gift_email !~* '^[A-Z0-9._%+\\-]+@[A-Z0-9.\\-]+\\.[A-Z]{2,}$' THEN
    RAISE EXCEPTION 'enter a valid gift recipient email for %',r.name;
   END IF;
  ELSE
   IF NOT coalesce((r.metadata->>'allow_repeat_purchase')::boolean,false)
    AND public.user_has_active_product(uid,r.product_id) THEN
    RAISE EXCEPTION 'you already own active product %',r.name;
   END IF;

   strategy:=lower(coalesce(r.metadata->'license_validation_policy'->>'license_strategy','standalone'));
   IF strategy NOT IN ('standalone','base','component') THEN
    RAISE EXCEPTION 'product % has an unsupported licence strategy: %',r.name,strategy;
   END IF;

   IF strategy='component' THEN
    required_base_key:=lower(trim(coalesce(r.metadata->'license_validation_policy'->>'base_product_key','')));
    IF required_base_key='' THEN
     RAISE EXCEPTION 'product % has a component licence strategy but no base_product_key policy',r.name;
    END IF;

    IF NOT EXISTS(
     SELECT 1
     FROM public.shopping_cart_items base_item
     JOIN public.products base_product ON base_product.id=base_item.product_id
     WHERE base_item.cart_id=cid
      AND NOT coalesce((base_item.configuration->>'gift')::boolean,false)
      AND (
       lower(coalesce(base_product.license_product_key,''))=required_base_key
       OR lower(coalesce(base_product.slug,''))=required_base_key
      )
    ) AND NOT EXISTS(
     SELECT 1
     FROM public.products base_product
     WHERE (
       lower(coalesce(base_product.license_product_key,''))=required_base_key
       OR lower(coalesce(base_product.slug,''))=required_base_key
      )
      AND public.user_has_active_product(uid,base_product.id)
    ) THEN
     RAISE EXCEPTION '% requires an active % licence. Add that product to the basket or activate it first.',r.name,required_base_key;
    END IF;
   END IF;

   IF EXISTS(
    SELECT 1
    FROM public.invoices x
    JOIN public.order_items xoi ON xoi.order_id=x.order_id
    WHERE x.auth_user_id=uid
     AND xoi.product_id=r.product_id
     AND x.status IN ('unpaid','partial','overdue')
   ) THEN
    RAISE EXCEPTION 'an unpaid invoice already exists for %',r.name;
   END IF;
  END IF;
 END LOOP;

 sumry:=public.cart_summary();
 subtotal:=(sumry->>'subtotal_cents')::bigint;
 discount:=(sumry->>'discount_cents')::bigint;
 tax:=coalesce((sumry->>'tax_cents')::bigint,0);
 total:=(sumry->>'total_cents')::bigint;
 coupon:=sumry->>'coupon_code';

 SELECT coalesce((SELECT (value#>>'{}')::int FROM public.app_settings WHERE key='invoice.due_days'),7)
 INTO due_days;
 SELECT coalesce((SELECT trim(both '"' from value::text) FROM public.app_settings WHERE key='billing.order_prefix'),'ORB-')
 INTO order_prefix;
 SELECT coalesce((SELECT trim(both '"' from value::text) FROM public.app_settings WHERE key='invoice.prefix'),'INV-')
 INTO invoice_prefix;
 SELECT id INTO cust FROM public.customers WHERE auth_user_id=uid LIMIT 1;

 ordno:=order_prefix||lpad(nextval('public.order_number_seq')::text,6,'0');
 INSERT INTO public.orders(
  order_number,customer_id,auth_user_id,status,payment_status,fulfillment_status,
  subtotal_cents,tax_cents,total_cents,currency,metadata
 ) VALUES(
  ordno,cust,uid,
  CASE WHEN total=0 THEN 'active' ELSE 'pending_payment' END,
  CASE WHEN total=0 THEN 'paid_free' ELSE 'unpaid' END,
  'pending',subtotal,tax,total,currency_code,
  jsonb_build_object(
   'basket_checkout',true,'coupon_code',coupon,
   'contains_gifts',EXISTS(
    SELECT 1 FROM public.shopping_cart_items i
    WHERE i.cart_id=cid AND coalesce((i.configuration->>'gift')::boolean,false)
   )
  )
 ) RETURNING id INTO ord;

 invno:=invoice_prefix||lpad(nextval('public.invoice_number_seq')::text,6,'0');
 INSERT INTO public.invoices(
  invoice_number,order_id,auth_user_id,status,subtotal_cents,discount_cents,
  tax_cents,total_cents,paid_cents,currency,due_at,paid_at
 ) VALUES(
  invno,ord,uid,CASE WHEN total=0 THEN 'paid' ELSE 'unpaid' END,
  subtotal,discount,tax,total,0,currency_code,
  CASE WHEN total=0 THEN now() ELSE now()+make_interval(days=>due_days) END,
  CASE WHEN total=0 THEN now() ELSE NULL END
 ) RETURNING id INTO inv;

 FOR r IN
  SELECT i.*,p.name,p.slug,p.price_cents,p.license_product_key,p.metadata
  FROM public.shopping_cart_items i
  JOIN public.products p ON p.id=i.product_id
  WHERE i.cart_id=cid
  ORDER BY CASE
   WHEN lower(coalesce(p.metadata->'license_validation_policy'->>'license_strategy','standalone'))='base' THEN 0
   ELSE 1
  END,p.name
 LOOP
  INSERT INTO public.order_items(
   order_id,product_id,product_name,product_slug,license_product_key,
   quantity,unit_price_cents,total_cents,configuration,service_status
  ) VALUES(
   ord,r.product_id,r.name,r.slug,r.license_product_key,r.quantity,
   coalesce(r.price_cents,0),coalesce(r.price_cents,0)*r.quantity,r.configuration,
   CASE WHEN coalesce((r.configuration->>'gift')::boolean,false) THEN 'pending_gift' ELSE 'pending' END
  ) RETURNING id INTO oi;

  INSERT INTO public.invoice_items(
   invoice_id,order_item_id,description,quantity,unit_price_cents,total_cents
  ) VALUES(inv,oi,r.name,r.quantity,coalesce(r.price_cents,0),coalesce(r.price_cents,0)*r.quantity);

  IF coalesce((r.configuration->>'gift')::boolean,false) THEN
   INSERT INTO public.gift_deliveries(
    source_order_id,source_order_item_id,purchaser_user_id,recipient_email,status,metadata
   ) VALUES(
    ord,oi,uid,lower(trim(r.configuration->>'gift_recipient_email')),'pending',
    jsonb_build_object('product_id',r.product_id,'product_name',r.name)
   ) ON CONFLICT(source_order_item_id) DO NOTHING;
  END IF;
 END LOOP;

 IF coupon IS NOT NULL THEN
  SELECT * INTO c FROM public.coupons WHERE lower(code)=lower(coupon) LIMIT 1;
  IF c.id IS NOT NULL THEN
   INSERT INTO public.coupon_redemptions(coupon_id,invoice_id,auth_user_id,discount_cents)
   VALUES(c.id,inv,uid,discount);
  END IF;
 END IF;

 DELETE FROM public.shopping_cart_items WHERE cart_id=cid;
 UPDATE public.shopping_carts SET coupon_code=NULL,updated_at=now() WHERE id=cid;

 IF total=0 THEN
  PERFORM public.grant_paid_order_entitlements(ord,uid);
 ELSIF p_pay_with_credit OR coalesce((
  SELECT (value#>>'{}')::boolean FROM public.app_settings WHERE key='billing.auto_apply_credit'
 ),false) THEN
  payres:=public.pay_invoice_with_credit(inv);
 END IF;

 RETURN jsonb_build_object(
  'order_id',ord,'order_number',ordno,'invoice_id',inv,'invoice_number',invno,
  'subtotal_cents',subtotal,'discount_cents',discount,'tax_cents',tax,
  'total_cents',total,'currency',currency_code,
  'paid',total=0 OR coalesce(payres->>'status','')='paid',
  'contains_gifts',EXISTS(
   SELECT 1 FROM public.gift_deliveries WHERE source_order_id=ord
  )
 );
END $$;
