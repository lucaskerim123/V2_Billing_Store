create or replace function public.orbitfs_notify_transaction(p_user uuid,p_event text,p_title text,p_message text,p_severity text,p_source_type text,p_source_id uuid,p_portal_url text,p_admin_url text,p_admin_permission text default null) returns void language plpgsql security definer set search_path='public' as $$
declare staff record;begin
 if p_user is not null then perform public.notification_emit(p_user,'portal','billing',p_event,p_title,p_message,p_severity,null,p_source_type,p_source_id::text,p_portal_url,'{"transactional":true}'::jsonb,p_event||':'||p_source_id::text);end if;
 for staff in select distinct sm.user_id from public.staff_members sm join public.staff_member_groups mg on mg.user_id=sm.user_id join public.staff_groups g on g.id=mg.group_id where sm.status='active' and (g.slug='superadmin' or (p_admin_permission is not null and coalesce((g.permissions->>p_admin_permission)::boolean,false))) loop
 perform public.notification_emit(staff.user_id,'admin','operations',p_event,p_title,p_message,p_severity,null,p_source_type,p_source_id::text,p_admin_url,'{"transactional":true}'::jsonb,p_event||':'||p_source_id::text);end loop;
end $$;
revoke all on function public.orbitfs_notify_transaction(uuid,text,text,text,text,text,uuid,text,text,text) from public,anon,authenticated;
create or replace function public.orbitfs_order_notification_trigger() returns trigger language plpgsql security definer set search_path='public' as $$
declare label text;begin
 label:=coalesce(new.order_number,new.id::text);
 if TG_OP='INSERT' then
  perform public.orbitfs_notify_transaction(new.auth_user_id,'order.created','New order '||label,'Order submitted successfully.','info','order',new.id,'/portal/orders','/admin/orders/'||new.id,'orders.view');
 else
  if old.payment_status is distinct from new.payment_status then
   if lower(coalesce(new.payment_status,'')) in ('paid','succeeded','completed') then
    perform public.orbitfs_notify_transaction(new.auth_user_id,'order.paid','Order payment received','Payment recorded for order '||label,'success','order',new.id,'/portal/orders','/admin/orders/'||new.id,'orders.view');
   elsif lower(coalesce(new.payment_status,'')) in ('failed','declined') then
    perform public.orbitfs_notify_transaction(new.auth_user_id,'order.payment_failed','Order payment failed','Payment failed for order '||label,'warning','order',new.id,'/portal/orders','/admin/orders/'||new.id,'orders.view');
   end if;
  end if;
  if old.status is distinct from new.status and lower(coalesce(new.status,'')) in ('cancelled','canceled') then
   perform public.orbitfs_notify_transaction(new.auth_user_id,'order.cancelled','Order cancelled','Order '||label||' was cancelled.','info','order',new.id,'/portal/orders','/admin/orders/'||new.id,'orders.view');
  end if;
 end if;
 return new;
exception when others then raise warning 'OrbitFS order notification failed for %: %',new.id,sqlerrm;return new;end $$;
drop trigger if exists orbitfs_order_notification on public.orders;
create trigger orbitfs_order_notification after insert or update of status,payment_status on public.orders for each row execute function public.orbitfs_order_notification_trigger();
create or replace function public.orbitfs_invoice_notification_trigger() returns trigger language plpgsql security definer set search_path='public' as $$
declare label text;begin
 label:=coalesce(new.invoice_number,new.id::text);
 if TG_OP='INSERT' then
  perform public.orbitfs_notify_transaction(new.auth_user_id,'invoice.created','New invoice '||label,'An invoice has been issued.','info','invoice',new.id,'/portal/invoices/'||new.id,'/admin/invoices/'||new.id,'invoices.view');
 else
  if old.status is distinct from new.status then
   if new.status='paid' then
    perform public.orbitfs_notify_transaction(new.auth_user_id,'invoice.paid','Invoice paid','Payment confirmed for invoice '||label,'success','invoice',new.id,'/portal/invoices/'||new.id,'/admin/invoices/'||new.id,'invoices.view');
   elsif new.status='overdue' then
    perform public.orbitfs_notify_transaction(new.auth_user_id,'invoice.overdue','Invoice overdue','Invoice '||label||' requires payment.','warning','invoice',new.id,'/portal/invoices/'||new.id,'/admin/invoices/'||new.id,'invoices.view');
   elsif new.status in ('cancelled','canceled') then
    perform public.orbitfs_notify_transaction(new.auth_user_id,'invoice.cancelled','Invoice cancelled','Invoice '||label||' has been cancelled.','info','invoice',new.id,'/portal/invoices/'||new.id,'/admin/invoices/'||new.id,'invoices.view');
   end if;
  end if;
 end if;
 return new;
exception when others then raise warning 'OrbitFS invoice notification failed for %: %',new.id,sqlerrm;return new;end $$;
drop trigger if exists orbitfs_invoice_notification on public.invoices;
create trigger orbitfs_invoice_notification after insert or update of status on public.invoices for each row execute function public.orbitfs_invoice_notification_trigger();
create or replace function public.orbitfs_invoice_payment_notification_trigger() returns trigger language plpgsql security definer set search_path='public' as $$
begin
 if new.status='failed' and (TG_OP='INSERT' or old.status is distinct from new.status) then
  perform public.orbitfs_notify_transaction(new.auth_user_id,'payment.failed','Payment failed','An invoice payment attempt failed.','warning','invoice_payment',new.id,'/portal/invoices','/admin/invoices','billing.view');
 end if;
 return new;
exception when others then raise warning 'OrbitFS payment notification failed: %',sqlerrm;return new;end $$;
drop trigger if exists orbitfs_invoice_payment_notification on public.invoice_payments;
create trigger orbitfs_invoice_payment_notification after insert or update of status on public.invoice_payments for each row execute function public.orbitfs_invoice_payment_notification_trigger();
create or replace function public.orbitfs_refund_notification_trigger() returns trigger language plpgsql security definer set search_path='public' as $$
begin
 if new.status in ('completed','succeeded','refunded') and (TG_OP='INSERT' or old.status is distinct from new.status) then
  perform public.orbitfs_notify_transaction(new.auth_user_id,'invoice.refund','Refund completed','An invoice refund has been completed.','success','invoice_refund',new.id,'/portal/invoices','/admin/invoices','billing.view');
 end if;
 return new;
exception when others then raise warning 'OrbitFS refund notification failed: %',sqlerrm;return new;end $$;
drop trigger if exists orbitfs_refund_notification on public.invoice_refunds;
create trigger orbitfs_refund_notification after insert or update of status on public.invoice_refunds for each row execute function public.orbitfs_refund_notification_trigger();