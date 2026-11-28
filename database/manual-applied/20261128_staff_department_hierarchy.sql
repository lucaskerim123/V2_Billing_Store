-- Applied forward migration for confirmed shared Billing Store project.
-- Existing legacy slugs and UUIDs remain stable for old application versions.
-- Customer is the existing non-staff account; no employee assignment is needed.
do $$ begin
 if exists (select 1 from public.staff_member_groups m join public.staff_groups g on g.id=m.group_id where g.slug in ('support','senior-support','admin')) then
  raise exception 'Existing non-executive staff require migration review';
 end if;
 if exists (select 1 from public.staff_invitations where accepted_at is null and revoked_at is null and expires_at>now()) then
  raise exception 'Pending invitations require migration review';
 end if;
end $$;

with base as (select array['admin.access','portal','support.manage','support.claim','support.reply','support.kb.view','support.premade.use','support.escalate']::text[] p),
 desired(slug,name,description,sort_order,capabilities) as (
 select 'support','Customer Service Representative','Support | Tier 1 | Assigned department',90,p from base
 union all select 'customer-service-officer','Customer Service Officer','Support | Tier 2 | Assigned department',80,p||array['support.ticket_create','support.close'] from base
 union all select 'senior-support','Senior Customer Service Officer','Support | Tier 3 | Advanced support in assigned department',70,p||array['support.ticket_create','support.close','support.priority','support.ticket_edit'] from base
 union all select 'customer-service-supervisor','Customer Service Supervisor','Supervision Team | Supervisor of assigned department',60,p||array['support.ticket_create','support.close','support.priority','support.ticket_edit','support.assign','support.transfer','support.escalation.manage'] from base
 union all select 'customer-service-manager','Customer Service Manager','Supervision Team | Manager of assigned department',50,p||array['support.ticket_create','support.close','support.priority','support.ticket_edit','support.assign','support.transfer','support.escalation.manage','support.department'] from base
 union all select 'operations-manager','Operations Manager','Management | Cross-department operational oversight',40,p||array['support.ticket_create','support.close','support.priority','support.ticket_edit','support.assign','support.transfer','support.escalation.manage','support.department','analytics.view'] from base
 union all select 'admin','Senior Customer Service Manager','Management | All departments and operations managers',30,p||array['support.ticket_create','support.close','support.priority','support.ticket_edit','support.assign','support.transfer','support.escalation.manage','support.department','analytics.view','staff.view','staff.groups.view'] from base
 union all select 'developer','Developer','Executive | Technical diagnostics and integrations',20,array['admin.access','integrations.view'] from base
 )
insert into public.staff_groups(slug,name,description,sort_order,permissions,is_system)
select slug,name,description,sort_order,(select jsonb_object_agg(k,true) from unnest(capabilities) k),true from desired
on conflict(slug) do update set name=excluded.name,description=excluded.description,sort_order=excluded.sort_order,permissions=excluded.permissions,is_system=true,updated_at=now();
update public.staff_groups set name='Chief Executive Officer',description='Executive | Highest executive and administrative authority',sort_order=10,updated_at=now() where slug='superadmin';

alter table public.support_department_staff add column if not exists position_rank integer check(position_rank between 1 and 5);
comment on column public.support_department_staff.position_rank is 'Department-specific rank 1-5; NULL uses lowest eligible scoped group for legacy assignments.';
create or replace function public.staff_group_rank(p_slug text) returns integer language sql immutable set search_path=pg_catalog as $$
 select case p_slug when 'support' then 1 when 'customer-service-officer' then 2 when 'senior-support' then 3 when 'customer-service-supervisor' then 4 when 'customer-service-manager' then 5 when 'operations-manager' then 6 when 'admin' then 7 when 'developer' then 8 when 'superadmin' then 9 else 0 end
