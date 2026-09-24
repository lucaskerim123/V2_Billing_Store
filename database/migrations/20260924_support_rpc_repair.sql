-- Repair Support RPCs referenced by the current Billing Store UI.
-- These functions existed in the exported application schema but were missing
-- from the ordered migration set, which breaks rebuilt databases.

create or replace function public.admin_archive_support_ticket(
  p_ticket_id uuid,p_reason text default null,p_archive boolean default true
) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare t public.support_tickets%rowtype;
begin
  if not public.has_permission('support.archive') then raise exception 'permission denied: support.archive'; end if;
  select * into t from public.support_tickets where id=p_ticket_id for update;
  if not found then raise exception 'ticket not found'; end if;
  update public.support_tickets
     set archived_at=case when p_archive then now() else null end,
         archived_by=case when p_archive then auth.uid() else null end,
         archive_reason=case when p_archive then p_reason else null end,
         updated_at=now()
   where id=p_ticket_id;
  insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail)
  values(p_ticket_id,auth.uid(),case when p_archive then 'archived' else 'unarchived' end,jsonb_build_object('reason',p_reason));
  insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
  values(auth.uid(),case when p_archive then 'support.archive' else 'support.unarchive' end,'support_ticket',p_ticket_id::text,jsonb_build_object('ticket_number',t.ticket_number,'reason',p_reason));
  return jsonb_build_object('ok',true,'archived',p_archive);
end $$;

