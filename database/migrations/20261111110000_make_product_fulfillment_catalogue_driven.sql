create or replace function public.grant_paid_order_entitlements_core(p_order_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  fid uuid;
  product_key text;
  found_items integer := 0;
begin
  for r in
    select oi.id, oi.order_id, oi.product_id, oi.license_product_key,
           oi.configuration, oi.quantity
    from public.order_items oi
    where oi.order_id = p_order_id
    order by oi.id
    limit 20
  loop
    if coalesce((r.configuration->>'gift')::boolean, false) then
      continue;
    end if;

    product_key := case lower(coalesce(r.license_product_key, ''))
      when 'orbitfs_panel' then 'orbitfs_base'
      when 'orbitfs_sorter' then 'orbitfs_apex'
      else lower(coalesce(r.license_product_key, ''))
    end;

    -- License Manager owns the product catalogue. Do not restrict Billing
    -- Store fulfilment to OrbitFS-specific product keys.
    if product_key = '' then
      continue;
    end if;

    found_items := found_items + 1;
    select lf.id into fid
    from public.license_fulfillments lf
    where lf.order_item_id = r.id
    limit 1;

    if fid is null then
      insert into public.license_fulfillments
        (order_id, order_item_id, auth_user_id, state, metadata)
      values
        (r.order_id, r.id, p_user_id, 'pending',
         jsonb_build_object(
           'license_product_key', product_key,
           'quantity', greatest(1, coalesce(r.quantity, 1)),
           'authority', 'orbitfs-license-master-v2'
         ))
      returning id into fid;
    else
      update public.license_fulfillments
      set state = case when state = 'fulfilled' then state else 'pending' end,
          last_error = case when state = 'fulfilled' then last_error else null end,
          metadata = coalesce(metadata, '{}'::jsonb) ||
            jsonb_build_object(
              'license_product_key', product_key,
              'quantity', greatest(1, coalesce(r.quantity, 1)),
              'authority', 'orbitfs-license-master-v2'
            ),
          updated_at = now()
      where id = fid;
    end if;
  end loop;

  update public.orders
  set fulfillment_status = case
        when found_items > 0 then 'queued'
        else fulfillment_status
      end,
      updated_at = now()
  where id = p_order_id;
end
$function$;
