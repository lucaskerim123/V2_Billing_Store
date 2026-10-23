-- Customer account lifecycle and staff operational changes.
create or replace function public.orbitfs_customer_notification_trigger() returns trigger language plpgsql security definer set search_path='public' as $$
declare customer_user uuid;label text;begin
 customer_user:=coalesce(new.auth_user_id,new.user_id);
 label:=coalesce(new.display_name,new.name,new.email,'Customer');
 if TG_OP='INSERT' then
   perform public.orbitfs_notify_transaction(customer_user,'customer.created','Account created','Welcome to OrbitFS. Your account is ready.','success','customer',new.id,'/portal','/admin/customers/'||customer_user::text,'customers.view');
 elsif old.status is distinct from new.status then
   if lower(coalesce(new.status,'')) in ('suspended','terminated','active') then
     perform public.orbitfs_notify_transaction(customer_user,'account.'||lower(new.status),'Account '||lower(new.status),'Your OrbitFS account status has changed to '||lower(new.status)||'.','warning','customer',new.id,'/portal/settings','/admin/customers/'||customer_user::text,'customers.view');
   end if;
 end if;
 return new;
exception when others then raise warning 'OrbitFS customer notice failed: %',sqlerrm;return new;end $$;
drop trigger if exists orbitfs_customer_notification on public.customers;
create trigger orbitfs_customer_notification after insert or update of status on public.customers for each row execute function public.orbitfs_customer_notification_trigger();
create or replace function public.orbitfs_staff_change_notification_trigger() returns trigger language plpgsql security definer set search_path='public' as $$
declare manager record; event_name text; message_text text;begin
 if TG_OP='INSERT' then event_name:='staff.invitation.accepted';message_text:='Staff invitation accepted and access enabled.';
 elsif old.status is distinct from new.status then event_name:='staff.access.'||new.status;message_text:='Staff access status changed to '||new.status||'.';
 else return new;end if;
 if new.status='active' then
 perform public.notification_emit(new.user_id,'admin','staff',event_name,'Staff access updated',message_text,'info',null,'staff',new.user_id::text,'/admin/settings/staff/members','{"kind":"notification"}'::jsonb,event_name||':'||new.user_id::text);
 end if;
 for manager in select distinct sm.user_id from public.staff_members sm join public.staff_member_groups mg on mg.user_id=sm.user_id join public.staff_groups g on g.id=mg.group_id where sm.status='active' and (g.slug='superadmin' or coalesce((g.permissions->>'staff.manage')::boolean,false)) loop
 perform public.notification_emit(manager.user_id,'admin','staff',event_name,'Staff access updated',message_text,'info',null,'staff',new.user_id::text,'/admin/settings/staff/members',jsonb_build_object('target_user_id',new.user_id),event_name||':'||new.user_id::text);
 end loop;
 return new;
exception when others then raise warning 'OrbitFS staff notice failed: %',sqlerrm;return new;end $$;
drop trigger if exists orbitfs_staff_change_notification on public.staff_members;
create trigger orbitfs_staff_change_notification after insert or update of status on public.staff_members for each row execute function public.orbitfs_staff_change_notification_trigger();