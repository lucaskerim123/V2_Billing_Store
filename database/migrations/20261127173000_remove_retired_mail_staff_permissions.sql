-- Remove retired Mail capabilities from every existing staff group.
-- Historical migrations remain immutable; this forward-only migration cleans persisted permissions.

update public.staff_groups as groups
set permissions = coalesce(
  (
    select jsonb_object_agg(permission.key, permission.value)
    from jsonb_each(coalesce(groups.permissions, '{}'::jsonb)) as permission(key, value)
    where permission.key not like 'mail.%'
  ),
  '{}'::jsonb
),
updated_at = now()
where exists (
  select 1
  from jsonb_object_keys(coalesce(groups.permissions, '{}'::jsonb)) as permission_key(key)
  where permission_key.key like 'mail.%'
);