$$;
create or replace function public.staff_department_rank(p_user_id uuid,p_department_id uuid) returns integer
language sql stable security definer set search_path=public as $$
 with ranks as (
  select public.staff_group_rank(g.slug) r from public.staff_members sm join public.staff_member_groups m on m.user_id=sm.user_id join public.staff_groups g on g.id=m.group_id
  where sm.user_id=p_user_id and sm.status='active'
 ), scoped as (select min(r) r from ranks where r between 1 and 5),
 global_rank as (select coalesce(max(r),0) r from ranks where r in (6,7,9))
 select case when (select r from global_rank)>0 then (select r from global_rank)
 else coalesce((select case when ds.position_rank is null then (select r from scoped) when exists(select 1 from ranks where r=ds.position_rank) then ds.position_rank else 0 end
 from public.support_department_staff ds where ds.user_id=p_user_id and ds.department_id=p_department_id),0) end
$$;
create or replace function public.support_legacy_rank(p_rank integer) returns integer language sql immutable set search_path=pg_catalog as $$
 select case when p_rank=9 then 4 when p_rank between 4 and 7 then 3 when p_rank=3 then 2 when p_rank in (1,2) then 1 else 0 end
$$;
-- Global legacy rank stays compatible; scoped ranks must not activate old global bypasses.
create or replace function public.support_staff_rank(p_user_id uuid default auth.uid()) returns integer
language sql stable security definer set search_path=public as $$
 select coalesce(max(case when g.slug='superadmin' then 4 when g.slug in ('admin','operations-manager') then 3 when public.staff_group_rank(g.slug) between 3 and 5 then 2 when public.staff_group_rank(g.slug) between 1 and 2 then 1 else 0 end),0)
 from public.staff_members sm join public.staff_member_groups m on m.user_id=sm.user_id join public.staff_groups g on g.id=m.group_id where sm.user_id=p_user_id and sm.status='active'
$$;
create or replace function public.support_user_has_department(p_user_id uuid,p_department_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.support_departments d where d.id=p_department_id and d.enabled and public.support_legacy_rank(public.staff_department_rank(p_user_id,d.id))>=d.min_support_rank)
$$;
create or replace function public.support_staff_can_access_ticket(p_ticket_id uuid,p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.support_tickets t where t.id=p_ticket_id and
 public.support_user_has_department(p_user_id,t.department_id)
 and public.support_legacy_rank(public.staff_department_rank(p_user_id,t.department_id))>t.escalation_level)
$$;
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.staff_members where user_id=auth.uid() and status='active')
$$;
-- Only permission administrators may explicitly assign ranks. A rank must match an existing group.
create or replace function public.admin_set_staff_department_position(p_user_id uuid,p_department_id uuid,p_position_rank integer) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not public.has_permission('settings.permissions') then raise exception 'Permission denied'; end if;
 if p_position_rank is null or p_position_rank not between 1 and 5 then raise exception 'Invalid department position'; end if;
 if not exists(select 1 from public.staff_members sm join public.staff_member_groups m on m.user_id=sm.user_id join public.staff_groups g on g.id=m.group_id where sm.user_id=p_user_id and sm.status='active' and public.staff_group_rank(g.slug)=p_position_rank) then raise exception 'Assign the matching staff group first'; end if;
 if not exists(select 1 from public.support_departments d where d.id=p_department_id and d.enabled and d.min_support_rank<=public.support_legacy_rank(p_position_rank)) then raise exception 'Invalid department or minimum tier not met'; end if;
 insert into public.support_department_staff(user_id,department_id,position_rank,created_by) values(p_user_id,p_department_id,p_position_rank,auth.uid())
 on conflict(department_id,user_id) do update set position_rank=excluded.position_rank;
 insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail) values(auth.uid(),'staff.department_position_updated','staff_member',p_user_id::text,jsonb_build_object('department_id',p_department_id,'position_rank',p_position_rank));
 return jsonb_build_object('ok',true,'department_id',p_department_id,'position_rank',p_position_rank);
end $$;
revoke all on function public.admin_set_staff_department_position(uuid,uuid,integer) from public,anon;
grant execute on function public.admin_set_staff_department_position(uuid,uuid,integer) to authenticated;
revoke all on function public.staff_department_rank(uuid,uuid) from public,anon;
grant execute on function public.staff_department_rank(uuid,uuid) to authenticated,service_role;

