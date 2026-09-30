-- Customer mail subscriptions. Billing owns email presentation, event categorisation and
-- customer preferences; License Manager continues to own release/deployment truth.
-- Absence of a customer override means the configured default (on for every seeded category).

create table if not exists public.mail_subscription_categories (
  category_key text primary key check (category_key ~ '^[a-z][a-z0-9_]{1,47}$'),
  label text not null check (length(btrim(label)) between 2 and 80),
  description text not null default '',
  required boolean not null default false,
  default_subscribed boolean not null default true,
  enabled boolean not null default true,
  sort_order integer not null default 100,
  updated_at timestamptz not null default now(),
  constraint system_subscription_immutable check (
    category_key <> 'system' or (required and default_subscribed and enabled)
  )
);

create table if not exists public.mail_subscription_events (
  event_key text primary key,
  category_key text not null references public.mail_subscription_categories(category_key) on delete restrict,
  updated_at timestamptz not null default now()
);

create table if not exists public.mail_customer_subscriptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  category_key text not null references public.mail_subscription_categories(category_key) on delete cascade,
  subscribed boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id,category_key)
);
create index if not exists mail_customer_subscription_category_idx
  on public.mail_customer_subscriptions(category_key,user_id);

insert into public.mail_subscription_categories
  (category_key,label,description,required,default_subscribed,enabled,sort_order)
values
  ('system','System & security','Required account notices, sign-in and security alerts, invoices, payment receipts, service or licence restrictions, and deployment problems.',true,true,true,0),
  ('updates_available','New updates available','Receive a message when a new eligible OrbitFS update is available for your release channel.',false,true,true,10),
  ('product_updates','Product updates','Product improvements, new features and customer-facing release announcements.',false,true,true,20),
  ('news','OrbitFS news','General OrbitFS news and announcements.',false,true,true,30),
  ('deployments','Deployment progress','Optional ready, started and completed deployment updates. Failures and action-required notices are always sent.',false,true,true,40),
  ('support','Support updates','Replies, status changes and reopened support tickets. Your ticket creation receipt remains mandatory.',false,true,true,50),
  ('orders','Order & licence activity','Optional service activation and restoration updates. Order confirmations, invoices and account-critical notices are always sent.',false,true,true,60)
on conflict (category_key) do nothing;

-- New newsletter templates use the same mail_templates and mail_automations
-- structures as transactional/deployment templates, so both admin surfaces list them.
insert into public.mail_templates
  (template_key,name,category,subject,html,text_body,from_account,enabled)
values
  ('news.general_news','OrbitFS news','news',
    'OrbitFS News: {{news_title}}',
    '<p>Hi {{customer_name}},</p><h2>{{news_title}}</h2><p>{{news_excerpt}}</p><p><a href="{{news_url}}">Read the update</a></p><p style="font-size:12px"><a href="{{site_url}}/portal/settings?tab=preferences">Manage email preferences</a></p>',
    'Hi {{customer_name}},\n\n{{news_title}}\n\n{{news_excerpt}}\n\nRead more: {{news_url}}\n\nManage email preferences: {{site_url}}/portal/settings?tab=preferences',
    'role:system',true),
  ('news.announcement','OrbitFS announcement','news',
    'OrbitFS Announcement: {{news_title}}',
    '<p>Hi {{customer_name}},</p><h2>{{news_title}}</h2><p>{{news_excerpt}}</p><p><a href="{{news_url}}">Read the announcement</a></p><p style="font-size:12px"><a href="{{site_url}}/portal/settings?tab=preferences">Manage email preferences</a></p>',
    'Hi {{customer_name}},\n\n{{news_title}}\n\n{{news_excerpt}}\n\nRead announcement: {{news_url}}\n\nManage email preferences: {{site_url}}/portal/settings?tab=preferences',
    'role:system',true),
  ('news.product_updates','OrbitFS product news','product_updates',
    '{{product_name}}: {{news_title}}',
    '<p>Hi {{customer_name}},</p><h2>{{news_title}}</h2><p>{{news_excerpt}}</p><p><a href="{{news_url}}">Read the product update</a></p><p style="font-size:12px"><a href="{{site_url}}/portal/settings?tab=preferences">Manage email preferences</a></p>',
    'Hi {{customer_name}},\n\n{{product_name}}: {{news_title}}\n\n{{news_excerpt}}\n\nRead the product update: {{news_url}}\n\nManage email preferences: {{site_url}}/portal/settings?tab=preferences',
    'role:system',true)
on conflict (template_key) do nothing;

insert into public.mail_automations
  (event_key,name,category,description,template_key,enabled,variables)
