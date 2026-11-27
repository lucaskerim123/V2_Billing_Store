-- Retire the legacy Billing Store mail system without deleting historical records.
-- Mail templates, automation mappings, queued deliveries and scheduled dispatch are disabled.

update public.mail_automations
set enabled = false,
    updated_at = now();

update public.mail_templates
set enabled = false,
    updated_at = now();

update public.mail_event_outbox
set state = 'failed',
    last_error = 'Legacy mail system retired; pending delivery discarded.',
    processed_at = now()
where state in ('pending', 'processing');

-- Stop customer-created events from continuing to populate the retired mail queue.
drop trigger if exists trg_mail_customer_created on public.customers;

-- Remove any pg_cron dispatcher installed by the legacy mail system.
do $$
declare
  v_job_id bigint;
begin
  if to_regclass('cron.job') is not null then
    for v_job_id in execute
      'select jobid from cron.job where jobname = $1 or command ilike $2'
      using 'orbitfs-mail-outbox-dispatch', '%dispatch_mail_event_outbox%'
    loop
      execute 'select cron.unschedule($1)' using v_job_id;
    end loop;
  end if;
end $$;
