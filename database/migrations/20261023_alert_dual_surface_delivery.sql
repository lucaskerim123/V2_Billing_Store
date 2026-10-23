-- Preserve customer portal delivery when a customer also holds active staff access.
-- A dispatch to everyone may send once to each applicable surface.
create or replace function public.orbitfs_alert_candidate_recipients(
  p_audience text,
  p_recipient_user_ids uuid[] default null,
  p_conditions jsonb default '{}'::jsonb
) returns table(user_id uuid,surface text,label text,email text)
language sql security definer set search_path='public','auth' as $$
  select
    au.id as user_id,
    destination.surface as surface,
    coalesce(
      nullif(btrim(up.display_name),''),
      nullif(btrim(concat_ws(' ',up.first_name,up.last_name)),''),
      au.email,
      au.id::text
    ) as label,
    au.email
  from auth.users au
  left join public.user_profiles up on up.id=au.id
  left join public.staff_members sm on sm.user_id=au.id
  cross join lateral (values ('admin'::text),('portal'::text)) as destination(surface)
  where
    (
      (p_audience='selected' and au.id=any(coalesce(p_recipient_user_ids,'{}'::uuid[])) and ((destination.surface='admin' and sm.status='active') or (destination.surface='portal' and up.id is not null)))
      or (p_audience='staff' and destination.surface='admin' and sm.user_id is not null and sm.status='active')
      or (p_audience='customers' and destination.surface='portal' and up.id is not null)
      or (p_audience='everyone' and ((destination.surface='portal' and up.id is not null) or (destination.surface='admin' and sm.user_id is not null and sm.status='active')))
    )
    and (
      nullif(btrim(coalesce(p_conditions->>'customer_status','')),'') is null
      or lower(coalesce(up.status,''))=lower(btrim(p_conditions->>'customer_status'))
    )
    and (
      nullif(btrim(coalesce(p_conditions->>'country_code','')),'') is null
      or upper(coalesce(up.country_code,''))=upper(btrim(p_conditions->>'country_code'))
    )
    and (
      coalesce(p_conditions->>'verified_only','false')<>'true'
      or up.email_verified_at is not null
    )
    and (
      nullif(btrim(coalesce(p_conditions->>'product_slug','')),'') is null
      or exists(
        select 1
        from public.orders o
        join public.order_items oi on oi.order_id=o.id
        where o.auth_user_id=au.id
          and lower(coalesce(oi.product_slug,''))=lower(btrim(p_conditions->>'product_slug'))
      )
    )
    and (
      nullif(btrim(coalesce(p_conditions->>'service_status','')),'') is null
      or exists(
        select 1
        from public.orders o
        join public.order_items oi on oi.order_id=o.id
        where o.auth_user_id=au.id
          and lower(coalesce(oi.service_status,''))=lower(btrim(p_conditions->>'service_status'))
      )
    )
    and (
      nullif(btrim(coalesce(p_conditions->>'license_state','')),'') is null
      or exists(
        select 1 from public.license_bindings lb
        where lb.auth_user_id=au.id
          and lb.archived_at is null
          and lower(coalesce(lb.remote_state,lb.desired_state,''))=lower(btrim(p_conditions->>'license_state'))
      )
    )
    and (
      nullif(btrim(coalesce(p_conditions->>'staff_status','')),'') is null
      or lower(coalesce(sm.status,''))=lower(btrim(p_conditions->>'staff_status'))
    )
    and (
      nullif(btrim(coalesce(p_conditions->>'staff_department','')),'') is null
      or lower(coalesce(sm.department,''))=lower(btrim(p_conditions->>'staff_department'))
    )
    and (
      nullif(btrim(coalesce(p_conditions->>'staff_group','')),'') is null
      or exists(
        select 1
        from public.staff_member_groups smg
        join public.staff_groups sg on sg.id=smg.group_id
        where smg.user_id=au.id
          and lower(sg.slug)=lower(btrim(p_conditions->>'staff_group'))
      )
    );
$$;

