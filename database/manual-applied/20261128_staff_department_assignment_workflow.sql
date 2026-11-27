-- Atomic employment/department assignments and invitation persistence.
alter table public.staff_invitations add column if not exists department_positions jsonb not null default '{}'::jsonb;
create or replace function public.validate_staff_department_positions(p_group_ids uuid[],p_department_ids uuid[],p_positions jsonb) returns void
language plpgsql stable security definer set search_path=public as $$
declare entry record; dept uuid; rank integer; minimum integer;
begin
 if jsonb_typeof(coalesce(p_positions,'{}'::jsonb))<>'object' then raise exception 'Department positions must be an object'; end if;
 if exists(select 1 from unnest(coalesce(p_department_ids,'{}'::uuid[])) d left join public.support_departments sd on sd.id=d and sd.enabled where sd.id is null) then raise exception 'Invalid department'; end if;
 for entry in select key,value from jsonb_each_text(coalesce(p_positions,'{}'::jsonb)) loop
   dept:=entry.key::uuid; rank:=entry.value::integer;
   if not (dept=any(coalesce(p_department_ids,'{}'::uuid[]))) or rank not between 1 and 5 then raise exception 'Invalid department position'; end if;
   if not exists(select 1 from public.staff_groups g where g.id=any(p_group_ids) and public.staff_group_rank(g.slug)=rank) then raise exception 'Department position requires its matching user group'; end if;
   select min_support_rank into minimum from public.support_departments where id=dept and enabled;
   if minimum is null or minimum>public.support_legacy_rank(rank) then raise exception 'Department minimum tier not met'; end if;
 end loop;
 -- Scoped staff must explicitly choose a position in each assigned department.
 if exists(select 1 from public.staff_groups g where g.id=any(p_group_ids) and public.staff_group_rank(g.slug) between 1 and 5)
 and not exists(select 1 from public.staff_groups g where g.id=any(p_group_ids) and public.staff_group_rank(g.slug) in (6,7,9))
 and (cardinality(coalesce(p_department_ids,'{}'::uuid[]))=0 or exists(select 1 from unnest(p_department_ids) d where not coalesce(p_positions,'{}'::jsonb)?d::text))
 then raise exception 'Choose a department and position for every scoped staff assignment'; end if;
end $$;
revoke all on function public.validate_staff_department_positions(uuid[],uuid[],jsonb) from public,anon,authenticated;
grant execute on function public.validate_staff_department_positions(uuid[],uuid[],jsonb) to service_role;

create or replace function public.admin_save_staff_member_with_departments(
 p_user_id uuid,p_title text,p_department text,p_staff_notes text,p_status text,
 p_group_ids uuid[],p_primary_group_id uuid,p_department_ids uuid[],p_department_positions jsonb,p_employment_type text default 'full_time'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.has_permission('settings.permissions') then raise exception 'Permission denied'; end if;
 perform public.validate_staff_department_positions(p_group_ids,p_department_ids,p_department_positions);
 if p_employment_type not in ('casual','part_time','full_time','contractor','temporary') then raise exception 'Invalid employment type'; end if;
 result:=public.admin_save_staff_member(p_user_id,p_title,p_department,p_staff_notes,p_status,p_group_ids,p_primary_group_id);
 perform public.admin_set_staff_departments(p_user_id,p_department_ids);
 update public.support_department_staff set position_rank=(p_department_positions->>department_id::text)::integer where user_id=p_user_id;
 update public.staff_members set employment_type=p_employment_type where user_id=p_user_id;
 insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
 values(auth.uid(),'staff.department_positions_saved','staff_member',p_user_id::text,jsonb_build_object('department_positions',p_department_positions));
 return result;
end $$;
revoke all on function public.admin_save_staff_member_with_departments(uuid,text,text,text,text,uuid[],uuid,uuid[],jsonb,text) from public;
revoke all on function public.admin_save_staff_member_with_departments(uuid,text,text,text,text,uuid[],uuid,uuid[],jsonb,text) from anon;
grant execute on function public.admin_save_staff_member_with_departments(uuid,text,text,text,text,uuid[],uuid,uuid[],jsonb,text) to authenticated;
CREATE OR REPLACE FUNCTION public.accept_staff_invitation(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare inv public.staff_invitations%rowtype; actor uuid:=auth.uid(); actor_email text; chosen uuid; primary_slug text; has_super boolean; has_admin boolean; role_name text; dept text;
begin
 if actor is null then raise exception 'Sign in to your customer account first'; end if;
 select lower(email) into actor_email from auth.users where id=actor;
 select * into inv from public.staff_invitations where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') for update;
 if not found then raise exception 'Invitation not found'; end if;
 if inv.accepted_at is not null or inv.revoked_at is not null or inv.expires_at<=now() then raise exception 'Invitation is no longer valid'; end if;
 if actor_email is distinct from inv.email or (inv.user_id is not null and inv.user_id<>actor) then raise exception 'Sign in with the invited email address'; end if;
 if not exists(select 1 from public.user_profiles where id=actor) then raise exception 'Complete customer account registration before accepting the invitation'; end if;
 if exists(select 1 from public.staff_members where user_id=actor) then raise exception 'Staff access already exists'; end if;
 if exists(select 1 from unnest(inv.group_ids) g left join public.staff_groups sg on sg.id=g where sg.id is null) then raise exception 'Invitation refers to an unavailable group'; end if;
 chosen:=case when inv.primary_group_id=any(inv.group_ids) then inv.primary_group_id else inv.group_ids[1] end;
 select slug into primary_slug from public.staff_groups where id=chosen;
 select exists(select 1 from public.staff_groups where id=any(inv.group_ids) and slug='superadmin') into has_super;
 select exists(select 1 from public.staff_groups where id=any(inv.group_ids) and slug='admin') into has_admin;
 role_name:=case when has_super then 'superadmin' when has_admin then 'admin' when primary_slug='senior-support' then 'senior-support' else 'support' end;
 select name into dept from public.support_departments where id=inv.primary_department_id and enabled=true;
 insert into public.staff_members(user_id,status,title,department,staff_notes,created_by,updated_at)
 values(actor,'active',nullif(trim(inv.title),''),dept,nullif(trim(inv.staff_notes),''),inv.created_by,now());
 insert into public.staff_member_groups(user_id,group_id,is_primary)
 select actor,g,(g=chosen) from unnest(inv.group_ids) g;
 if cardinality(inv.department_ids)>0 then
   perform public.validate_staff_department_positions(inv.group_ids,inv.department_ids,inv.department_positions);
   insert into public.support_department_staff(user_id,department_id,position_rank)
   select actor,d,(inv.department_positions->>d::text)::integer from unnest(inv.department_ids) d join public.support_departments sd on sd.id=d and sd.enabled=true
   on conflict do nothing;
 end if;
 update public.user_profiles set role=role_name where id=actor;
 update public.staff_invitations set accepted_at=now(),user_id=actor where id=inv.id;
 insert into public.admin_audit_log(actor_id,action,target_type,target_id,detail)
 values(actor,'staff.invitation_accepted','staff_member',actor::text,jsonb_build_object('invitation_id',inv.id,'groups',inv.group_ids,'invited_by',inv.created_by));
 return jsonb_build_object('ok',true,'user_id',actor);
end $function$;
notify pgrst,'reload schema';
