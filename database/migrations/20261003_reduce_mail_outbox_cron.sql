-- The mail outbox retries rows on a five-minute cadence, so a one-minute
-- scheduler only creates empty cron work. Match the scheduler to the retry window.
do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname='orbitfs-mail-outbox-dispatch'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'orbitfs-mail-outbox-dispatch',
    '*/5 * * * *',
    'select public.dispatch_mail_event_outbox();'
  );
end $$;
