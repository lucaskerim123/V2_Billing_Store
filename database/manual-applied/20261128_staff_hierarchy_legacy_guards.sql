-- Remove legacy admin-role bypasses and protect department assignments.
create or replace function public."current_role"() returns text language sql stable security definer set search_path=public as $$
 select coalesce((select case when g.slug='admin' then 'senior-customer-service-manager' else g.slug end
 from public.staff_members sm join public.staff_member_groups m on m.user_id=sm.user_id join public.staff_groups g on g.id=m.group_id
 where sm.user_id=auth.uid() and sm.status='active'
 order by (g.slug='superadmin') desc,m.is_primary desc,g.sort_order,g.slug limit 1),'user')
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
 select public.current_role()='superadmin'
$$;
create or replace function public.is_superadmin() returns boolean language sql stable security definer set search_path=public as $$
 select public.current_role()='superadmin'
$$;
-- Staff membership itself is not a grant to inspect every billing record.
alter policy customer_self_read on public.customers using (auth_user_id=auth.uid() or public.has_permission('customers.view'));
alter policy credit_ledger_owner_read on public.credit_ledger using (user_id=auth.uid() or public.has_permission('credit.manage'));
alter policy orders_owner_read on public.orders using (public.has_permission('orders.view') or exists(select 1 from public.customers c where c.id=orders.customer_id and c.auth_user_id=auth.uid()));
alter policy order_items_owner_read on public.order_items using (public.has_permission('orders.view') or exists(select 1 from public.orders o join public.customers c on c.id=o.customer_id where o.id=order_items.order_id and c.auth_user_id=auth.uid()));
alter policy "staff read all order items" on public.order_items using (public.has_permission('orders.view'));
alter policy fulfillments_owner_read on public.license_fulfillments using (public.has_permission('licenses.view') or exists(select 1 from public.orders o join public.customers c on c.id=o.customer_id where o.id=license_fulfillments.order_id and c.auth_user_id=auth.uid()));
alter policy "staff read all licenses" on public.license_fulfillments using (public.has_permission('licenses.view'));
alter policy "staff read invoice items" on public.invoice_items using (public.has_permission('invoices.view'));
alter policy "staff read payments" on public.invoice_payments using (public.has_permission('invoices.view') or public.has_permission('payments.view'));
-- Staff ticket edits must pass audited RPC checks; direct authenticated UPDATE bypasses them.
alter policy staff_tickets_update on public.support_tickets using (false) with check (false);
-- Preserve CEO access to historic tickets even if a department is disabled or removed.
create or replace function public.support_staff_can_access_ticket(p_ticket_id uuid,p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.support_tickets t where t.id=p_ticket_id and
 (public.support_staff_rank(p_user_id)=4 or
 (public.support_user_has_department(p_user_id,t.department_id)
 and public.support_legacy_rank(public.staff_department_rank(p_user_id,t.department_id))>t.escalation_level)))
$$;
create or replace function public.staff_position_label(p_rank integer) returns text language sql immutable set search_path=pg_catalog as $$
 select case p_rank when 1 then 'Customer Service Representative' when 2 then 'Customer Service Officer' when 3 then 'Senior Customer Service Officer' when 4 then 'Customer Service Supervisor' when 5 then 'Customer Service Manager' when 6 then 'Operations Manager' when 7 then 'Senior Customer Service Manager' when 8 then 'Developer' when 9 then 'Chief Executive Officer' else 'Unassigned' end
$$;
create or replace function public.support_staff_rank_label(p_rank integer) returns text language sql immutable set search_path=pg_catalog as $$
 select case p_rank when 1 then 'Customer Service' when 2 then 'Senior Customer Service / Supervision' when 3 then 'Management' when 4 then 'Chief Executive Officer' else 'No support role' end