create or replace function public.admin_delete_support_ticket(p_ticket_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare t public.support_tickets%rowtype; paths jsonb;
begin
  if not public.has_permission('support.delete') then raise exception 'permission denied: support.delete'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'deletion reason is required'; end if;
  select * into t from public.support_tickets where id=p_ticket_id for update;
  if not found then raise exception 'ticket not found'; end if;
  select coalesce(jsonb_agg(storage_path),'[]'::jsonb) into paths from public.support_attachments where ticket_id=p_ticket_id;
  insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
  values(auth.uid(),'support.delete','support_ticket',p_ticket_id::text,jsonb_build_object('ticket_number',t.ticket_number,'subject',t.subject,'customer_id',t.user_id,'reason',p_reason));
  delete from public.staff_notes where entity_type='support_ticket' and entity_id=p_ticket_id;
  delete from public.support_tickets where id=p_ticket_id;
  return jsonb_build_object('ok',true,'storage_paths',paths);
end $$;

create or replace function public.admin_send_support_system_message(p_ticket_id uuid,p_event_key text) returns jsonb
language plpgsql security definer set search_path='public' as $$
begin
  if not public.has_permission('support.reply') then raise exception 'permission denied: support.reply'; end if;
  if not exists(select 1 from public.support_tickets where id=p_ticket_id) then raise exception 'ticket not found'; end if;
  if not exists(select 1 from public.support_message_templates where event_key=p_event_key and enabled=true) then raise exception 'message template unavailable'; end if;
  perform public.support_emit_system_message(p_ticket_id,p_event_key,'{}'::jsonb);
  insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail)
  values(p_ticket_id,auth.uid(),'manual_system_message',jsonb_build_object('event_key',p_event_key));
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.admin_update_support_ticket_details(
  p_ticket_id uuid,p_subject text,p_related_order_id uuid default null
) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare t public.support_tickets%rowtype;
begin
  if not public.has_permission('support.ticket_edit') then raise exception 'permission denied: support.ticket_edit'; end if;
  select * into t from public.support_tickets where id=p_ticket_id for update;
  if not found then raise exception 'ticket not found'; end if;
  if nullif(btrim(p_subject),'') is null then raise exception 'subject is required'; end if;
  if p_related_order_id is not null and not exists(select 1 from public.orders where id=p_related_order_id and auth_user_id=t.user_id) then
    raise exception 'order does not belong to ticket customer';
  end if;
  update public.support_tickets set subject=p_subject,related_order_id=p_related_order_id,updated_at=now() where id=p_ticket_id;
  insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail)
  values(p_ticket_id,auth.uid(),'ticket_details_changed',jsonb_build_object('subject',p_subject,'related_order_id',p_related_order_id));
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.attach_support_file(
  p_ticket_id uuid,p_message_id uuid,p_file_name text,p_storage_path text,p_mime_type text,p_file_size_bytes bigint
) returns uuid
language plpgsql security definer set search_path='public' as $$
declare uid uuid:=auth.uid(); rid uuid; max_mb bigint:=25;
begin
  if uid is null then raise exception 'authentication required'; end if;
  if not public.is_staff() and not exists(select 1 from public.support_tickets where id=p_ticket_id and user_id=uid) then raise exception 'ticket not found'; end if;
  select coalesce((value #>> '{}')::bigint,25) into max_mb from public.app_settings where key='support.max_attachment_mb';
  max_mb:=coalesce(max_mb,25);
  if p_file_size_bytes is not null and p_file_size_bytes>max_mb*1024*1024 then
    raise exception 'attachment exceeds configured % MB limit',max_mb;
  end if;
  insert into public.support_attachments(ticket_id,message_id,uploader_user_id,file_name,storage_path,mime_type,file_size_bytes)
  values(p_ticket_id,p_message_id,uid,p_file_name,p_storage_path,p_mime_type,p_file_size_bytes)
  returning id into rid;
  return rid;
end $$;

create or replace function public.customer_reply_support_ticket(p_ticket_id uuid,p_body text) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare t public.support_tickets%rowtype; mid uuid; was_closed boolean; enabled boolean:=true;
begin
  select coalesce((value #>> '{}')::boolean,true) into enabled from public.app_settings where key='support.enabled';
  if coalesce(enabled,true)=false then raise exception 'support system is temporarily unavailable'; end if;
  if nullif(btrim(p_body),'') is null then raise exception 'reply is required'; end if;
  select * into t from public.support_tickets where id=p_ticket_id and user_id=auth.uid() for update;
  if not found then raise exception 'ticket not found'; end if;
  was_closed:=t.status='closed';
  if was_closed then
    update public.support_tickets set status='open',closed_at=null,closed_by=null,reopened_at=now(),updated_at=now() where id=t.id;
    perform public.support_emit_system_message(t.id,'reopened','{}'::jsonb);
    insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail) values(t.id,auth.uid(),'customer_reopened','{}'::jsonb);
  end if;
  insert into public.support_ticket_messages(ticket_id,author_user_id,author_role,body,internal_note)
  values(t.id,auth.uid(),'user',p_body,false) returning id into mid;
  update public.support_tickets set status='staff_reply',last_reply_at=now(),last_client_reply_at=now(),updated_at=now() where id=t.id;
  return jsonb_build_object('ok',true,'message_id',mid,'reopened',was_closed,'status','staff_reply');
end $$;

create or replace function public.admin_reply_support_ticket(
  p_ticket_id uuid,p_body text,p_internal boolean default false
) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare mid uuid;
begin
  if not public.has_permission('support.reply') and not public.has_permission('support.manage') then raise exception 'permission denied: support.reply'; end if;
  if nullif(btrim(p_body),'') is null then raise exception 'reply is required'; end if;
  if not exists(select 1 from public.support_tickets where id=p_ticket_id) then raise exception 'ticket not found'; end if;
  insert into public.support_ticket_messages(ticket_id,author_user_id,author_role,body,internal_note)
  values(p_ticket_id,auth.uid(),public.current_role(),p_body,p_internal) returning id into mid;
  if not p_internal then
    update public.support_tickets set status='customer_reply',last_reply_at=now(),last_staff_reply_at=now(),updated_at=now() where id=p_ticket_id;
  end if;
  return jsonb_build_object('ok',true,'message_id',mid,'status',case when p_internal then null else 'customer_reply' end);
end $$;

create or replace function public.admin_reply_and_close_support_ticket(p_ticket_id uuid,p_body text) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare r jsonb;
begin
  if not public.has_permission('support.close') then raise exception 'permission denied: support.close'; end if;
  r:=public.admin_reply_support_ticket(p_ticket_id,p_body,false);
  update public.support_tickets set status='closed',closed_at=now(),closed_by=auth.uid(),updated_at=now() where id=p_ticket_id;
  perform public.support_emit_system_message(p_ticket_id,'closing','{}'::jsonb);
  insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail) values(p_ticket_id,auth.uid(),'staff_closed','{}'::jsonb);
  return r||jsonb_build_object('closed',true,'status','closed');
end $$;
