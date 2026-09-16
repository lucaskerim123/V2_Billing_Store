-- OrbitFS License Master authority wiring.
-- Safe to re-run: all changes are idempotent/upserts.
-- Runtime contract: https://incendiarynetworks.cc/api
-- Licensed products: orbitfs_base, orbitfs_apex, orbitfs_mcp, orbitfs_studio.
-- This migration never creates or stores plaintext License Master keys.

SET statement_timeout='5000ms';

CREATE UNIQUE INDEX IF NOT EXISTS license_fulfillments_order_item_uidx
  ON public.license_fulfillments(order_item_id);

INSERT INTO public.products (id,name,slug,license_product_key,active,currency,license_api_url,license_api_mode,license_api_enabled,approval_mode,metadata)
VALUES
  (gen_random_uuid(),'OrbitFS Base','orbitfs-base','orbitfs_base',true,'AUD','https://incendiarynetworks.cc/api','master',true,'automatic','{"license_authority":"orbitfs-license-master-v2"}'::jsonb),
  (gen_random_uuid(),'OrbitFS APEX','orbitfs-apex','orbitfs_apex',true,'AUD','https://incendiarynetworks.cc/api','master',true,'automatic','{"license_authority":"orbitfs-license-master-v2"}'::jsonb),
  (gen_random_uuid(),'OrbitFS MCP','orbitfs-mcp','orbitfs_mcp',true,'AUD','https://incendiarynetworks.cc/api','master',true,'automatic','{"license_authority":"orbitfs-license-master-v2"}'::jsonb),
  (gen_random_uuid(),'OrbitFS Studio','orbitfs-studio','orbitfs_studio',true,'AUD','https://incendiarynetworks.cc/api','master',true,'automatic','{"license_authority":"orbitfs-license-master-v2"}'::jsonb)
ON CONFLICT (license_product_key) DO UPDATE SET
  name=excluded.name,
  active=true,
  license_api_url=excluded.license_api_url,
  license_api_mode='master',
  license_api_enabled=true,
  metadata=coalesce(public.products.metadata,'{}'::jsonb)||excluded.metadata;

UPDATE public.license_api_settings
SET api_name='OrbitFS Licence API',
    base_url='https://incendiarynetworks.cc/api',
    mode='master',
    enabled=true,
    validation_path='/license/validate',
    registration_path='/license/issue',
    activation_path='/license/{id}/control',
    revision_path='/health',
    health_path='/health',
    issuer='orbitfs-license-master',
    audience='orbitfs-runtime',
    entitlement_ttl_seconds=3600,
    grace_seconds=0,
    max_failed_validations=5,
    allow_offline_grace=false,
    updated_at=now()
WHERE true;

INSERT INTO public.license_api_settings (api_name,base_url,mode,enabled,validation_path,registration_path,activation_path,revision_path,health_path,issuer,audience,entitlement_ttl_seconds,grace_seconds,max_failed_validations,allow_offline_grace)
SELECT 'OrbitFS Licence API','https://incendiarynetworks.cc/api','master',true,'/license/validate','/license/issue','/license/{id}/control','/health','/health','orbitfs-license-master','orbitfs-runtime',3600,0,5,false
WHERE NOT EXISTS (SELECT 1 FROM public.license_api_settings);

UPDATE public.license_master_connection
SET master_url='https://incendiarynetworks.cc/api',
    enabled=true,
    last_error=NULL,
    updated_at=now()
WHERE id=(SELECT id FROM public.license_master_connection ORDER BY updated_at DESC NULLS LAST LIMIT 1);

-- The database only queues/records fulfilment; License Master issues the real key.
-- Keep this function bounded and never generate a local licence key here.
CREATE OR REPLACE FUNCTION public.grant_paid_order_entitlements_core(p_order_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare r record; fid uuid; product_key text; found_items integer := 0;
begin
  for r in
    select oi.id,oi.order_id,oi.product_id,oi.license_product_key,oi.configuration,oi.quantity
    from public.order_items oi
    where oi.order_id=p_order_id
    order by oi.id
    limit 20
  loop
    if coalesce((r.configuration->>'gift')::boolean,false) then continue; end if;
    product_key:=case lower(coalesce(r.license_product_key,'')) when 'orbitfs_panel' then 'orbitfs_base' when 'orbitfs_sorter' then 'orbitfs_apex' else lower(coalesce(r.license_product_key,'')) end;
    if product_key not in ('orbitfs_base','orbitfs_apex','orbitfs_mcp','orbitfs_studio') then continue; end if;
    found_items:=found_items+1;
    select lf.id into fid from public.license_fulfillments lf where lf.order_item_id=r.id limit 1;
    if fid is null then
      insert into public.license_fulfillments(order_id,order_item_id,auth_user_id,state,metadata)
      values(r.order_id,r.id,p_user_id,'pending',jsonb_build_object('license_product_key',product_key,'quantity',greatest(1,coalesce(r.quantity,1)),'authority','orbitfs-license-master-v2'))
      returning id into fid;
    else
      update public.license_fulfillments set state=case when state='fulfilled' then state else 'pending' end,last_error=case when state='fulfilled' then last_error else null end,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('license_product_key',product_key,'quantity',greatest(1,coalesce(r.quantity,1)),'authority','orbitfs-license-master-v2'),updated_at=now() where id=fid;
    end if;
  end loop;
  update public.orders set fulfillment_status=case when found_items>0 then 'queued' else fulfillment_status end,updated_at=now() where id=p_order_id;
end
$function$;