values
  ('news.general_news','OrbitFS news','news','Send an explicitly published OrbitFS news item to subscribed customers.','news.general_news',true,'["customer_name","news_title","news_excerpt","news_url"]'::jsonb),
  ('news.announcement','OrbitFS announcement','news','Send an explicitly published announcement to subscribed customers.','news.announcement',true,'["customer_name","news_title","news_excerpt","news_url"]'::jsonb),
  ('news.product_updates','Product update news','product_updates','Send an explicitly published product news item to subscribed customers.','news.product_updates',true,'["customer_name","product_name","news_title","news_excerpt","news_url"]'::jsonb)
on conflict (event_key) do nothing;

insert into public.mail_subscription_events(event_key,category_key) values
  ('release.update_available','updates_available'),
  ('release.update_released','product_updates'),
  ('news.general_news','news'),
  ('news.announcement','news'),
  ('news.product_updates','product_updates'),
  ('deployment.ready','deployments'),
  ('deployment.started','deployments'),
  ('deployment.succeeded','deployments'),
  ('deployment.failed','system'),
  ('deployment.action_required','system'),
  ('deployment.rollback_succeeded','system'),
  ('support.ticket.created','system'),
  ('support.ticket.replied','support'),
  ('support.ticket.closed','support'),
  ('support.ticket.reopened','support'),
  ('order.created','system'),
  ('order.paid','system'),
  ('service.activated','orders'),
  ('service.restored','orders'),
  ('service.suspended','system'),
  ('service.terminated','system')
on conflict (event_key) do nothing;

-- Respect the three switches that existed before the subscription centre.
insert into public.mail_customer_subscriptions(user_id,category_key,subscribed)
select p.user_id,v.category_key,v.subscribed
from public.user_preferences p
cross join lateral (values
  ('news',coalesce(p.email_news,true)),
  ('product_updates',coalesce(p.email_news,true)),
  ('support',coalesce(p.email_support,true)),
  ('orders',coalesce(p.email_orders,true))
) as v(category_key,subscribed)
where p.user_id is not null
on conflict (user_id,category_key) do nothing;

alter table public.mail_subscription_categories enable row level security;
alter table public.mail_subscription_events enable row level security;
alter table public.mail_customer_subscriptions enable row level security;

drop policy if exists mail_categories_public_read on public.mail_subscription_categories;
create policy mail_categories_public_read on public.mail_subscription_categories
  for select to authenticated using(true);
drop policy if exists mail_events_public_read on public.mail_subscription_events;
create policy mail_events_public_read on public.mail_subscription_events
  for select to authenticated using(true);
drop policy if exists mail_subscriptions_own_select on public.mail_customer_subscriptions;
create policy mail_subscriptions_own_select on public.mail_customer_subscriptions
  for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists mail_subscriptions_own_insert on public.mail_customer_subscriptions;
create policy mail_subscriptions_own_insert on public.mail_customer_subscriptions
  for insert to authenticated with check (
    user_id=(select auth.uid()) and
    exists(select 1 from public.mail_subscription_categories c
      where c.category_key=mail_customer_subscriptions.category_key and c.required=false)
  );
drop policy if exists mail_subscriptions_own_update on public.mail_customer_subscriptions;
create policy mail_subscriptions_own_update on public.mail_customer_subscriptions
  for update to authenticated
  using(user_id=(select auth.uid()))
  with check (
    user_id=(select auth.uid()) and
    exists(select 1 from public.mail_subscription_categories c
      where c.category_key=mail_customer_subscriptions.category_key and c.required=false)
  );
revoke all on public.mail_subscription_categories,public.mail_subscription_events,public.mail_customer_subscriptions from anon;
revoke all on public.mail_subscription_categories,public.mail_subscription_events,public.mail_customer_subscriptions from authenticated;
grant select on public.mail_subscription_categories,public.mail_subscription_events to authenticated;
grant select,insert,update on public.mail_customer_subscriptions to authenticated;
grant all on public.mail_subscription_categories,public.mail_subscription_events,public.mail_customer_subscriptions to service_role;

-- Categories are editable by Mail settings administrators only. Required system
-- messages cannot be disabled, opted out of or reassigned to an optional group.
create or replace function public.mail_subscription_protected_event(p_event_key text)
returns boolean language sql immutable as $$
  select coalesce(p_event_key,'') ~ '^(auth[.]|security[.]|password[.]|customer[.]|invoice[.]|payment[.]|cancellation[.]|licen[cs]e[.]|order[.]created$|order[.]paid$|service[.]suspended$|service[.]terminated$|deployment[.]failed$|deployment[.]action_required$|deployment[.]rollback_succeeded$|support[.]ticket[.]created$)';