CREATE OR REPLACE FUNCTION public.admin_set_staff_departments(p_user_id uuid, p_department_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ids uuid[]:=coalesce(p_department_ids,'{}'::uuid[]);
begin
  if not (public.has_permission('staff.manage') or public.has_permission('staff.invite') or public.has_permission('settings.permissions')) then
    raise exception 'permission denied: staff department management';
  end if;
  if not exists(select 1 from public.staff_members where user_id=p_user_id) then raise exception 'staff member not found'; end if;
  if exists(select 1 from unnest(ids) d left join public.support_departments sd on sd.id=d and sd.enabled=true where sd.id is null) then
    raise exception 'one or more support departments are invalid';
  end if;
  delete from public.support_department_staff where user_id=p_user_id and not (department_id=any(ids));
  insert into public.support_department_staff(department_id,user_id,created_by)
  select distinct d,p_user_id,auth.uid() from unnest(ids) d on conflict(department_id,user_id) do nothing;
  insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
  values(auth.uid(),'staff.departments_updated','staff_member',p_user_id::text,jsonb_build_object('department_ids',ids));
  return jsonb_build_object('ok',true,'department_ids',to_jsonb(ids));
end
$function$;
CREATE OR REPLACE FUNCTION public.admin_support_queue_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid:=auth.uid(); rank integer; tickets jsonb;
begin
 if uid is null or not public.has_permission('support.manage') then raise exception 'permission denied: support.manage'; end if;
 rank:=public.support_staff_rank(uid);
 select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc),'[]'::jsonb) into tickets
 from (
   select t.id,t.ticket_number,t.user_id,t.department_id,t.assigned_to,t.claim_required,t.subject,t.status,t.priority,t.source,t.related_order_id,t.last_reply_at,t.created_at,t.updated_at,t.archived_at,t.escalation_level,t.escalation_reason,t.escalated_at,t.escalated_by,
          d.name department_name,
          coalesce(ap.display_name,trim(concat_ws(' ',ap.first_name,ap.last_name))) assigned_name,
          case t.escalation_level when 3 then 'Chief Executive Officer' when 2 then 'Customer Service Supervisor / Manager' when 1 then 'Senior Customer Service Officer' else 'Customer Service' end escalation_label
   from public.support_tickets t
   left join public.support_departments d on d.id=t.department_id
   left join public.user_profiles ap on ap.id=t.assigned_to
   where public.support_staff_can_access_ticket(t.id,uid)
 ) x;
 return jsonb_build_object('tickets',tickets,'rank',rank,'rank_label',public.support_staff_rank_label(rank));
end
$function$;
CREATE OR REPLACE FUNCTION public.support_staff_departments()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid:=auth.uid(); r integer; out jsonb;
begin
 if uid is null or not public.has_permission('support.manage') then raise exception 'permission denied: support.manage'; end if;
 r:=public.support_staff_rank(uid);
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'description',d.description,'slug',d.slug,'email',d.email,'allow_direct_create',d.allow_direct_create,'min_support_rank',d.min_support_rank,'escalation_department_id',d.escalation_department_id) order by d.sort_order,d.name),'[]'::jsonb) into out
 from public.support_departments d where d.enabled=true and public.support_user_has_department(uid,d.id);
 return out;
