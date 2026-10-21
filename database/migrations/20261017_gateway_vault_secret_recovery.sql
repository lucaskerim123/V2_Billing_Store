-- Forward repair: reuse existing named Vault secrets after lost gateway references.
-- Applying this migration only replaces RPC definitions; it does not change
-- or decrypt any existing payment credential.
create or replace function public.admin_store_gateway_secret(
 p_gateway_code text,p_key text,p_value text
) returns jsonb language plpgsql security definer set search_path=public,vault as $$
declare gid uuid; sid uuid; named_sid uuid; refs jsonb; secname text;
begin
 if coalesce(auth.role(),'') <> 'service_role'
    and not public.has_permission('payment_gateways.manage') then
  raise exception 'permission denied';
 end if;
 if nullif(btrim(coalesce(p_value,'')),'') is null then
  raise exception 'secret value required';
 end if;
 if coalesce(p_key,'') not in ('secret_key','webhook_secret','client_id','client_secret','webhook_id') then
  raise exception 'unsupported secret key';
 end if;
 select id into gid from public.payment_gateways where code=p_gateway_code;
 if gid is null then raise exception 'gateway not found'; end if;
 insert into public.payment_gateway_setups(gateway_id,updated_by)
  values(gid,auth.uid()) on conflict(gateway_id) do nothing;
 select secret_refs into refs from public.payment_gateway_setups
  where gateway_id=gid for update;
 sid:=nullif(refs->>p_key,'')::uuid;
 secname:='orbitfs_gateway_'||regexp_replace(p_gateway_code,'[^a-zA-Z0-9_]+','_','g')||'_'||p_key;
 -- The unique name is canonical, even if the JSON reference was lost.
 select id into named_sid from vault.secrets where name=secname;
 if named_sid is not null then
  sid:=named_sid;
  perform vault.update_secret(sid,p_value,secname,'OrbitFS payment gateway secret',null);
 elsif sid is not null
   and exists(select 1 from vault.secrets where id=sid and name is null) then
  perform vault.update_secret(sid,p_value,secname,'OrbitFS payment gateway secret',null);
 else
  sid:=vault.create_secret(p_value,secname,'OrbitFS payment gateway secret',null);
 end if;
 update public.payment_gateway_setups
  set secret_refs=jsonb_set(coalesce(secret_refs,'{}'::jsonb),array[p_key],to_jsonb(sid::text),true),
      setup_status='credentials_saved',last_verify_error=null,
      updated_by=auth.uid(),updated_at=now()
  where gateway_id=gid;
 return jsonb_build_object('ok',true,'key',p_key,'configured',true);
end $$;

-- An explicit Remove action should delete its canonical credential as well
-- as its JSON reference. Never delete a differently named Vault entry.
create or replace function public.admin_remove_gateway_secret(
 p_gateway_code text,p_key text
) returns jsonb language plpgsql security definer set search_path=public,vault as $$
declare gid uuid; sid uuid; refs jsonb; secname text;
begin
 if not public.has_permission('payment_gateways.manage') then
  raise exception 'permission denied';
 end if;
 if coalesce(p_key,'') not in ('secret_key','webhook_secret','client_id','client_secret','webhook_id') then
  raise exception 'unsupported secret key';
 end if;
 select id into gid from public.payment_gateways where code=p_gateway_code;
 if gid is null then raise exception 'gateway not found'; end if;
 select secret_refs into refs from public.payment_gateway_setups
  where gateway_id=gid for update;
 sid:=nullif(refs->>p_key,'')::uuid;
 secname:='orbitfs_gateway_'||regexp_replace(p_gateway_code,'[^a-zA-Z0-9_]+','_','g')||'_'||p_key;
 if sid is not null then
  delete from vault.secrets where id=sid and name=secname;
 end if;
 update public.payment_gateway_setups
  set secret_refs=coalesce(secret_refs,'{}'::jsonb)-p_key,
      setup_status='credentials_saved',last_verified_at=null,
      last_verify_error=null,updated_by=auth.uid(),updated_at=now()
  where gateway_id=gid;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.admin_store_gateway_secret(text,text,text) from public,anon;
revoke all on function public.admin_remove_gateway_secret(text,text) from public,anon;
grant execute on function public.admin_store_gateway_secret(text,text,text) to authenticated,service_role;
grant execute on function public.admin_remove_gateway_secret(text,text) to authenticated,service_role;
