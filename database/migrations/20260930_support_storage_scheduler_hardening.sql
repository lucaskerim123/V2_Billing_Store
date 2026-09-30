-- Restore the Billing Store support storage and housekeeping integrations.
-- Forward-only; preserve existing support tickets and settings.
insert into storage.buckets(id,name,public,file_size_limit)
values('support-attachments','support-attachments',false,26214400)
on conflict(id) do update set public=false,file_size_limit=26214400;

drop policy if exists support_upload_owned_ticket on storage.objects;
create policy support_upload_owned_ticket on storage.objects for insert to authenticated
with check (
  bucket_id='support-attachments'
  and (storage.foldername(name))[1]=auth.uid()::text
  and exists(
    select 1 from public.support_tickets t
    where t.id::text=(storage.foldername(name))[2]
      and (t.user_id=auth.uid() or public.support_staff_can_access_ticket(t.id))
  )
);

drop policy if exists support_read_accessible_ticket on storage.objects;
create policy support_read_accessible_ticket on storage.objects for select to authenticated
using (
  bucket_id='support-attachments'
  and exists(
    select 1 from public.support_tickets t
    where t.id::text=(storage.foldername(name))[2]
      and (t.user_id=auth.uid() or public.support_staff_can_access_ticket(t.id))
  )
);

drop policy if exists support_staff_remove_ticket_files on storage.objects;
create policy support_staff_remove_ticket_files on storage.objects for delete to authenticated
using (
  bucket_id='support-attachments'
  and exists(
    select 1 from public.support_tickets t
    where t.id::text=(storage.foldername(name))[2]
      and public.support_staff_can_access_ticket(t.id)
      and public.has_permission('support.archive')
  )
);

create or replace function public.attach_support_file(
  p_ticket_id uuid,p_message_id uuid,p_file_name text,p_storage_path text,
  p_mime_type text,p_file_size_bytes bigint
) returns uuid language plpgsql security definer set search_path='public' as $$
declare uid uuid:=auth.uid(); rid uuid; max_mb integer:=25;
begin
  if uid is null then raise exception 'authentication required'; end if;
  if not exists (
    select 1 from public.support_tickets t
     where t.id=p_ticket_id
       and (t.user_id=uid or public.support_staff_can_access_ticket(t.id))
  ) then raise exception 'ticket not found or inaccessible'; end if;
  if p_message_id is not null and not exists(
    select 1 from public.support_ticket_messages m
     where m.id=p_message_id and m.ticket_id=p_ticket_id
  ) then raise exception 'attachment message belongs to another ticket'; end if;
  select greatest(1,coalesce((value #>> '{}')::integer,25))
    into max_mb from public.app_settings where key='support.max_attachment_mb';
  if p_file_size_bytes is null or p_file_size_bytes<1
     or p_file_size_bytes>least(coalesce(max_mb,25),25)*1048576
  then raise exception 'attachment exceeds size limit or is empty'; end if;
  if nullif(btrim(coalesce(p_file_name,'')),'') is null then raise exception 'file name required'; end if;
  if split_part(p_storage_path,'/',1)<>uid::text
     or split_part(p_storage_path,'/',2)<>p_ticket_id::text
  then raise exception 'invalid attachment storage path'; end if;
  if not exists (
    select 1 from storage.objects o where o.bucket_id='support-attachments'
      and o.name=p_storage_path and o.owner_id=uid::text
  ) then raise exception 'uploaded support attachment not found'; end if;
  insert into public.support_attachments(ticket_id,message_id,uploader_user_id,file_name,storage_path,mime_type,file_size_bytes)
  values(p_ticket_id,p_message_id,uid,btrim(p_file_name),p_storage_path,p_mime_type,p_file_size_bytes)
  returning id into rid;
  return rid;
end $$;

revoke execute on function public.attach_support_file(uuid,uuid,text,text,text,bigint) from public,anon;
grant execute on function public.attach_support_file(uuid,uuid,text,text,text,bigint) to authenticated;
revoke execute on function public.process_support_auto_close() from public,anon,authenticated;
revoke execute on function public.process_expired_guest_support_tickets() from public,anon,authenticated;

-- Run maintenance through the database scheduler, not publicly callable RPCs.
do $$ begin
 if not exists(select 1 from cron.job where jobname='orbitfs-support-auto-close') then
   perform cron.schedule('orbitfs-support-auto-close','37 * * * *','select public.process_support_auto_close()');
 end if;
 if not exists(select 1 from cron.job where jobname='orbitfs-guest-support-expiry') then
   perform cron.schedule('orbitfs-guest-support-expiry','17 * * * *','select public.process_expired_guest_support_tickets()');
 end if;
end $$;
