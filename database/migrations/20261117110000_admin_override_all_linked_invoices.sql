-- Apply admin activation overrides consistently across every linked invoice.
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
  total_overridden bigint := 0;
  linked_invoice_ids uuid[] := '{}';
  overridden_invoice_ids uuid[] := '{}';
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

  for inv in select * from public.invoices where order_id=p_order_id order by created_at desc for update
  loop
    has_invoice:=true;
    linked_invoice_ids:=array_append(linked_invoice_ids,inv.id);
    if inv.status in ('void','cancelled','refunded') then
      continue;
    end if;
    remaining:=greatest(0,coalesce(inv.total_cents,0)-coalesce(inv.paid_cents,0));
    if remaining>0 then
      insert into public.invoice_payments(invoice_id,auth_user_id,method,amount_cents,status,external_reference,metadata)
      values(inv.id,o.auth_user_id,'admin_override',remaining,'completed','ADMIN-OVERRIDE',
        jsonb_build_object('recorded_by',auth.uid(),'reason',p_reason,'bypass',true,'order_activation_override',true));
      total_overridden:=total_overridden+remaining;
      overridden_invoice_ids:=array_append(overridden_invoice_ids,inv.id);
    end if;
    update public.invoices
       set paid_cents=total_cents,status='paid',paid_at=coalesce(paid_at,now()),
           notes=concat_ws(E'\n',notes,'Admin activation override: '||p_reason),updated_at=now()
     where id=inv.id;
  end loop;

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
           'linked_invoice_ids',to_jsonb(linked_invoice_ids),
           'overridden_invoice_ids',to_jsonb(overridden_invoice_ids),
           'fulfillment_mode_pending_review',true
         ),
         updated_at=now()
   where id=o.id;

  perform public.grant_paid_order_entitlements(o.id,o.auth_user_id);

  insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
  values(auth.uid(),'order.force_activate','order',o.id::text,
    jsonb_build_object('invoice_ids',to_jsonb(linked_invoice_ids),
      'overridden_invoice_ids',to_jsonb(overridden_invoice_ids),
      'overridden_cents',total_overridden,'invoice_missing',not has_invoice,
      'reason',p_reason,'activated',true,'payment_status','paid_admin_override'));

  return jsonb_build_object('ok',true,'overridden_cents',total_overridden,
    'invoice_ids',to_jsonb(linked_invoice_ids),
    'overridden_invoice_ids',to_jsonb(overridden_invoice_ids),
    'invoice_missing',not has_invoice,'order_id',o.id,'activated',true,
    'payment_status','paid_admin_override','fulfillment_status','pending');
end
$function$;
revoke all on function public.admin_force_activate_order(uuid,text) from anon;
grant execute on function public.admin_force_activate_order(uuid,text) to authenticated;