end $function$;
CREATE OR REPLACE FUNCTION public.support_ticket_routing_snapshot(p_ticket_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t public.support_tickets%rowtype; actor_rank integer; deps jsonb; people jsonb;
begin
 if not public.has_permission('support.manage') then raise exception 'permission denied: support.manage'; end if;
 select * into t from public.support_tickets where id=p_ticket_id; if not found then raise exception 'ticket not found'; end if;
 actor_rank:=public.support_legacy_rank(public.staff_department_rank(auth.uid(),t.department_id));
 if not public.support_staff_can_access_ticket(p_ticket_id,auth.uid()) then raise exception 'ticket is outside your support departments'; end if;
 if t.escalation_level>greatest(actor_rank-1,0) then raise exception 'ticket is escalated above your support level'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'description',d.description,'enabled',d.enabled,'email',d.email,'allow_direct_create',d.allow_direct_create,'min_support_rank',d.min_support_rank) order by d.sort_order,d.name),'[]'::jsonb) into deps
 from public.support_departments d where d.enabled=true and public.support_user_has_department(auth.uid(),d.id);
 select coalesce(jsonb_agg(jsonb_build_object('user_id',sm.user_id,'display_name',coalesce(up.display_name,trim(concat_ws(' ',up.first_name,up.last_name)),sm.user_id::text),'title',sm.title,'rank',public.support_staff_rank(sm.user_id),'rank_label',public.support_staff_rank_label(public.support_staff_rank(sm.user_id))) order by public.support_staff_rank(sm.user_id) desc,coalesce(up.display_name,sm.user_id::text)),'[]'::jsonb) into people
 from public.staff_members sm left join public.user_profiles up on up.id=sm.user_id
 where sm.status='active' and public.support_staff_can_access_ticket(t.id,sm.user_id);
 return jsonb_build_object('ticket',jsonb_build_object('id',t.id,'department_id',t.department_id,'assigned_to',t.assigned_to,'claim_required',t.claim_required,'escalation_level',t.escalation_level,'escalation_reason',t.escalation_reason,'escalated_at',t.escalated_at,'escalated_by',t.escalated_by),'actor_rank',actor_rank,'actor_rank_label',public.support_staff_rank_label(actor_rank),'departments',deps,'staff',people);
end $function$;
CREATE OR REPLACE FUNCTION public.admin_create_support_ticket(p_user_id uuid, p_department_id uuid, p_subject text, p_priority text, p_body text, p_related_order_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare tid uuid; num bigint; mid uuid; r integer;
begin
 if not public.has_permission('support.ticket_create') then raise exception 'permission denied: support.ticket_create'; end if;
 r:=public.support_legacy_rank(public.staff_department_rank(auth.uid(),p_department_id));
 if public.staff_department_rank(auth.uid(),p_department_id)<2 then raise exception 'Department position cannot create staff tickets'; end if;
 if not exists(select 1 from public.support_departments where id=p_department_id and enabled=true and allow_direct_create=true and r>=min_support_rank) then raise exception 'advanced departments cannot be used to start a ticket; move or escalate an existing ticket instead'; end if;
 if not public.support_user_has_department(auth.uid(),p_department_id) then raise exception 'you are not assigned to this support department'; end if;
 if p_user_id is null or not exists(select 1 from public.user_profiles where id=p_user_id) then raise exception 'customer not found'; end if;
 if nullif(trim(coalesce(p_subject,'')),'') is null or nullif(trim(coalesce(p_body,'')),'') is null then raise exception 'subject and message are required'; end if;
 if p_priority not in ('low','normal','high','urgent') then raise exception 'invalid priority'; end if;
 if p_related_order_id is not null and not exists(select 1 from public.orders where id=p_related_order_id and auth_user_id=p_user_id) then raise exception 'order not found'; end if;
 insert into public.support_tickets(user_id,department_id,subject,status,priority,source,related_order_id,last_staff_reply_at,last_reply_at)
 values(p_user_id,p_department_id,trim(p_subject),'open',p_priority,'admin',p_related_order_id,now(),now()) returning id,ticket_number into tid,num;
 insert into public.support_ticket_messages(ticket_id,author_user_id,author_role,body,internal_note,attachments)
 values(tid,auth.uid(),public.current_role(),trim(p_body),false,'[]'::jsonb) returning id into mid;
 perform public.support_emit_system_message(tid,'welcome','{}'::jsonb);
 insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail)
 values(tid,auth.uid(),'admin_created',jsonb_build_object('priority',p_priority,'department_id',p_department_id,'message_id',mid,'customer_id',p_user_id));
 insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
 values(auth.uid(),'support.ticket.create','support_ticket',tid::text,jsonb_build_object('ticket_number',num,'customer_id',p_user_id,'department_id',p_department_id));
 return jsonb_build_object('id',tid,'ticket_number',num);
