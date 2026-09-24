-- Wire Billing Store Support settings into the customer-facing RPC layer.
-- Staff operations remain available for recovery even if customer intake is disabled.

create or replace function public.create_support_ticket(
  p_department_id uuid,
  p_subject text,
  p_priority text,
  p_body text,
  p_related_order_id uuid default null
) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare
  uid uuid:=auth.uid();
  tid uuid;
  num bigint;
  mid uuid;
  support_enabled boolean:=true;
  customer_priority_enabled boolean:=true;
  default_priority text:='normal';
  effective_priority text;
begin
  if uid is null then raise exception 'authentication required'; end if;
  select coalesce((value #>> '{}')::boolean,true) into support_enabled from public.app_settings where key='support.enabled';
  if coalesce(support_enabled,true)=false then raise exception 'support is temporarily unavailable'; end if;
  select coalesce((value #>> '{}')::boolean,true) into customer_priority_enabled from public.app_settings where key='support.customer_priority_enabled';
  select coalesce(value #>> '{}','normal') into default_priority from public.app_settings where key='support.default_priority';
  effective_priority:=case when coalesce(customer_priority_enabled,true) then coalesce(p_priority,default_priority) else default_priority end;
  if coalesce(trim(p_subject),'')='' or coalesce(trim(p_body),'')='' then raise exception 'subject and message are required'; end if;
  if effective_priority not in ('low','normal','high','urgent') then raise exception 'invalid priority'; end if;
  if not exists(select 1 from public.support_departments where id=p_department_id and enabled=true and allow_direct_create=true) then
    raise exception 'this department cannot be selected when opening a ticket';
  end if;
  if p_related_order_id is not null and not exists(select 1 from public.orders where id=p_related_order_id and auth_user_id=uid) then
    raise exception 'order not found';
  end if;
  insert into public.support_tickets(user_id,department_id,subject,status,priority,source,related_order_id,last_client_reply_at,last_reply_at)
  values(uid,p_department_id,trim(p_subject),'open',effective_priority,'portal',p_related_order_id,now(),now())
  returning id,ticket_number into tid,num;
  insert into public.support_ticket_messages(ticket_id,author_user_id,author_role,body,internal_note,attachments)
  values(tid,uid,'user',p_body,false,'[]'::jsonb) returning id into mid;
  perform public.support_emit_system_message(tid,'welcome','{}'::jsonb);
  insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail)
  values(tid,uid,'created',jsonb_build_object('priority',effective_priority,'department_id',p_department_id,'message_id',mid));
  return jsonb_build_object('id',tid,'ticket_number',num);
end $$;

create or replace function public.customer_reply_support_ticket(p_ticket_id uuid,p_body text) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare
  t public.support_tickets%rowtype;
  mid uuid;
  was_closed boolean;
  support_enabled boolean:=true;
  allow_reopen boolean:=true;
begin
  select coalesce((value #>> '{}')::boolean,true) into support_enabled from public.app_settings where key='support.enabled';
  if coalesce(support_enabled,true)=false then raise exception 'support is temporarily unavailable'; end if;
  if nullif(btrim(p_body),'') is null then raise exception 'reply is required'; end if;
  select * into t from public.support_tickets where id=p_ticket_id and user_id=auth.uid() for update;
  if not found then raise exception 'ticket not found'; end if;
  was_closed:=t.status='closed';
  if was_closed then
    select coalesce((value #>> '{}')::boolean,true) into allow_reopen from public.app_settings where key='support.allow_reopen';
    if coalesce(allow_reopen,true)=false then raise exception 'closed tickets cannot currently be reopened'; end if;
    update public.support_tickets set status='open',closed_at=null,closed_by=null,reopened_at=now(),updated_at=now() where id=t.id;
    perform public.support_emit_system_message(t.id,'reopened','{}'::jsonb);
    insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail)
    values(t.id,auth.uid(),'customer_reopened','{}'::jsonb);
  end if;
  insert into public.support_ticket_messages(ticket_id,author_user_id,author_role,body,internal_note)
  values(t.id,auth.uid(),'user',p_body,false) returning id into mid;
  update public.support_tickets set status='staff_reply',last_reply_at=now(),last_client_reply_at=now(),updated_at=now() where id=t.id;
  return jsonb_build_object('ok',true,'message_id',mid,'reopened',was_closed,'status','staff_reply');
end $$;

create or replace function public.customer_close_support_ticket(p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare
  t public.support_tickets%rowtype;
  can_close boolean;
  global_can_close boolean:=true;
begin
  select coalesce((value #>> '{}')::boolean,true) into global_can_close from public.app_settings where key='support.customer_can_close';
  if coalesce(global_can_close,true)=false then raise exception 'customer ticket closure is currently disabled'; end if;
  select * into t from public.support_tickets where id=p_ticket_id and user_id=auth.uid() for update;
  if not found then raise exception 'ticket not found'; end if;
  if t.status='closed' then return jsonb_build_object('ok',true,'status','closed'); end if;
  select d.client_can_close into can_close from public.support_departments d where d.id=t.department_id;
  if coalesce(can_close,false)=false then raise exception 'this support department requires staff to close the ticket'; end if;
  update public.support_tickets set status='closed',closed_at=now(),closed_by=auth.uid(),updated_at=now() where id=t.id;
  perform public.support_emit_system_message(t.id,'closing','{}'::jsonb);
  insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail)
  values(t.id,auth.uid(),'customer_closed','{}'::jsonb);
  return jsonb_build_object('ok',true,'status','closed');
end $$;
