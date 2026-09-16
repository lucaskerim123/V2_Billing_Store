-- Keep provider-side payment webhooks aligned with the canonical OrbitFS Store URL.
-- The Edge Function authenticates cron requests with this private database-held token.
-- The Store database was rebuilt; this migration must target the rebuilt Supabase project.

insert into public.app_settings(key,value,category,public_read,updated_at)
select
  'internal.gateway_sync_token',
  to_jsonb(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','')),
  'internal',
  false,
  now()
where not exists(select 1 from public.app_settings where key='internal.gateway_sync_token');

do $$
declare jid bigint;
begin
  select jobid into jid from cron.job where jobname='orbitfs-gateway-canonical-sync' limit 1;
  if jid is not null then perform cron.unschedule(jid); end if;

  perform cron.schedule(
    'orbitfs-gateway-canonical-sync',
    '17 */6 * * *',
    $job$
      select net.http_post(
        url := 'https://xwbjfhpgsvsjaykelufa.supabase.co/functions/v1/payment-gateway-canonical-sync',
        body := '{}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-orbitfs-sync-token',(select value #>> '{}' from public.app_settings where key='internal.gateway_sync_token')
        ),
        timeout_milliseconds := 15000
      )
    $job$
  );
end $$;
