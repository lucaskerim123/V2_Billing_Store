-- Allow permissioned administrators to activate orders without requiring an invoice.
-- Invoice-backed overrides create an explicit ADMIN-OVERRIDE payment; invoice-less
-- orders are marked paid_admin_override and audited without fabricating an invoice.

create or replace function public.admin_force_activate_order(p_order_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  o public.orders%rowtype;
  inv public.invoices%rowtype;
  has_invoice boolean := false;
  remaining bigint := 0;
begin
  if not public.has_permission('orders.override_payment') then
    raise exception 'permission denied: orders.override_payment';
  end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception 'override reason is required';
  end if;

  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if o.status in ('terminated','cancelled') then
    raise exception 'terminated/cancelled orders cannot be activated';
  end if;

  select * into inv from public.invoices
   where order_id=p_order_id order by created_at desc limit 1 for update;
  has_invoice := found;

  if has_invoice then
    if inv.status in ('void','cancelled','refunded') then
      raise exception 'void/cancelled/refunded invoice cannot be force activated';
    end if;
    remaining := greatest(0,coalesce(inv.total_cents,0)-coalesce(inv.paid_cents,0));
    if remaining > 0 then
      insert into public.invoice_payments(invoice_id,auth_user_id,method,amount_cents,status,external_reference,metadata)
      values(inv.id,o.auth_user_id,'admin_override',remaining,'completed','ADMIN-OVERRIDE',
        jsonb_build_object('recorded_by',auth.uid(),'reason',p_reason,'bypass',true,'order_activation_override',true));
    end if;
    update public.invoices
       set paid_cents=total_cents,status='paid',paid_at=coalesce(paid_at,now()),
           notes=concat_ws(E'\n',notes,'Admin activation override: '||p_reason),updated_at=now()
     where id=inv.id;
  end if;

  update public.orders
     set payment_status='paid_admin_override',
         status='active',
         fulfillment_status='pending',
         service_status='pending',
         notes=concat_ws(E'\n',notes,'Admin activation override: '||p_reason),
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'approval_state','approved','approval_required',false,'approved_at',now(),
           'approved_by',auth.uid(),'approval_via','payment_override',
           'payment_override_reason',p_reason,'invoice_missing',not has_invoice,
           'fulfillment_mode_pending_review',true
         ),
         updated_at=now()
   where id=o.id;

  perform public.grant_paid_order_entitlements(o.id,o.auth_user_id);

  insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
  values(auth.uid(),'order.force_activate','order',o.id::text,
    jsonb_build_object('invoice_id',case when has_invoice then inv.id else null end,
      'override_cents',remaining,'invoice_missing',not has_invoice,
      'reason',p_reason,'activated',true,'payment_status','paid_admin_override'));

  return jsonb_build_object('ok',true,'overridden_cents',remaining,
    'invoice_id',case when has_invoice then inv.id else null end,
    'invoice_missing',not has_invoice,'order_id',o.id,'activated',true,
    'payment_status','paid_admin_override','fulfillment_status','pending');
end
$function$;

revoke all on function public.admin_force_activate_order(uuid,text) from anon;
grant execute on function public.admin_force_activate_order(uuid,text) to authenticated;
