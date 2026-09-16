-- First-deployment admin bootstrap for Billing Store.
-- The bootstrap is available only while no staff member exists.

create or replace function public.admin_bootstrap_status()
returns jsonb
language sql
security definer
set search_path='public','auth'
as $$
  select jsonb_build_object(
    'available', not exists (select 1 from public.staff_members),
    'staff_count', (select count(*) from public.staff_members)
  );
$$;

revoke all on function public.admin_bootstrap_status() from public;
grant execute on function public.admin_bootstrap_status() to anon,authenticated;

create or replace function public.admin_bootstrap_first_admin(p_user_id uuid,p_title text default 'System Administrator')
returns jsonb
language plpgsql
security definer
set search_path='public','auth'
as $$
declare
  superadmin_id uuid;
  staff_count integer;
begin
  if p_user_id is null then raise exception 'User is required'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then raise exception 'User mismatch'; end if;

  select count(*) into staff_count from public.staff_members;
  if staff_count > 0 then raise exception 'Initial admin has already been configured'; end if;

  insert into public.staff_groups(slug,name,description,permissions,is_system,sort_order)
  values
    ('support','Support','Front-line support worker.',jsonb_build_object('portal',true,'admin.access',true,'customers.view',true,'orders.view',true,'invoices.view',true,'licenses.view',true,'support.manage',true,'support.reply',true,'support.ticket_create',true,'support.escalate',true,'support.kb.view',true),true,20),
    ('senior-support','Senior Support','Support supervisor.',jsonb_build_object('portal',true,'admin.access',true,'customers.view',true,'orders.view',true,'invoices.view',true,'licenses.view',true,'support.manage',true,'support.claim',true,'support.assign',true,'support.transfer',true,'support.reply',true,'support.priority',true,'support.department',true,'support.close',true,'support.archive',true,'support.ticket_edit',true,'support.ticket_create',true,'support.escalate',true,'support.escalation.manage',true,'support.kb.view',true,'support.kb.manage',true),true,15),
    ('admin','Administrator','Administrative manager with broad operational control.',jsonb_build_object('portal',true,'admin.access',true,'customers.view',true,'customers.create',true,'customers.edit',true,'orders.view',true,'orders.create',true,'orders.manage',true,'invoices.view',true,'invoices.create',true,'invoices.manage',true,'payments.view',true,'payments.manage',true,'licenses.view',true,'licenses.manage',true,'support.manage',true,'support.ticket_create',true,'support.escalate',true,'support.escalation.manage',true,'support.kb.view',true,'support.kb.manage',true,'products.view',true,'products.manage',true,'staff.view',true,'staff.manage',true,'staff.invite',true,'staff.groups.view',true,'staff.groups.manage',true,'settings.view',true,'settings.general',true,'settings.permissions',true,'analytics.view',true,'audit.view',true),true,10),
    ('superadmin','Superadmin','Full protected system authority. Final escalation and system owner authority.',jsonb_build_object('all',true,'admin.access',true,'settings.permissions',true,'staff.view',true,'staff.manage',true,'staff.invite',true,'staff.groups.view',true,'staff.groups.manage',true),true,1)
  on conflict (slug) do nothing;

  select id into superadmin_id from public.staff_groups where slug='superadmin';
  if superadmin_id is null then raise exception 'Superadmin group could not be created'; end if;

  insert into public.staff_members(user_id,status,title,department,staff_notes,created_by,updated_at)
  values(p_user_id,'active',nullif(trim(coalesce(p_title,'System Administrator')),''),'Administration','Initial Billing Store administrator',p_user_id,now());

  insert into public.staff_member_groups(user_id,group_id,is_primary)
  values(p_user_id,superadmin_id,true)
  on conflict (user_id,group_id) do update set is_primary=true;

  return jsonb_build_object('ok',true,'user_id',p_user_id,'role','superadmin');
end;
$$;

revoke all on function public.admin_bootstrap_first_admin(uuid,text) from public;
grant execute on function public.admin_bootstrap_first_admin(uuid,text) to authenticated;
