-- Protect all application-owned built-in theme IDs, including V6A.
create or replace function public.orbitfs_theme_import(p_manifest jsonb,p_css text) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare tid text; tname text; tsurface text; tversion text;
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  tid:=nullif(trim(p_manifest->>'id'),'');
  tname:=coalesce(nullif(trim(p_manifest->>'name'),''),tid);
  tsurface:=nullif(trim(p_manifest->>'surface'),'');
  tversion:=coalesce(nullif(trim(p_manifest->>'version'),''),'1.0.0');
  if tid is null or tsurface not in ('admin','customer') then raise exception 'invalid theme manifest'; end if;
  if tid in ('V3A','V3C','V5A','V5C','V6A','V6C') then raise exception 'built-in theme IDs cannot be overwritten'; end if;
  if coalesce(length(p_css),0)<20 then raise exception 'theme CSS is empty'; end if;
  insert into public.orbitfs_themes(id,name,surface,version,description,manifest,css_text,is_builtin,updated_at)
  values(tid,tname,tsurface,tversion,coalesce(p_manifest->>'description',''),p_manifest,p_css,false,now())
  on conflict(id) do update set
    name=excluded.name,surface=excluded.surface,version=excluded.version,
    description=excluded.description,manifest=excluded.manifest,css_text=excluded.css_text,is_builtin=false,updated_at=now();
  return jsonb_build_object('ok',true,'theme_id',tid,'surface',tsurface);
end $$;
