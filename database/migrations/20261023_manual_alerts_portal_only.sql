-- Manual Alert System messages deliver only to customer portal; operational admin events retain admin feed.
create or replace function public.orbitfs_alert_preview(
  p_audience text,
  p_recipient_user_ids uuid[] default null,
  p_conditions jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path='public','auth' as $$
declare
  total integer:=0;
  sample_json jsonb:='[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not public.has_permission('notifications.send') then raise exception 'permission denied'; end if;
  if p_audience not in ('selected','customers','staff','everyone') then raise exception 'invalid audience'; end if;

  select count(distinct user_id) into total
  from public.orbitfs_alert_candidate_recipients(p_audience,p_recipient_user_ids,coalesce(p_conditions,'{}'::jsonb)) where surface='portal';

  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into sample_json
  from (
    select user_id,surface,label,email
    from public.orbitfs_alert_candidate_recipients(p_audience,p_recipient_user_ids,coalesce(p_conditions,'{}'::jsonb))
    where surface='portal'
    order by label,email
    limit 8
  ) x;

  return jsonb_build_object('count',total,'sample',sample_json);
end $$;

create or replace function public.orbitfs_alert_send(
  p_audience text,
  p_recipient_user_ids uuid[] default null,
  p_kind text default 'notification',
  p_title text default '',
  p_message text default '',
  p_severity text default 'info',
  p_action_url text default null,
  p_conditions jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path='public','auth' as $$
declare
  actor uuid:=auth.uid();
  dispatch_id uuid:=gen_random_uuid();
  sent integer:=0;
  r record;
  clean_title text:=btrim(coalesce(p_title,''));
  clean_message text:=btrim(coalesce(p_message,''));
  clean_action text:=nullif(btrim(coalesce(p_action_url,'')),'');
  actor_email text;
  system_enabled boolean:=true;
  manual_enabled boolean:=true;
  type_enabled boolean:=true;
  links_enabled boolean:=true;
  max_message integer:=4000;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if not public.has_permission('notifications.send') then raise exception 'permission denied'; end if;
  if p_audience not in ('selected','customers','staff','everyone') then raise exception 'invalid audience'; end if;
  if p_kind not in ('notification','message','alert','announcement','maintenance') then raise exception 'invalid alert type'; end if;
  if p_severity not in ('info','success','warning','error') then raise exception 'invalid severity'; end if;

  select coalesce((select (value#>>'{}')::boolean from public.app_settings where key='alerts.enabled'),true) into system_enabled;
  select coalesce((select (value#>>'{}')::boolean from public.app_settings where key='alerts.manual_send_enabled'),true) into manual_enabled;
  select coalesce((select (value#>>'{}')::boolean from public.app_settings where key='alerts.action_links_enabled'),true) into links_enabled;
  select coalesce((select (value#>>'{}')::boolean from public.app_settings where key='alerts.type_'||p_kind||'_enabled'),true) into type_enabled;
  select greatest(100,least(4000,coalesce((select (value#>>'{}')::integer from public.app_settings where key='alerts.max_message_length'),4000))) into max_message;

  if not system_enabled then raise exception 'OrbitFS Alert System is disabled'; end if;
  if not manual_enabled then raise exception 'manual alert sending is disabled'; end if;
  if not type_enabled then raise exception '% alerts are disabled',p_kind; end if;
  if clean_title='' then raise exception 'title is required'; end if;
  if length(clean_title)>160 then raise exception 'title is too long'; end if;
  if length(clean_message)>max_message then raise exception 'message exceeds configured limit of % characters',max_message; end if;
  if clean_action is not null and not links_enabled then raise exception 'alert action links are disabled'; end if;
  if clean_action is not null and (left(clean_action,1)<>'/' or left(clean_action,2)='//') then
    raise exception 'action path must be a local OrbitFS path';
  end if;
  if p_audience='selected' and coalesce(array_length(p_recipient_user_ids,1),0)=0 then
    raise exception 'select at least one recipient';
  end if;

  for r in
    select * from public.orbitfs_alert_candidate_recipients(
      p_audience,p_recipient_user_ids,coalesce(p_conditions,'{}'::jsonb)
    )
  loop
    -- Manually authored Alert System messages are customer communications only.
    -- Staff accounts with customer profiles receive their copy in the customer portal.
    if r.surface <> 'portal' then continue; end if;
    perform public.notification_emit(
      r.user_id,
      r.surface,
      'orbitfs_alert',
      'orbitfs.alert.manual.'||p_kind,
      clean_title,
      clean_message,
      p_severity,
      actor,
      'orbitfs_alert_dispatch',
      dispatch_id::text,
      clean_action,
      jsonb_build_object(
        'manual',true,
        'kind',p_kind,
        'dispatch_id',dispatch_id,
        'audience',p_audience,
        'conditions',coalesce(p_conditions,'{}'::jsonb)
      ),
      'orbitfs-alert-'||dispatch_id::text||'-'||r.user_id::text
    );
    sent:=sent+1;
  end loop;

  select email into actor_email from auth.users where id=actor;
  insert into public.admin_audit_log(actor_id,actor_email,action,target_type,target_id,detail)
  values(
    actor,actor_email,'orbitfs.alert.send','orbitfs_alert_dispatch',dispatch_id::text,
    jsonb_build_object(
      'audience',p_audience,
      'kind',p_kind,
      'severity',p_severity,
      'title',clean_title,
      'action_url',clean_action,
      'conditions',coalesce(p_conditions,'{}'::jsonb),
      'sent',sent,
      'selected_count',coalesce(array_length(p_recipient_user_ids,1),0)
    )
  );

  return jsonb_build_object('ok',true,'dispatch_id',dispatch_id,'sent',sent);
end $$;

