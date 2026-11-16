-- Permission-checked, audited invoice/order linking.
create or replace function public.admin_link_invoice_order(
  p_invoice_id uuid,
  p_order_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  inv public.invoices%rowtype;
  ord public.orders%rowtype;
  previous_order_id uuid;
begin
  if not public.has_permission('invoices.edit') and not public.has_permission('orders.edit') then
    raise exception 'permission denied: invoices.edit or orders.edit';
  end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception 'a reason is required to change invoice/order linkage';
  end if;

  select * into inv from public.invoices where id=p_invoice_id for update;
  if not found then raise exception 'invoice not found'; end if;
  previous_order_id:=inv.order_id;

  if p_order_id is not null then
    select * into ord from public.orders where id=p_order_id for update;
    if not found then raise exception 'order not found'; end if;
    if inv.auth_user_id is distinct from ord.auth_user_id then
      raise exception 'invoice and order must belong to the same customer';
    end if;
    if upper(coalesce(inv.currency,'AUD'))<>upper(coalesce(ord.currency,'AUD')) then
      raise exception 'invoice and order currencies must match';
    end if;
    if previous_order_id is not null and previous_order_id<>p_order_id then
      raise exception 'invoice is already linked to another order; unlink it first';
    end if;
    if exists(
      select 1 from public.invoice_items ii
      join public.order_items oi on oi.id=ii.order_item_id
      where ii.invoice_id=p_invoice_id and oi.order_id<>p_order_id
    ) then
      raise exception 'invoice lines reference a different order';
    end if;
  else
    if exists(select 1 from public.invoice_items where invoice_id=p_invoice_id and order_item_id is not null) then
      raise exception 'invoice contains order-linked line items and cannot be detached';
    end if;
  end if;

  update public.invoices
     set order_id=p_order_id,updated_at=now()
   where id=p_invoice_id;

  insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
  values(auth.uid(),
    case when p_order_id is null then 'invoice.order_unlinked' else 'invoice.order_linked' end,
    'invoice',p_invoice_id::text,
    jsonb_build_object(
      'invoice_id',p_invoice_id,
      'invoice_number',inv.invoice_number,
      'previous_order_id',previous_order_id,
      'order_id',p_order_id,
      'reason',trim(p_reason)
    )
  );

  if previous_order_id is not null then
    insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
    values(auth.uid(),'order.invoice_link_changed','order',previous_order_id::text,
      jsonb_build_object('invoice_id',p_invoice_id,'invoice_number',inv.invoice_number,'new_order_id',p_order_id,'reason',trim(p_reason)));
  end if;
  if p_order_id is not null and p_order_id is distinct from previous_order_id then
    insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
    values(auth.uid(),'order.invoice_linked','order',p_order_id::text,
      jsonb_build_object('invoice_id',p_invoice_id,'invoice_number',inv.invoice_number,'previous_order_id',previous_order_id,'reason',trim(p_reason)));
  end if;

  return jsonb_build_object('ok',true,'invoice_id',p_invoice_id,'previous_order_id',previous_order_id,'order_id',p_order_id);
end
$function$;

revoke all on function public.admin_link_invoice_order(uuid,uuid,text) from anon;
grant execute on function public.admin_link_invoice_order(uuid,uuid,text) to authenticated;