$$;
-- The legacy department membership endpoint is retained for older clients, but cannot
-- erase explicit position assignments or global staff records when saving routing.
create or replace function public.admin_set_support_department_members(p_department_id uuid,p_user_ids uuid[]) returns jsonb
language plpgsql security definer set search_path=public as $$
declare uid uuid; rank integer; minimum integer; count_added integer:=0;
begin
 if auth.uid() is null or not public.has_permission('settings.permissions') then raise exception 'Permission denied'; end if;
 select min_support_rank into minimum from public.support_departments where id=p_department_id;
 if minimum is null then raise exception 'Department not found'; end if;
 foreach uid in array coalesce(p_user_ids,'{}'::uuid[]) loop
   if exists(select 1 from public.support_department_staff where user_id=uid and department_id=p_department_id) then continue; end if;
   select min(public.staff_group_rank(g.slug)) into rank from public.staff_members sm join public.staff_member_groups m on m.user_id=sm.user_id join public.staff_groups g on g.id=m.group_id
   where sm.user_id=uid and sm.status='active' and public.staff_group_rank(g.slug) between 1 and 5;
   if rank is null or public.support_legacy_rank(rank)<minimum then raise exception 'Choose an eligible department position in the employee record'; end if;
   insert into public.support_department_staff(department_id,user_id,position_rank,created_by) values(p_department_id,uid,rank,auth.uid());
   count_added:=count_added+1;
 end loop;
 return jsonb_build_object('ok',true,'member_count',count_added,'message','Existing positions retained; manage removals in employee records');
end $$;
CREATE OR REPLACE FUNCTION public.admin_set_support_department_routing(p_department_id uuid, p_allow_direct_create boolean, p_min_support_rank integer, p_escalation_department_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if not (public.has_permission('support.settings') or public.has_permission('support.departments.manage')) then raise exception 'permission denied: support.departments.manage'; end if;
 if p_min_support_rank not between 1 and 4 then raise exception 'minimum support tier must be between 1 and 4'; end if;
 if p_escalation_department_id=p_department_id then raise exception 'department cannot escalate to itself'; end if;
 if p_escalation_department_id is not null and not exists(select 1 from public.support_departments where id=p_escalation_department_id and enabled=true) then raise exception 'escalation department not found'; end if;
 update public.support_departments set allow_direct_create=coalesce(p_allow_direct_create,true),min_support_rank=p_min_support_rank,escalation_department_id=p_escalation_department_id,updated_at=now() where id=p_department_id;
 if not found then raise exception 'department not found'; end if;
 -- Existing assignments are retained; department minimum is enforced at access time.
 insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail) values(auth.uid(),'support.department.routing','support_department',p_department_id::text,jsonb_build_object('allow_direct_create',p_allow_direct_create,'min_support_rank',p_min_support_rank,'escalation_department_id',p_escalation_department_id));
 return jsonb_build_object('ok',true);
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
 select coalesce(jsonb_agg(jsonb_build_object('user_id',sm.user_id,'display_name',coalesce(up.display_name,trim(concat_ws(' ',up.first_name,up.last_name)),sm.user_id::text),'title',sm.title,'rank',public.staff_department_rank(sm.user_id,t.department_id),'rank_label',public.staff_position_label(public.staff_department_rank(sm.user_id,t.department_id))) order by public.support_staff_rank(sm.user_id) desc,coalesce(up.display_name,sm.user_id::text)),'[]'::jsonb) into people
 from public.staff_members sm left join public.user_profiles up on up.id=sm.user_id
 where sm.status='active' and public.support_staff_can_access_ticket(t.id,sm.user_id);
 return jsonb_build_object('ticket',jsonb_build_object('id',t.id,'department_id',t.department_id,'assigned_to',t.assigned_to,'claim_required',t.claim_required,'escalation_level',t.escalation_level,'escalation_reason',t.escalation_reason,'escalated_at',t.escalated_at,'escalated_by',t.escalated_by),'actor_rank',actor_rank,'actor_position_rank',public.staff_department_rank(auth.uid(),t.department_id),'actor_rank_label',public.staff_position_label(public.staff_department_rank(auth.uid(),t.department_id)),'departments',deps,'staff',people);
end $function$;
notify pgrst,'reload schema';
