-- Remove the deleted Mail system from staff-access resolution.
-- Staff authentication and permissions are sourced only from staff_members
-- and staff_member_groups. Mail capabilities are no longer inferred here.

create or replace function public.get_my_staff_access()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'is_staff',
      exists (
        select 1
        from public.staff_members sm
        where sm.user_id = auth.uid()
          and sm.status = 'active'
      ),
    'status',
      coalesce((
        select sm.status
        from public.staff_members sm
        where sm.user_id = auth.uid()
      ), 'none'),
    'primary_role', public.current_role(),
    'groups',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', sg.id,
            'slug', sg.slug,
            'name', sg.name,
            'is_primary', smg.is_primary
          )
          order by smg.is_primary desc, sg.sort_order, sg.name
        )
        from public.staff_member_groups smg
        join public.staff_groups sg on sg.id = smg.group_id
        join public.staff_members sm on sm.user_id = smg.user_id
        where smg.user_id = auth.uid()
          and sm.status = 'active'
      ), '[]'::jsonb),
    'permissions',
      coalesce((
        select jsonb_object_agg(k, true)
        from (
          select distinct permission.key as k
          from public.staff_member_groups smg
          join public.staff_groups sg on sg.id = smg.group_id
          join public.staff_members sm on sm.user_id = smg.user_id
          cross join lateral jsonb_each_text(sg.permissions) as permission
          where smg.user_id = auth.uid()
            and sm.status = 'active'
            and permission.value = 'true'
        ) granted
      ), '{}'::jsonb)
  )
$function$;