end $function$;
CREATE OR REPLACE FUNCTION public.admin_update_support_ticket(p_ticket_id uuid, p_subject text DEFAULT NULL::text, p_priority text DEFAULT NULL::text, p_department_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_assigned_to uuid DEFAULT NULL::uuid, p_assignment_action text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare old public.support_tickets%rowtype; staff_name text; dept_name text; target_department uuid; actor_rank integer; department_changed boolean;
begin
 if not public.has_permission('support.manage') then raise exception 'permission denied: support.manage'; end if;
 select * into old from public.support_tickets where id=p_ticket_id for update; if not found then raise exception 'ticket not found'; end if;
 if not public.support_staff_can_access_ticket(p_ticket_id,auth.uid()) then raise exception 'ticket is outside your support department or escalation level'; end if;
 actor_rank:=public.support_legacy_rank(public.staff_department_rank(auth.uid(),old.department_id)); department_changed:=p_department_id is not null and p_department_id is distinct from old.department_id;
 if p_subject is not null and p_subject<>old.subject and not public.has_permission('support.ticket_edit') then raise exception 'permission denied: support.ticket_edit'; end if;
 if p_priority is not null and p_priority<>old.priority and not public.has_permission('support.priority') then raise exception 'permission denied: support.priority'; end if;
 if department_changed and not public.has_permission('support.department') then raise exception 'permission denied: support.department'; end if;
 if p_status is not null and p_status<>old.status and not public.has_permission('support.close') then raise exception 'permission denied: support.close'; end if;
 if p_assignment_action='claim' and not public.has_permission('support.claim') then raise exception 'permission denied: support.claim'; end if;
 if p_assignment_action='assign' and not public.has_permission('support.assign') then raise exception 'permission denied: support.assign'; end if;
 if p_assignment_action in ('transfer','unassign') and not public.has_permission('support.transfer') then raise exception 'permission denied: support.transfer'; end if;
 if old.claim_required and p_assignment_action in ('assign','transfer') then raise exception 'this ticket must be claimed by the current department before it can be assigned or transferred'; end if;
 if p_assignment_action='claim' then
   if p_assigned_to is distinct from auth.uid() then raise exception 'a ticket can only be claimed by the signed-in staff member'; end if;
   if old.claim_required then
     if old.escalation_level>0 and actor_rank<old.escalation_level+1 then raise exception 'this escalated ticket requires % or higher',public.support_staff_rank_label(old.escalation_level+1); end if;
     if old.escalation_level=0 and actor_rank<2 and not public.support_user_has_department(auth.uid(),old.department_id) then raise exception 'this ticket must be claimed by the destination department or Senior Support+'; end if;
   end if;
 end if;
 if p_priority is not null and p_priority not in ('low','normal','high','urgent') then raise exception 'invalid priority'; end if;
 if p_status is not null and p_status not in ('open','closed','on_hold','pending','customer_reply','staff_reply') then raise exception 'invalid status'; end if;
 if p_department_id is not null and not exists(select 1 from public.support_departments where id=p_department_id and enabled=true) then raise exception 'invalid department'; end if;
 target_department:=coalesce(p_department_id,old.department_id);
 if department_changed and not public.support_user_has_department(auth.uid(),p_department_id) then raise exception 'you are not assigned to the destination support department or do not meet its minimum tier'; end if;
 if p_assigned_to is not null then
   if not exists(select 1 from public.staff_members where user_id=p_assigned_to and status='active') or public.support_staff_rank(p_assigned_to)<=0 then raise exception 'invalid staff member'; end if;
   if not public.support_user_has_department(p_assigned_to,target_department) then raise exception 'staff member is not assigned to this department'; end if;
   if public.support_legacy_rank(public.staff_department_rank(p_assigned_to,target_department))<=old.escalation_level then raise exception 'staff member is below the ticket escalation tier'; end if;
 end if;
 update public.support_tickets set
   subject=coalesce(p_subject,subject),priority=coalesce(p_priority,priority),department_id=coalesce(p_department_id,department_id),status=coalesce(p_status,status),
   assigned_to=case when department_changed then null when p_assignment_action='unassign' then null when p_assigned_to is not null then p_assigned_to else assigned_to end,
   claim_required=case when department_changed then true when p_assignment_action='claim' then false else claim_required end,
   closed_at=case when p_status='closed' then now() when p_status is not null and p_status<>'closed' then null else closed_at end,
   closed_by=case when p_status='closed' then auth.uid() when p_status is not null and p_status<>'closed' then null else closed_by end,updated_at=now()
 where id=p_ticket_id;
 if p_priority is not null and p_priority<>old.priority then perform public.support_emit_system_message(p_ticket_id,'priority_changed',jsonb_build_object('priority',p_priority)); end if;
 if department_changed then select name into dept_name from public.support_departments where id=p_department_id; perform public.support_emit_system_message(p_ticket_id,'department_changed',jsonb_build_object('department',dept_name,'status','claim_required')); end if;
 if p_assigned_to is not null and p_assigned_to is distinct from old.assigned_to then select display_name into staff_name from public.user_profiles where id=p_assigned_to; perform public.support_emit_system_message(p_ticket_id,case when p_assignment_action='claim' then 'claimed' when old.assigned_to is null then 'assigned' else 'transferred' end,jsonb_build_object('staff',coalesce(staff_name,'Support staff'))); end if;
 if p_status='closed' and old.status<>'closed' then perform public.support_emit_system_message(p_ticket_id,'closing','{}'::jsonb); end if;
 insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail) values(p_ticket_id,auth.uid(),case when department_changed then 'department_transferred' else 'ticket_updated' end,jsonb_build_object('subject',p_subject,'priority',p_priority,'from_department_id',old.department_id,'department_id',p_department_id,'status',p_status,'assigned_to',p_assigned_to,'assignment_action',p_assignment_action,'claim_required',case when department_changed then true when p_assignment_action='claim' then false else old.claim_required end));
 return jsonb_build_object('ok',true,'claim_required',case when department_changed then true when p_assignment_action='claim' then false else old.claim_required end,'department_changed',department_changed);
