-- Separate Billing-owned fallback OAuth credentials; preserve main configuration and customer records.
create table if not exists private.orbitfs_fallback_oauth_settings (
 id text primary key default 'fallback' check(id='fallback'),
 supabase_oauth_enabled boolean not null default true,
 vercel_oauth_enabled boolean not null default true,
 supabase_client_id text,
 vercel_client_id text,
 vercel_install_url text,
 supabase_scopes text
);
insert into private.orbitfs_fallback_oauth_settings(id) values('fallback') on conflict do nothing;
create or replace function public.admin_orbitfs_fallback_oauth_settings()
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare s private.orbitfs_fallback_oauth_settings%rowtype;
begin
 if not public.has_permission('licenses.view') then raise exception 'permission denied'; end if;
 select * into s from private.orbitfs_fallback_oauth_settings where id='fallback';
 return to_jsonb(s)||jsonb_build_object(
  'supabase_client_secret_configured',exists(select 1 from private.orbitfs_release_secret_refs where key='fallback_supabase_client_secret'),
  'vercel_client_secret_configured',exists(select 1 from private.orbitfs_release_secret_refs where key='fallback_vercel_client_secret'));
end $$;
revoke all on function public.admin_orbitfs_fallback_oauth_settings() from public;
grant execute on function public.admin_orbitfs_fallback_oauth_settings() to authenticated;
create or replace function public.admin_update_orbitfs_fallback_oauth_settings(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare s private.orbitfs_fallback_oauth_settings%rowtype;
begin
 if not (public.has_permission('licenses.manage') or public.has_permission('license_api.manage')) then raise exception 'permission denied'; end if;
 update private.orbitfs_fallback_oauth_settings set
  supabase_oauth_enabled=coalesce((p_patch->>'supabase_oauth_enabled')::boolean,supabase_oauth_enabled),
  vercel_oauth_enabled=coalesce((p_patch->>'vercel_oauth_enabled')::boolean,vercel_oauth_enabled),
  supabase_client_id=case when p_patch?'supabase_client_id' then nullif(btrim(p_patch->>'supabase_client_id'),'') else supabase_client_id end,
  vercel_client_id=case when p_patch?'vercel_client_id' then nullif(btrim(p_patch->>'vercel_client_id'),'') else vercel_client_id end,
  vercel_install_url=case when p_patch?'vercel_install_url' then nullif(btrim(p_patch->>'vercel_install_url'),'') else vercel_install_url end,
  supabase_scopes=case when p_patch?'supabase_scopes' then nullif(btrim(p_patch->>'supabase_scopes'),'') else supabase_scopes end
 where id='fallback' returning * into s;
 return to_jsonb(s);
end $$;
revoke all on function public.admin_update_orbitfs_fallback_oauth_settings(jsonb) from public;
grant execute on function public.admin_update_orbitfs_fallback_oauth_settings(jsonb) to authenticated;
-- Extend the existing write-only Vault interface to accept strictly named fallback secrets.
create or replace function public.admin_store_orbitfs_release_secret(p_key text,p_value text)
returns jsonb language plpgsql security definer set search_path=public,private,vault as $$
declare sid uuid;
begin
 if not (public.has_permission('licenses.manage') or public.has_permission('license_api.manage')) then raise exception 'permission denied'; end if;
 if p_key not in ('supabase_client_secret','vercel_client_secret','fallback_supabase_client_secret','fallback_vercel_client_secret','panel_publish_token','engine_publish_token','github_release_token') then raise exception 'unsupported secret'; end if;
 if nullif(btrim(coalesce(p_value,'')),'') is null then raise exception 'secret value required'; end if;
 select secret_id into sid from private.orbitfs_release_secret_refs where key=p_key for update;
 if sid is null then sid:=vault.create_secret(p_value,'orbitfs_release_'||p_key,'OrbitFS release system credential',null);
 else perform vault.update_secret(sid,p_value,'orbitfs_release_'||p_key,'OrbitFS release system credential',null); end if;
 insert into private.orbitfs_release_secret_refs(key,secret_id,updated_at) values(p_key,sid,now())
 on conflict(key) do update set secret_id=excluded.secret_id,updated_at=now();
 return jsonb_build_object('ok',true,'key',p_key,'configured',true);
end $$;
revoke all on function public.admin_store_orbitfs_release_secret(text,text) from public;
grant execute on function public.admin_store_orbitfs_release_secret(text,text) to authenticated;

-- Server-side read only: API role used by Billing may read private OAuth settings.
create or replace function public.service_orbitfs_fallback_oauth_settings()
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare s private.orbitfs_fallback_oauth_settings%rowtype;
begin
 if auth.role() <> 'service_role' then raise exception 'permission denied'; end if;
 select * into s from private.orbitfs_fallback_oauth_settings where id='fallback';
 return to_jsonb(s);
end $$;
revoke all on function public.service_orbitfs_fallback_oauth_settings() from public,anon,authenticated;
grant execute on function public.service_orbitfs_fallback_oauth_settings() to service_role;
