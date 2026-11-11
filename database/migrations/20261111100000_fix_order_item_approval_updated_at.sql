-- order_items intentionally has no updated_at column.
-- Approval/denial changes service_status only; order-level timestamps remain on orders.

create or replace function public.admin_review_paid_order(
  p_order_id uuid,
  p_decision text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o public.orders%rowtype;
  inv public.invoices%rowtype;
  pay record;
  refunded bigint:=0;
  external_refund bigint:=0;
  bal bigint;
begin
  if not public.has_permission('orders.approve') then raise exception 'permission denied'; end if;
  if p_decision not in ('approve','deny') then raise exception 'decision must be approve or deny'; end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if o.status<>'pending_approval' or o.fulfillment_status<>'pending_approval' then raise exception 'order is not awaiting approval'; end if;
  select * into inv from public.invoices where order_id=o.id and status='paid' order by created_at desc limit 1 for update;
  if not found then raise exception 'paid invoice not found'; end if;

  if p_decision='approve' then
    update public.orders
       set status='active',
           fulfillment_status='pending',
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('approval_state','approved','approved_at',now(),'approved_by',auth.uid()),
           updated_at=now()
     where id=o.id;
    update public.order_items set service_status='pending' where order_id=o.id;
    perform public.grant_paid_order_entitlements(o.id,o.auth_user_id);
    insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
    values(auth.uid(),'order.approval.approve','order',o.id::text,jsonb_build_object('reason',p_reason));
    return jsonb_build_object('ok',true,'decision','approve','order_id',o.id);
  end if;

  if coalesce(btrim(p_reason),'')='' then raise exception 'denial reason required'; end if;
  for pay in
    select * from public.invoice_payments
     where invoice_id=inv.id and status='completed'
     order by created_at
  loop
    if pay.method='account_credit' then
      update public.account_balances
         set available_cents=available_cents+pay.amount_cents,
             lifetime_credit_cents=lifetime_credit_cents+pay.amount_cents,
             updated_at=now()
       where user_id=o.auth_user_id
       returning available_cents into bal;
      insert into public.credit_ledger(user_id,direction,amount_cents,balance_after_cents,reason,reference_type,reference_id,created_by)
      values(o.auth_user_id,'credit',pay.amount_cents,bal,'Refund for denied order','invoice',inv.id::text,auth.uid());
      update public.invoice_payments
         set status='refunded',
             metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('refunded_at',now(),'refund_reason',p_reason,'refunded_by',auth.uid())
       where id=pay.id;
      refunded:=refunded+pay.amount_cents;
    elsif pay.method in ('admin_override','free','coupon') then
      update public.invoice_payments
         set status='refunded',
             metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('refunded_at',now(),'refund_reason',p_reason,'noncash',true)
       where id=pay.id;
    else
      update public.invoice_payments
         set status='refund_pending',
             metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('refund_requested_at',now(),'refund_reason',p_reason,'refund_requested_by',auth.uid())
       where id=pay.id;
      update public.payment_attempts
         set status='refund_pending',
             metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('refund_reason',p_reason,'refund_requested_at',now())
       where invoice_id=inv.id and status='completed' and amount_cents=pay.amount_cents;
      external_refund:=external_refund+pay.amount_cents;
    end if;
  end loop;

  update public.invoices
     set status='refunded',
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('refund_reason',p_reason,'refund_pending_cents',external_refund),
         updated_at=now()
   where id=inv.id;
  update public.orders
     set status='terminated',
         payment_status='refunded',
         fulfillment_status='terminated',
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('approval_state','denied','denied_at',now(),'denied_by',auth.uid(),'denial_reason',p_reason,'refund_pending_cents',external_refund),
         updated_at=now()
   where id=o.id;
  update public.order_items set service_status='terminated' where order_id=o.id;
  insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
  values(auth.uid(),'order.approval.deny','order',o.id::text,jsonb_build_object('reason',p_reason,'refunded_cents',refunded,'refund_pending_cents',external_refund));
  return jsonb_build_object('ok',true,'decision','deny','order_id',o.id,'refunded_cents',refunded,'refund_pending_cents',external_refund);
end
$function$;
