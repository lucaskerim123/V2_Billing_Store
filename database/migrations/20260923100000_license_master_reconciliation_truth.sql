-- Keep License Master state truthful: Billing Store records the desired state locally and
-- only changes remote_state after the License Master connector confirms the mutation.

create or replace function public.admin_order_service_action(
  p_order_id uuid,
  p_action text,
  p_reason text default null,
  p_reissue_license boolean default true,
  p_suspend_until timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o public.orders%rowtype;
begin
  if p_action not in ('activate','reprovision','suspend','unsuspend','terminate') then raise exception 'invalid service action'; end if;
  if p_action in ('activate','reprovision') and not public.has_permission('orders.activate') then raise exception 'permission denied'; end if;
  if p_action in ('suspend','unsuspend') and not public.has_permission('orders.suspend') then raise exception 'permission denied'; end if;
  if p_action='terminate' and not public.has_permission('orders.terminate') then raise exception 'permission denied'; end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'order not found'; end if;

  if p_action in ('activate','reprovision') then
    if o.payment_status not like 'paid%' then raise exception 'order must be paid before activation'; end if;
    update public.orders set status='active',fulfillment_status='pending',updated_at=now() where id=o.id;
    update public.license_bindings
      set desired_state='active',
          remote_state=case when api_source='website' then 'active' else remote_state end,
          archived_at=null,
          suspension_reason=null,
          updated_at=now()
      where order_id=o.id and desired_state<>'revoked';
    if p_reissue_license or p_action='reprovision' then
      perform public.grant_paid_order_entitlements(o.id,o.auth_user_id);
    else
      update public.order_items set service_status='active' where order_id=o.id;
    end if;
  elsif p_action='suspend' then
    if coalesce(btrim(p_reason),'')='' then raise exception 'suspension reason required'; end if;
    update public.orders
      set status='suspended',
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('suspended_at',now(),'suspension_reason',p_reason,'suspension_until',p_suspend_until),
          updated_at=now()
      where id=o.id;
    update public.order_items set service_status='suspended' where order_id=o.id;
    update public.license_bindings
      set desired_state='suspended',
          remote_state=case when api_source='website' then 'suspended' else remote_state end,
          suspension_reason=p_reason,
          updated_at=now()
      where order_id=o.id and archived_at is null;
  elsif p_action='unsuspend' then
    update public.orders
      set status='active',
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('suspended_at',null,'suspension_reason',null,'suspension_until',null),
          updated_at=now()
      where id=o.id;
    update public.order_items set service_status='active' where order_id=o.id;
    update public.license_bindings
      set desired_state='active',
          remote_state=case when api_source='website' then 'active' else remote_state end,
          suspension_reason=null,
          updated_at=now()
      where order_id=o.id and archived_at is null;
  elsif p_action='terminate' then
    if coalesce(btrim(p_reason),'')='' then raise exception 'termination reason required'; end if;
    update public.orders
      set status='terminated',
          fulfillment_status='terminated',
          terminated_at=coalesce(terminated_at,now()),
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('terminated_at',now(),'termination_reason',p_reason,'recurring_enabled',false),
          updated_at=now()
      where id=o.id;
    update public.order_items set service_status='terminated' where order_id=o.id;
    update public.invoices
      set status='cancelled',
          notes=concat_ws(E'\\n',notes,'Order terminated: '||p_reason),
          updated_at=now()
      where order_id=o.id and status in ('unpaid','partial','overdue');
    update public.license_bindings
      set desired_state='revoked',
          remote_state=case when api_source='website' then 'revoked' else remote_state end,
          archived_at=now(),
          suspension_reason=p_reason,
          updated_at=now()
      where order_id=o.id and archived_at is null;
    update public.download_entitlements
      set status='revoked',
          revoked_at=now(),
          reason='Order terminated: '||p_reason
      where order_id=o.id and status='active';
    update public.license_enforcement_queue
      set state='cancelled',
          last_error='Order terminated before queued action completed',
          finished_at=coalesce(finished_at,now())
      where binding_id in(select id from public.license_bindings where order_id=o.id) and state in ('queued','running');
  end if;

  perform public.sync_order_service_status(o.id);
  perform public.bump_license_revision();
  insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
  values(auth.uid(),'order.service.'||p_action,'order',o.id::text,jsonb_build_object('reason',p_reason,'reissue_license',p_reissue_license,'suspend_until',p_suspend_until));
  return jsonb_build_object('ok',true,'action',p_action,'order_id',o.id);
end
$function$;

create or replace function public.process_due_order_cancellations()
returns integer
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  r record;
  n int:=0;
  why text;
begin
  for r in
    select * from public.order_cancellation_requests
    where status='approved_scheduled' and scheduled_for<=now()
    order by scheduled_for
    for update skip locked
  loop
    why:=coalesce(nullif(btrim(r.staff_note),''),'Customer cancellation effective at end of billing cycle');
    update public.orders
      set status='terminated',
          fulfillment_status='terminated',
          terminated_at=coalesce(terminated_at,now()),
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('terminated_at',now(),'termination_reason',why,'recurring_enabled',false,'cancellation_status','completed','cancellation_completed_at',now()),
          updated_at=now()
      where id=r.order_id and status<>'terminated';
    update public.order_items set service_status='terminated' where order_id=r.order_id;
    update public.invoices
      set status='cancelled',
          notes=concat_ws(E'\\n',notes,'Order terminated: '||why),
          updated_at=now()
      where order_id=r.order_id and status in ('unpaid','partial','overdue');
    update public.license_bindings
      set desired_state='revoked',
          remote_state=case when api_source='website' then 'revoked' else remote_state end,
          archived_at=coalesce(archived_at,now()),
          suspension_reason=why,
          updated_at=now()
      where order_id=r.order_id and archived_at is null;
    update public.download_entitlements
      set status='revoked',revoked_at=now(),reason='Order terminated: '||why
      where order_id=r.order_id and status='active';
    update public.license_enforcement_queue
      set state='cancelled',last_error='Order terminated before queued action completed',finished_at=coalesce(finished_at,now())
      where binding_id in(select id from public.license_bindings where order_id=r.order_id) and state in ('queued','running');
    update public.payment_subscriptions
      set cancel_at_period_end=true,status='cancelled',next_charge_at=null,updated_at=now()
      where order_id=r.order_id and coalesce(status,'') not in ('cancelled','canceled','terminated','ended');
    perform public.sync_order_service_status(r.order_id);
    perform public.bump_license_revision();
    update public.order_cancellation_requests set status='completed',processed_at=now(),updated_at=now() where id=r.id;
    insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
      values(null,'order.cancellation.auto_terminated','order',r.order_id::text,jsonb_build_object('request_id',r.id,'scheduled_for',r.scheduled_for));
    n:=n+1;
  end loop;
  return n;
end
$function$;
