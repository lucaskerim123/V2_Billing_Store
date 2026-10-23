create or replace function public.orbitfs_support_customer_reply_notification() returns trigger language plpgsql security definer set search_path='public' as $$
declare recipient uuid;ticket_code text;
begin
 if coalesce(new.internal_note,false) or lower(coalesce(new.author_role,'')) not in ('staff','admin','support','agent') then return new;end if;
 select user_id,ticket_number::text into recipient,ticket_code from public.support_tickets where id=new.ticket_id;
 if recipient is not null then perform public.notification_emit(recipient,'portal','support','support.ticket.staff_reply','Support replied to your ticket','A staff member replied to ticket '||coalesce('#'||ticket_code,'')||'.','info',new.author_user_id,'support_ticket_message',new.id::text,'/portal/support/'||new.ticket_id::text,'{"kind":"notification"}'::jsonb,'support.staff_reply:'||new.id::text);end if;
 return new;
exception when others then raise warning 'OrbitFS customer support notification failed: %',sqlerrm;return new;end $$;
drop trigger if exists orbitfs_support_customer_reply_notification on public.support_ticket_messages;
create trigger orbitfs_support_customer_reply_notification after insert on public.support_ticket_messages for each row execute function public.orbitfs_support_customer_reply_notification();
create or replace function public.orbitfs_credit_notification() returns trigger language plpgsql security definer set search_path='public' as $$
declare is_credit boolean;event_name text;message_text text;
begin
 if lower(coalesce(new.direction,'')) not in ('credit','debit','in','out') then return new;end if;
 is_credit:=lower(new.direction) in ('credit','in');event_name:=case when is_credit then 'wallet.credited' else 'wallet.debited' end;
 message_text:=case when is_credit then 'Credit was added to your OrbitFS wallet.' else 'Credit was deducted from your OrbitFS wallet.' end;
 perform public.orbitfs_notify_transaction(new.user_id,event_name,case when is_credit then 'Wallet credited' else 'Wallet debited' end,message_text,case when is_credit then 'success' else 'info' end,'credit_ledger',new.id,'/portal/settings','/admin/customers','credit.manage');
 return new;
exception when others then raise warning 'OrbitFS wallet notification failed: %',sqlerrm;return new;end $$;
drop trigger if exists orbitfs_credit_notification on public.credit_ledger;
create trigger orbitfs_credit_notification after insert on public.credit_ledger for each row execute function public.orbitfs_credit_notification();
create or replace function public.orbitfs_subscription_notification() returns trigger language plpgsql security definer set search_path='public' as $$
declare value text;title_text text;sev text;
begin
 if TG_OP='UPDATE' and old.status is not distinct from new.status then return new;end if;
 value:=lower(coalesce(new.status,''));
 if value in ('past_due','failed','payment_failed','unpaid') then title_text:='Subscription requires payment';sev:='warning';
 elsif value in ('cancelled','canceled','terminated') then title_text:='Subscription cancelled';sev:='warning';
 elsif value in ('active','renewed') then title_text:='Subscription active';sev:='success';
 else return new;end if;
 perform public.orbitfs_notify_transaction(new.auth_user_id,'subscription.'||value,title_text,'Your subscription status is now '||value||'.',sev,'subscription',new.id,'/portal/settings','/admin/subscriptions','orders.view');
 return new;
exception when others then raise warning 'OrbitFS subscription notification failed: %',sqlerrm;return new;end $$;
drop trigger if exists orbitfs_subscription_notification on public.payment_subscriptions;
create trigger orbitfs_subscription_notification after insert or update of status on public.payment_subscriptions for each row execute function public.orbitfs_subscription_notification();