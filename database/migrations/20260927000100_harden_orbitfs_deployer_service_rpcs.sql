-- OrbitFS deployer service RPCs are server-only. Keep the internal service_role
-- guard and also enforce the same boundary at the EXECUTE grant layer.

revoke execute on function public.service_upsert_orbitfs_provider_connection(uuid,text,text,text,timestamptz,jsonb) from public, anon, authenticated;
revoke execute on function public.service_disconnect_orbitfs_provider_connection(uuid,text) from public, anon, authenticated;
revoke execute on function public.service_orbitfs_provider_secret(uuid,text,text) from public, anon, authenticated;
revoke execute on function public.service_orbitfs_release_secret(text) from public, anon, authenticated;
revoke execute on function public.service_store_orbitfs_installation_secret(uuid,text,text) from public, anon, authenticated;
revoke execute on function public.service_orbitfs_installation_secret(uuid,text) from public, anon, authenticated;

grant execute on function public.service_upsert_orbitfs_provider_connection(uuid,text,text,text,timestamptz,jsonb) to service_role;
grant execute on function public.service_disconnect_orbitfs_provider_connection(uuid,text) to service_role;
grant execute on function public.service_orbitfs_provider_secret(uuid,text,text) to service_role;
grant execute on function public.service_orbitfs_release_secret(text) to service_role;
grant execute on function public.service_store_orbitfs_installation_secret(uuid,text,text) to service_role;
grant execute on function public.service_orbitfs_installation_secret(uuid,text) to service_role;