end $function$;
CREATE OR REPLACE FUNCTION public.admin_escalate_support_ticket(p_ticket_id uuid, p_target_level integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t public.support_tickets%rowtype; rank integer; target_label text; new_department uuid; mapped uuid;
begin
 if not public.has_permission('support.escalate') then raise exception 'permission denied: support.escalate'; end if;
 if p_target_level not between 0 and 3 then raise exception 'invalid escalation level'; end if;
 if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'escalation reason is required'; end if;
 rank:=public.support_staff_rank(auth.uid());
 select * into t from public.support_tickets where id=p_ticket_id for update; if not found then raise exception 'ticket not found'; end if;
 rank:=public.support_legacy_rank(public.staff_department_rank(auth.uid(),t.department_id));
 if not public.support_staff_can_access_ticket(p_ticket_id,auth.uid()) then raise exception 'ticket is outside your support department or escalation level'; end if;
 if p_target_level>t.escalation_level then
   if p_target_level<>t.escalation_level+1 then raise exception 'tickets must escalate one support level at a time'; end if;
   if p_target_level>least(rank,3) then raise exception 'your support level cannot escalate to that tier'; end if;
 elsif p_target_level<t.escalation_level then
   if p_target_level<>t.escalation_level-1 then raise exception 'tickets must de-escalate one support level at a time'; end if;
   if not public.has_permission('support.escalation.manage') then raise exception 'permission denied: support.escalation.manage'; end if;
   if rank<t.escalation_level+1 then raise exception 'your support level cannot de-escalate this ticket'; end if;
 end if;
 target_label:=case p_target_level when 3 then 'Chief Executive Officer' when 2 then 'Customer Service Supervisor / Manager' when 1 then 'Senior Customer Service Officer' else 'Customer Service' end;
 new_department:=t.department_id;
 if p_target_level>t.escalation_level then
   select escalation_department_id into mapped from public.support_departments where id=t.department_id;
   if mapped is not null then new_department:=mapped; end if;
 elsif p_target_level=0 and p_target_level<t.escalation_level then
   select id into mapped from public.support_departments where escalation_department_id=t.department_id and enabled=true order by sort_order limit 1;
   if mapped is not null then new_department:=mapped; end if;
 end if;
 perform public.support_emit_system_message(p_ticket_id,'escalated',jsonb_build_object('escalation',target_label,'reason',trim(p_reason),'status','escalated'));
 update public.support_tickets set
   escalation_level=p_target_level,
   escalation_reason=trim(p_reason),
   department_id=new_department,
   escalated_at=case when p_target_level=0 then null else now() end,
   escalated_by=case when p_target_level=0 then null else auth.uid() end,
   assigned_to=case when p_target_level<>t.escalation_level then null else assigned_to end,
   claim_required=case when p_target_level<>t.escalation_level then true else claim_required end,
   updated_at=now()
 where id=p_ticket_id;
 insert into public.support_ticket_events(ticket_id,actor_user_id,event_type,detail)
 values(p_ticket_id,auth.uid(),case when p_target_level>t.escalation_level then 'escalated' when p_target_level<t.escalation_level then 'deescalated' else 'escalation_updated' end,
   jsonb_build_object('from_level',t.escalation_level,'to_level',p_target_level,'target',target_label,'reason',trim(p_reason),'from_department_id',t.department_id,'to_department_id',new_department,'claim_required',p_target_level<>t.escalation_level));
 insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
 values(auth.uid(),'support.escalation','support_ticket',p_ticket_id::text,jsonb_build_object('ticket_number',t.ticket_number,'from_level',t.escalation_level,'to_level',p_target_level,'reason',trim(p_reason),'from_department_id',t.department_id,'to_department_id',new_department));
 return jsonb_build_object('ok',true,'level',p_target_level,'label',target_label,'department_id',new_department,'claim_required',p_target_level<>t.escalation_level);
end $function$;
CREATE OR REPLACE FUNCTION public.support_guard_ticket_staff_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if auth.uid() is not null and auth.uid()<>old.user_id and public.support_staff_rank(auth.uid())>0 and not public.support_staff_can_access_ticket(old.id,auth.uid()) then
   raise exception 'ticket is outside your support department or escalation level';
 end if;
 if auth.uid() is not null and public.support_staff_rank(auth.uid())>0 and auth.uid() is distinct from old.user_id then
   if new.escalation_level=old.escalation_level then
     if new.assigned_to is distinct from old.assigned_to and new.assigned_to is distinct from auth.uid() and public.staff_department_rank(auth.uid(),old.department_id)<4 then raise exception 'Supervisor position required to assign or unassign'; end if;
     if new.department_id is distinct from old.department_id and (public.staff_department_rank(auth.uid(),old.department_id)<5 or not public.support_user_has_department(auth.uid(),new.department_id)) then raise exception 'Manager position and destination department required'; end if;
   end if;
   if (new.priority is distinct from old.priority or new.subject is distinct from old.subject) and public.staff_department_rank(auth.uid(),old.department_id)<3 then raise exception 'Senior position required'; end if;
   if new.status='closed' and old.status<>'closed' and public.staff_department_rank(auth.uid(),old.department_id)<2 then raise exception 'Tier 2 required to close'; end if;
 end if;
 return new;
end $function$;

-- Preserve department positions on bulk membership edits instead of resetting them.
-- The legacy 1..4 escalation/minimum rank scale remains intact for deployed clients;
-- its rank 2 now corresponds to actual Tier 3.
do $$ begin
 if (select count(*) from public.staff_groups where public.staff_group_rank(slug)>0)<>9 then raise exception 'Expected nine staff groups'; end if;
 if not exists(select 1 from public.staff_groups where slug='superadmin' and permissions->>'all'='true') then raise exception 'Executive access lost'; end if;
 if exists(select 1 from public.staff_groups where public.staff_group_rank(slug) between 1 and 8 and (permissions->>'all'='true' or permissions->>'settings.permissions'='true' or permissions->>'staff.manage'='true' or permissions->>'licenses.rotate'='true')) then raise exception 'Non-executive privileged permissions'; end if;
end $$;
notify pgrst,'reload schema';