$$;

create or replace function public.mail_admin_save_subscription_category(
  p_key text,p_label text,p_description text,p_default_subscribed boolean,
  p_enabled boolean,p_sort_order integer
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare c public.mail_subscription_categories%rowtype;
begin
  if not (public.has_permission('mail.settings') or public.has_permission('all')) then
    raise exception 'Mail settings permission required' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_label,''))) not between 2 and 80 then raise exception 'Category name must be 2–80 characters'; end if;
  if length(coalesce(p_description,''))>400 then raise exception 'Category description is too long'; end if;
  if coalesce(p_key,'') !~ '^[a-z][a-z0-9_]{1,47}
  update public.mail_subscription_categories set
    label=btrim(p_label),description=btrim(coalesce(p_description,'')),
    default_subscribed=case when required then true else coalesce(p_default_subscribed,true) end,
    enabled=case when required then true else coalesce(p_enabled,true) end,
    sort_order=least(10000,greatest(0,coalesce(p_sort_order,100))),
    updated_at=now()
  where category_key=p_key;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.mail_admin_assign_subscription_event(
  p_event_key text,p_category_key text
) returns jsonb language plpgsql security definer set search_path='public' as $$
begin
  if not (public.has_permission('mail.settings') or public.has_permission('all')) then
    raise exception 'Mail settings permission required' using errcode='42501';
  end if;
  if not exists (select 1 from public.mail_automations where event_key=p_event_key) then
    raise exception 'Unknown mail automation event';
  end if;
  if not exists (select 1 from public.mail_subscription_categories where category_key=p_category_key) then
    raise exception 'Unknown subscription category';
  end if;
  if public.mail_subscription_protected_event(p_event_key) and p_category_key<>'system' then
    raise exception 'Critical system/transactional events must remain mandatory';
  end if;
  if not public.mail_subscription_protected_event(p_event_key) and p_category_key='system' then
    raise exception 'Only critical transactional events can be assigned to the mandatory system category';
  end if;
  insert into public.mail_subscription_events(event_key,category_key)
  values(p_event_key,p_category_key)
  on conflict(event_key) do update set category_key=excluded.category_key,updated_at=now();
  return jsonb_build_object('ok',true);
end $$;

-- Single decision point for server-side transactional + bulk send pathways.
-- Unknown event families stay mandatory instead of silently becoming marketing.
create or replace function public.mail_subscription_allowed(
  p_recipient_email text,p_event_key text,p_template_key text default null
) returns boolean language plpgsql stable security definer set search_path='public' as $$
declare
  v_user_id uuid;
  v_category text;
  v_required boolean;
  v_enabled boolean;
  v_default boolean;
  v_override boolean;
begin
  if public.mail_subscription_protected_event(p_event_key) then return true; end if;
  select c.auth_user_id into v_user_id from public.customers c
    where lower(c.email)=lower(btrim(coalesce(p_recipient_email,'')))
    and c.auth_user_id is not null limit 1;
  if v_user_id is null then return true; end if;

  select m.category_key into v_category
    from public.mail_subscription_events m where m.event_key=p_event_key;
  -- Direct staff sends may use a custom event key; an explicitly selected
  -- newsletter/release template must still obey its own subscription category.
  if v_category is null and p_template_key is not null then
    select m.category_key into v_category
    from public.mail_subscription_events m where m.event_key=p_template_key;
  end if;

  if v_category is null then
    if coalesce(p_event_key,'') like 'news.%' or coalesce(p_template_key,'') like 'news.%' then
      v_category:=case when coalesce(p_event_key,'')='news.product_updates'
        or coalesce(p_template_key,'')='news.product_updates' then 'product_updates' else 'news' end;
    elsif coalesce(p_event_key,'') like 'release.%' then v_category:='product_updates';
    elsif coalesce(p_event_key,'') like 'deployment.%' then v_category:='deployments';
    elsif coalesce(p_event_key,'') like 'support.%' then v_category:='support';
    elsif coalesce(p_event_key,'') like 'service.%' then v_category:='orders';
    else
      select case lower(coalesce(t.category,''))
        when 'news' then 'news'
        when 'product_updates' then 'product_updates'
        when 'releases' then 'product_updates'
        else 'system' end
      into v_category
      from public.mail_templates t where t.template_key=p_template_key;
      v_category:=coalesce(v_category,'system');
    end if;
  end if;

  select required,enabled,default_subscribed into v_required,v_enabled,v_default
    from public.mail_subscription_categories where category_key=v_category;
  if not found then return false; end if;
  if v_required then return true; end if;
  if not v_enabled then return false; end if;
  select subscribed into v_override from public.mail_customer_subscriptions
    where user_id=v_user_id and category_key=v_category;
  return coalesce(v_override,v_default,true);
