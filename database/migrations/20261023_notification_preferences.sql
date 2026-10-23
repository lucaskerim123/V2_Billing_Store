create table if not exists public.notification_preferences(
 user_id uuid not null references auth.users(id) on delete cascade,
 surface text not null check(surface in ('admin','portal')),
 do_not_disturb boolean not null default false,
 quiet_start time,
 quiet_end time,
 muted_categories text[] not null default '{}'::text[],
 allow_critical_override boolean not null default true,
 updated_at timestamptz not null default now(),
 primary key(user_id,surface)
);
alter table public.notification_preferences enable row level security;
grant select,insert,update on public.notification_preferences to authenticated;
drop policy if exists notification_prefs_select_own on public.notification_preferences;
create policy notification_prefs_select_own on public.notification_preferences for select to authenticated using(user_id=auth.uid());
drop policy if exists notification_prefs_insert_own on public.notification_preferences;
create policy notification_prefs_insert_own on public.notification_preferences for insert to authenticated with check(user_id=auth.uid());
drop policy if exists notification_prefs_update_own on public.notification_preferences;
create policy notification_prefs_update_own on public.notification_preferences for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());