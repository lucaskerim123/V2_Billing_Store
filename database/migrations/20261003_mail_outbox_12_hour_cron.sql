-- Fallback Billing mail outbox should remain idle most of the time.
-- Run scheduled dispatch twice per day; operators can use the Mail Queue
-- "Process queue now" button for immediate manual processing.

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
    '0 */12 * * *',
    'select public.dispatch_mail_event_outbox();'
  );
end $$;
