-- Make the global Support lifecycle settings operational.
-- Department auto_close_hours overrides the global support.auto_close_days value.

create or replace function public.process_support_auto_close() returns jsonb
language plpgsql security definer set search_path='public' as $$
declare r record; closed_count integer:=0; global_days integer:=14;
begin
  select coalesce((value #>> '{}')::integer,14) into global_days
    from public.app_settings where key='support.auto_close_days';
  global_days:=greatest(0,coalesce(global_days,14));

  for r in
    select t.id,t.ticket_number,t.user_id,
           coalesce(d.auto_close_hours,global_days*24) as effective_auto_close_hours
    from public.support_tickets t
    join public.support_departments d on d.id=t.department_id
    where d.enabled=true
      and coalesce(d.auto_close_hours,global_days*24)>0
      and t.archived_at is null
      and t.status='customer_reply'
      and t.last_staff_reply_at is not null
      and t.last_staff_reply_at <= now() - make_interval(hours=>coalesce(d.auto_close_hours,global_days*24))
      and (t.last_client_reply_at is null or t.last_client_reply_at<=t.last_staff_reply_at)
    order by t.last_staff_reply_at
    for update of t skip locked
  loop
    update public.support_tickets
       set status='closed',closed_at=now(),closed_by=null,updated_at=now()
     where id=r.id and status='customer_reply';
    if found then
      perform public.support_emit_system_message(r.id,'auto_closed','{}'::jsonb);
      insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail)
      values(r.id,null,'auto_closed',jsonb_build_object('auto_close_hours',r.effective_auto_close_hours,'ticket_number',r.ticket_number));
      closed_count:=closed_count+1;
    end if;
  end loop;
  return jsonb_build_object('ok',true,'closed_count',closed_count,'processed_at',now(),'global_auto_close_days',global_days);
end $$;
