-- A reactivated deduplicated notification must require acknowledgement again.
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
