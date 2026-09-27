-- Restore autonomous transactional mail dispatch.
-- The outbox and tokenized delivery endpoint already exist; this migration restores
-- the missing pg_net/pg_cron runtime pieces and prevents historical backlog spam.

create extension if not exists pg_net;
create extension if not exists pg_cron;

create or replace function public.dispatch_mail_event_outbox()
returns integer
language plpgsql
security definer
set search_path to 'public', 'net'
as $function$
declare
  r record;
  n integer:=0;
  v_site text;
begin
  select rtrim(coalesce(value #>> '{}','https://orbitfs.cc'),'/')
    into v_site
    from public.app_settings
    where key='site.public_url';
  v_site:=coalesce(nullif(v_site,''),'https://orbitfs.cc');

  update public.mail_event_outbox
    set state='failed',
        last_error=coalesce(last_error,'Processing timed out'),
        next_attempt_at=now()
    where state='processing' and next_attempt_at<=now();

  for r in
    select id,dispatch_token
    from public.mail_event_outbox
    where state in ('pending','failed')
      and next_attempt_at<=now()
      and attempts<10
    order by created_at
    limit 25
    for update skip locked
  loop
    update public.mail_event_outbox
      set state='processing',
          attempts=attempts+1,
          last_error=null,
          next_attempt_at=now()+interval '5 minutes'
      where id=r.id;

    perform net.http_post(
      url:=v_site||'/api/mail/outbox',
      body:=jsonb_build_object('id',r.id,'token',r.dispatch_token),
      headers:='{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds:=15000
    );
    n:=n+1;
  end loop;

  return n;
end
$function$;

do $$
declare
  existing_job bigint;
begin
  for existing_job in
    select jobid from cron.job where jobname='orbitfs-mail-outbox-dispatch'
  loop
    perform cron.unschedule(existing_job);
  end loop;

  perform cron.schedule(
    'orbitfs-mail-outbox-dispatch',
    '* * * * *',
    'select public.dispatch_mail_event_outbox();'
  );
end
$$;

-- Do not suddenly send very old transactional events after restoring the worker.
-- Keep them visible for audit, but make them terminal so the scheduler ignores them.
update public.mail_event_outbox
set state='failed',
    attempts=10,
    last_error=coalesce(last_error,'Expired during mail queue repair after more than 24 hours without dispatch'),
    next_attempt_at=now()
where state in ('pending','processing','failed')
  and processed_at is null
  and created_at < now()-interval '24 hours';