end $$;

-- Outbox token check is required before revealing/using a queue event. For an opt-out
-- keep the event for audit, terminal with an explicit suppression reason and no send.
create or replace function public.mail_subscription_outbox_gate(
  p_id uuid,p_token uuid
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare
  e public.mail_event_outbox%rowtype;
  v_email text;
  v_template text;
begin
  select * into e from public.mail_event_outbox
    where id=p_id and dispatch_token=p_token for update;
  if not found then raise exception 'Invalid mail dispatch' using errcode='42501'; end if;
  if e.state='sent' or e.attempts>=10 then
    return jsonb_build_object('allowed',false,'reason','already_processed');
  end if;
  select email into v_email from public.customers
    where auth_user_id=e.auth_user_id limit 1;
  select template_key into v_template from public.mail_automations
    where event_key=e.event_key;
  if v_email is not null and not public.mail_subscription_allowed(v_email,e.event_key,v_template) then
    update public.mail_event_outbox
      set state='failed',attempts=10,processed_at=now(),
          last_error='Suppressed: customer unsubscribed from this mail category'
      where id=e.id;
    return jsonb_build_object('allowed',false,'reason','unsubscribed');
  end if;
  return jsonb_build_object('allowed',true);
end $$;

revoke all on function public.mail_subscription_protected_event(text) from public;
revoke all on function public.mail_admin_save_subscription_category(text,text,text,boolean,boolean,integer) from public,anon;
revoke all on function public.mail_admin_assign_subscription_event(text,text) from public,anon;
revoke all on function public.mail_subscription_allowed(text,text,text) from public,anon,authenticated;
revoke all on function public.mail_subscription_outbox_gate(uuid,uuid) from public;
grant execute on function public.mail_admin_save_subscription_category(text,text,text,boolean,boolean,integer) to authenticated;
grant execute on function public.mail_admin_assign_subscription_event(text,text) to authenticated;
grant execute on function public.mail_subscription_allowed(text,text,text) to service_role;
grant execute on function public.mail_subscription_outbox_gate(uuid,uuid) to anon,authenticated,service_role;
 then raise exception 'Category key must be 2–48 lowercase letters, numbers or underscores'; end if;
  select * into c from public.mail_subscription_categories where category_key=p_key for update;
  if not found then
    if p_key='system' then raise exception 'Mandatory system category cannot be recreated'; end if;
    insert into public.mail_subscription_categories
      (category_key,label,description,required,default_subscribed,enabled,sort_order)
    values (p_key,btrim(p_label),btrim(coalesce(p_description,'')),false,
      coalesce(p_default_subscribed,true),coalesce(p_enabled,true),
      least(10000,greatest(0,coalesce(p_sort_order,100))));
    return jsonb_build_object('ok',true,'created',true);
  end if;
  update public.mail_subscription_categories set
    label=btrim(p_label),description=btrim(coalesce(p_description,'')),
    default_subscribed=case when required then true else coalesce(p_default_subscribed,true) end,
    enabled=case when required then true else coalesce(p_enabled,true) end,
    sort_order=least(10000,greatest(0,coalesce(p_sort_order,100))),
    updated_at=now()
  where category_key=p_key;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.mail_admin_assign_subscription_event(
  p_event_key text,p_category_key text
) returns jsonb language plpgsql security definer set search_path='public' as $$
begin
  if not (public.has_permission('mail.settings') or public.has_permission('all')) then
    raise exception 'Mail settings permission required' using errcode='42501';
  end if;
  if not exists (select 1 from public.mail_automations where event_key=p_event_key) then
    raise exception 'Unknown mail automation event';
  end if;
  if not exists (select 1 from public.mail_subscription_categories where category_key=p_category_key) then
    raise exception 'Unknown subscription category';
  end if;
  if public.mail_subscription_protected_event(p_event_key) and p_category_key<>'system' then
    raise exception 'Critical system/transactional events must remain mandatory';
  end if;
  if not public.mail_subscription_protected_event(p_event_key) and p_category_key='system' then
    raise exception 'Only critical transactional events can be assigned to the mandatory system category';
  end if;
  insert into public.mail_subscription_events(event_key,category_key)
  values(p_event_key,p_category_key)
  on conflict(event_key) do update set category_key=excluded.category_key,updated_at=now();
  return jsonb_build_object('ok',true);
end $$;

-- Single decision point for server-side transactional + bulk send pathways.
-- Unknown event families stay mandatory instead of silently becoming marketing.
create or replace function public.mail_subscription_allowed(
  p_recipient_email text,p_event_key text,p_template_key text default null
) returns boolean language plpgsql stable security definer set search_path='public' as $$
declare
  v_user_id uuid;
  v_category text;
  v_required boolean;
  v_enabled boolean;
  v_default boolean;
  v_override boolean;
begin
  if public.mail_subscription_protected_event(p_event_key) then return true; end if;
  select c.auth_user_id into v_user_id from public.customers c
    where lower(c.email)=lower(btrim(coalesce(p_recipient_email,'')))
    and c.auth_user_id is not null limit 1;
  if v_user_id is null then return true; end if;

  select m.category_key into v_category
    from public.mail_subscription_events m where m.event_key=p_event_key;
  -- Direct staff sends may use a custom event key; an explicitly selected
  -- newsletter/release template must still obey its own subscription category.
  if v_category is null and p_template_key is not null then
    select m.category_key into v_category
    from public.mail_subscription_events m where m.event_key=p_template_key;
  end if;

  if v_category is null then
    if coalesce(p_event_key,'') like 'news.%' or coalesce(p_template_key,'') like 'news.%' then
      v_category:=case when coalesce(p_event_key,'')='news.product_updates'
        or coalesce(p_template_key,'')='news.product_updates' then 'product_updates' else 'news' end;
    elsif coalesce(p_event_key,'') like 'release.%' then v_category:='product_updates';
    elsif coalesce(p_event_key,'') like 'deployment.%' then v_category:='deployments';
    elsif coalesce(p_event_key,'') like 'support.%' then v_category:='support';
    elsif coalesce(p_event_key,'') like 'service.%' then v_category:='orders';
    else
      select case lower(coalesce(t.category,''))
        when 'news' then 'news'
        when 'product_updates' then 'product_updates'
        when 'releases' then 'product_updates'
        else 'system' end
      into v_category
      from public.mail_templates t where t.template_key=p_template_key;
      v_category:=coalesce(v_category,'system');
    end if;
  end if;

  select required,enabled,default_subscribed into v_required,v_enabled,v_default
    from public.mail_subscription_categories where category_key=v_category;
  if not found then return false; end if;
  if v_required then return true; end if;
  if not v_enabled then return false; end if;
  select subscribed into v_override from public.mail_customer_subscriptions
    where user_id=v_user_id and category_key=v_category;
  return coalesce(v_override,v_default,true);
end $$;

-- Outbox token check is required before revealing/using a queue event. For an opt-out
-- keep the event for audit, terminal with an explicit suppression reason and no send.
create or replace function public.mail_subscription_outbox_gate(
  p_id uuid,p_token uuid
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare
  e public.mail_event_outbox%rowtype;
  v_email text;
  v_template text;
begin
  select * into e from public.mail_event_outbox
    where id=p_id and dispatch_token=p_token for update;
  if not found then raise exception 'Invalid mail dispatch' using errcode='42501'; end if;
  if e.state='sent' or e.attempts>=10 then
    return jsonb_build_object('allowed',false,'reason','already_processed');
  end if;
  select email into v_email from public.customers
    where auth_user_id=e.auth_user_id limit 1;
  select template_key into v_template from public.mail_automations
    where event_key=e.event_key;
  if v_email is not null and not public.mail_subscription_allowed(v_email,e.event_key,v_template) then
    update public.mail_event_outbox
      set state='failed',attempts=10,processed_at=now(),
          last_error='Suppressed: customer unsubscribed from this mail category'
      where id=e.id;
    return jsonb_build_object('allowed',false,'reason','unsubscribed');
  end if;
  return jsonb_build_object('allowed',true);
end $$;

revoke all on function public.mail_subscription_protected_event(text) from public;
revoke all on function public.mail_admin_save_subscription_category(text,text,text,boolean,boolean,integer) from public,anon;
revoke all on function public.mail_admin_assign_subscription_event(text,text) from public,anon;
revoke all on function public.mail_subscription_allowed(text,text,text) from public,anon,authenticated;
revoke all on function public.mail_subscription_outbox_gate(uuid,uuid) from public;
grant execute on function public.mail_admin_save_subscription_category(text,text,text,boolean,boolean,integer) to authenticated;
grant execute on function public.mail_admin_assign_subscription_event(text,text) to authenticated;
grant execute on function public.mail_subscription_allowed(text,text,text) to service_role;
grant execute on function public.mail_subscription_outbox_gate(uuid,uuid) to anon,authenticated,service_role;
