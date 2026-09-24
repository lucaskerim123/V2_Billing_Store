-- Route gateway canonical-sync through the configured Billing Store origin.
-- This prevents rebuilt databases from calling an obsolete Supabase project URL.

insert into public.app_settings(key,value,category,public_read,updated_at)
select 'internal.gateway_sync_token',
       to_jsonb(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','')),
       'internal',false,now()
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
        url := rtrim(coalesce(
          (select value #>> '{}' from public.app_settings where key='site.public_url'),
          (select value #>> '{}' from public.app_settings where key='site.website_url'),
          ''
        ),'/') || '/api/cron/payment-gateway-sync',
        body := '{}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-orbitfs-sync-token',(select value #>> '{}' from public.app_settings where key='internal.gateway_sync_token')
        ),
        timeout_milliseconds := 15000
      )
      where nullif(rtrim(coalesce(
        (select value #>> '{}' from public.app_settings where key='site.public_url'),
        (select value #>> '{}' from public.app_settings where key='site.website_url'),
        ''
      ),'/'),'') is not null
    $job$
  );
end $$;
