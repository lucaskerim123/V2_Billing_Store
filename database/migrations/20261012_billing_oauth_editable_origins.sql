-- Billing-owned OAuth callback origins, separate from canonical commerce site URL.
create table if not exists private.orbitfs_oauth_callback_origins (
 mode text primary key check(mode in ('main','fallback')),
 origin text not null check(origin ~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$')
);
insert into private.orbitfs_oauth_callback_origins(mode,origin) values
 ('main','https://orbitfsstore.vercel.app'),
 ('fallback','https://billing.incendiarynetworks.cc')
on conflict(mode) do nothing;
revoke all on private.orbitfs_oauth_callback_origins from public,anon,authenticated;

create or replace function public.admin_orbitfs_oauth_callback_origin(p_mode text)
returns text language plpgsql security definer set search_path=public,private as $$
declare result text;
begin
 if not public.has_permission('licenses.view') then raise exception 'permission denied'; end if;
 if p_mode not in ('main','fallback') then raise exception 'invalid OAuth mode'; end if;
 select origin into result from private.orbitfs_oauth_callback_origins where mode=p_mode;
 return result;
end $$;
revoke all on function public.admin_orbitfs_oauth_callback_origin(text) from public,anon;
grant execute on function public.admin_orbitfs_oauth_callback_origin(text) to authenticated;

create or replace function public.admin_set_orbitfs_oauth_callback_origin(p_mode text,p_origin text)
returns text language plpgsql security definer set search_path=public,private as $$
declare cleaned text:=rtrim(btrim(coalesce(p_origin,'')),'/');
begin
 if not (public.has_permission('licenses.manage') or public.has_permission('license_api.manage')) then raise exception 'permission denied'; end if;
 if p_mode not in ('main','fallback') then raise exception 'invalid OAuth mode'; end if;
 if cleaned !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$' then raise exception 'OAuth origin must be a full HTTPS host without a path'; end if;
 insert into private.orbitfs_oauth_callback_origins(mode,origin) values(p_mode,cleaned)
 on conflict(mode) do update set origin=excluded.origin;
 return cleaned;
end $$;
revoke all on function public.admin_set_orbitfs_oauth_callback_origin(text,text) from public,anon;
grant execute on function public.admin_set_orbitfs_oauth_callback_origin(text,text) to authenticated;

create or replace function public.service_orbitfs_oauth_callback_origin(p_mode text)
returns text language plpgsql security definer set search_path=public,private as $$
declare result text;
begin
 if auth.role()<>'service_role' then raise exception 'service role required'; end if;
 if p_mode not in ('main','fallback') then raise exception 'invalid OAuth mode'; end if;
 select origin into result from private.orbitfs_oauth_callback_origins where mode=p_mode;
 return result;
end $$;
revoke all on function public.service_orbitfs_oauth_callback_origin(text) from public,anon,authenticated;
grant execute on function public.service_orbitfs_oauth_callback_origin(text) to service_role;
