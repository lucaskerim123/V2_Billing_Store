-- Invoice trigger owns overdue state; mail-outbox bridge handles due reminders only.
create or replace function public.orbitfs_mail_outbox_notification_trigger() returns trigger
language plpgsql security definer set search_path='public' as $$
declare event_title text;event_message text;event_severity text:='info';permission_key text;portal_link text;admin_link text;
begin
 if new.auth_user_id is null then return new;end if;
 case new.event_key
  when 'service.activated' then event_title:='Service activated';event_message:='Your OrbitFS service is now active.';event_severity:='success';permission_key:='orders.view';
  when 'service.suspended' then event_title:='Service suspended';event_message:='Your OrbitFS service has been suspended.';event_severity:='warning';permission_key:='orders.view';
  when 'service.restored' then event_title:='Service restored';event_message:='Your OrbitFS service has been restored.';event_severity:='success';permission_key:='orders.view';
  when 'service.terminated' then event_title:='Service terminated';event_message:='Your OrbitFS service has been terminated.';event_severity:='error';permission_key:='orders.view';
  when 'invoice.due' then event_title:='Invoice due';event_message:='An OrbitFS invoice requires payment.';event_severity:='warning';permission_key:='invoices.view';
  when 'cancellation.requested' then event_title:='Cancellation requested';event_message:='A cancellation request has been submitted.';permission_key:='orders.view';
  when 'cancellation.scheduled' then event_title:='Cancellation scheduled';event_message:='Your cancellation has been scheduled.';permission_key:='orders.view';
  when 'cancellation.denied' then event_title:='Cancellation request denied';event_message:='Your cancellation request was not approved.';event_severity:='warning';permission_key:='orders.view';
  when 'cancellation.completed' then event_title:='Cancellation completed';event_message:='Your cancellation is complete.';permission_key:='orders.view';
  else return new;
 end case;
 portal_link:=case when new.event_key like 'invoice.%' then '/portal/invoices' else '/portal/orders' end;
 admin_link:=case when new.event_key like 'invoice.%' then '/admin/invoices' else '/admin/orders' end;
 perform public.orbitfs_notify_transaction(new.auth_user_id,new.event_key,event_title,event_message,event_severity,new.related_type,new.id,portal_link,admin_link,permission_key);
 return new;
exception when others then raise warning 'OrbitFS mail-outbox notification failed for %: %',new.event_key,sqlerrm;return new;
end $$;
