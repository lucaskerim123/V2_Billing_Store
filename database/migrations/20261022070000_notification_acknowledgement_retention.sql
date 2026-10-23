-- OrbitFS notification acknowledgement + retention lifecycle.
-- Reading is not acknowledgement.
-- Acknowledged notifications are hard-deleted after 3 days unless the recipient saved them.
-- Saved notifications remain until the recipient explicitly unsaves them (then normal retention applies).

alter table public.notifications
  add column if not exists acknowledged_at timestamptz,
  add column if not exists saved_at timestamptz;

create index if not exists notifications_acknowledged_retention_idx
  on public.notifications(acknowledged_at)
  where acknowledged_at is not null and saved_at is null;

create or replace function public.notification_acknowledge(
  p_notification_id uuid,
  p_acknowledged boolean default true
) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare
  changed integer;
  ack_time timestamptz;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  update public.notifications
  set
    acknowledged_at=case when coalesce(p_acknowledged,true) then coalesce(acknowledged_at,now()) else null end,
    read_at=case when coalesce(p_acknowledged,true) then coalesce(read_at,now()) else read_at end
  where id=p_notification_id and recipient_user_id=auth.uid()
  returning acknowledged_at into ack_time;

  get diagnostics changed=row_count;
  if changed=0 then raise exception 'notification not found'; end if;

  return jsonb_build_object(
    'ok',true,
    'acknowledged',coalesce(p_acknowledged,true),
    'acknowledged_at',ack_time
  );
end $$;

revoke all on function public.notification_acknowledge(uuid,boolean) from public,anon;
grant execute on function public.notification_acknowledge(uuid,boolean) to authenticated;

create or replace function public.notification_set_saved(
  p_notification_id uuid,
  p_saved boolean default true
) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare
  changed integer;
  saved_time timestamptz;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  update public.notifications
  set saved_at=case when coalesce(p_saved,true) then coalesce(saved_at,now()) else null end
  where id=p_notification_id and recipient_user_id=auth.uid()
  returning saved_at into saved_time;

  get diagnostics changed=row_count;
  if changed=0 then raise exception 'notification not found'; end if;

  return jsonb_build_object(
    'ok',true,
    'saved',coalesce(p_saved,true),
    'saved_at',saved_time
  );
end $$;

revoke all on function public.notification_set_saved(uuid,boolean) from public,anon;
grant execute on function public.notification_set_saved(uuid,boolean) to authenticated;

create or replace function public.notification_cleanup_expired() returns integer
language plpgsql security definer set search_path='public' as $$
declare
  changed integer;
begin
  delete from public.notifications
  where acknowledged_at is not null
    and acknowledged_at <= now() - interval '3 days'
    and saved_at is null;
  get diagnostics changed=row_count;
  return changed;
end $$;

revoke all on function public.notification_cleanup_expired() from public,anon,authenticated;

create or replace function public.notification_feed(p_surface text, p_limit integer default 40) returns jsonb
language plpgsql security definer set search_path='public' as $$
declare
  uid uuid:=auth.uid();
  rows_json jsonb;
  unread_count integer;
  safe_limit integer;
begin
  if uid is null then raise exception 'authentication required'; end if;
  if p_surface not in ('admin','portal') then raise exception 'invalid notification surface'; end if;
  safe_limit:=greatest(1,least(coalesce(p_limit,40),100));

  -- Guarantee the signed-in user never sees acknowledged notifications whose
  -- retention period has already elapsed, even if the scheduled cleanup was delayed.
  delete from public.notifications
  where recipient_user_id=uid
    and acknowledged_at is not null
    and acknowledged_at <= now() - interval '3 days'
    and saved_at is null;

  select count(*)::integer into unread_count
  from public.notifications
  where recipient_user_id=uid
    and surface=p_surface
    and read_at is null
    and archived_at is null;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into rows_json
  from (
    select
      id,category,event_type,title,message,severity,actor_user_id,source_type,source_id,
      action_url,metadata,read_at,acknowledged_at,saved_at,created_at
    from public.notifications
    where recipient_user_id=uid
      and surface=p_surface
      and archived_at is null
    order by created_at desc
    limit safe_limit
  ) x;

  return jsonb_build_object('notifications',rows_json,'unread_count',unread_count);
end $$;

grant execute on function public.notification_feed(text,integer) to authenticated;

-- Reset acknowledgement when a deduplicated event becomes active again.
-- A recipient's saved state is intentionally retained.
create or replace function public.notification_emit(
  p_recipient_user_id uuid,
  p_surface text,
  p_category text,
  p_event_type text,
  p_title text,
  p_message text default '',
  p_severity text default 'info',
  p_actor_user_id uuid default null,
  p_source_type text default null,
  p_source_id text default null,
  p_action_url text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_dedupe_key text default null
) returns uuid
language plpgsql security definer set search_path='public','auth' as $$
declare nid uuid;
begin
  if p_recipient_user_id is null or not exists(select 1 from auth.users where id=p_recipient_user_id) then return null; end if;
  if p_surface not in ('admin','portal') then raise exception 'invalid notification surface'; end if;
  if p_severity not in ('info','success','warning','error') then raise exception 'invalid notification severity'; end if;
  if nullif(btrim(coalesce(p_title,'')),'') is null then raise exception 'notification title is required'; end if;

  insert into public.notifications(
    recipient_user_id,surface,category,event_type,title,message,severity,actor_user_id,
    source_type,source_id,action_url,metadata,dedupe_key
  ) values(
    p_recipient_user_id,p_surface,coalesce(nullif(btrim(p_category),''),'general'),p_event_type,
    btrim(p_title),coalesce(p_message,''),p_severity,p_actor_user_id,
    p_source_type,p_source_id,p_action_url,coalesce(p_metadata,'{}'::jsonb),p_dedupe_key
  )
  on conflict (recipient_user_id,surface,dedupe_key) where dedupe_key is not null
  do update set
    category=excluded.category,
    event_type=excluded.event_type,
    title=excluded.title,
    message=excluded.message,
    severity=excluded.severity,
    actor_user_id=excluded.actor_user_id,
    source_type=excluded.source_type,
    source_id=excluded.source_id,
    action_url=excluded.action_url,
    metadata=excluded.metadata,
    read_at=null,
    acknowledged_at=null,
    archived_at=null,
    created_at=now()
  returning id into nid;
  return nid;
end $$;

revoke all on function public.notification_emit(uuid,text,text,text,text,text,text,uuid,text,text,text,jsonb,text) from public,anon,authenticated;

-- Global cleanup keeps old acknowledged notifications from accumulating even
-- when a user does not open the notification centre again.
do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname='orbitfs-notification-retention-cleanup'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'orbitfs-notification-retention-cleanup',
    '17 * * * *',
    'select public.notification_cleanup_expired();'
  );
end $$;
