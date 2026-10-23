-- Align payments/refunds operational routing to existing invoices.view capability.
create or replace function public.orbitfs_invoice_payment_notification_trigger() returns trigger language plpgsql security definer set search_path='public' as $$
begin
 if new.status='failed' and (TG_OP='INSERT' or old.status is distinct from new.status) then perform public.orbitfs_notify_transaction(new.auth_user_id,'payment.failed','Payment failed','An invoice payment attempt failed.','warning','invoice_payment',new.id,'/portal/invoices','/admin/invoices','invoices.view');end if;
 return new;exception when others then raise warning 'OrbitFS payment notification failed: %',sqlerrm;return new;end $$;
create or replace function public.orbitfs_refund_notification_trigger() returns trigger language plpgsql security definer set search_path='public' as $$
begin
 if new.status in ('completed','succeeded','refunded') and (TG_OP='INSERT' or old.status is distinct from new.status) then perform public.orbitfs_notify_transaction(new.auth_user_id,'invoice.refund','Refund completed','An invoice refund has been completed.','success','invoice_refund',new.id,'/portal/invoices','/admin/invoices','invoices.view');end if;
 return new;exception when others then raise warning 'OrbitFS refund notification failed: %',sqlerrm;return new;end $$;