-- Explicitly lock OrbitFS installation creation to authenticated/server roles.
-- Historical schema granted anon EXECUTE directly, so REVOKE FROM PUBLIC alone is insufficient.

revoke all on function public.ensure_orbitfs_installation(uuid) from public;
revoke all on function public.ensure_orbitfs_installation(uuid) from anon;
revoke all on function public.ensure_orbitfs_installation(uuid) from authenticated;
revoke all on function public.ensure_orbitfs_installation(uuid) from service_role;

grant execute on function public.ensure_orbitfs_installation(uuid) to authenticated;
grant execute on function public.ensure_orbitfs_installation(uuid) to service_role;
