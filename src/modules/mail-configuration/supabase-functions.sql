-- v3-ready host persistence functions. Run after schema.sql.
-- Functions are SECURITY INVOKER so the caller's host RLS policies remain in force.
create or replace function public.app_mail_save_template_with_revision(p_template jsonb)
returns public.app_mail_templates
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_template public.app_mail_templates;
  v_revision integer;
  v_id uuid;
begin
  v_id := nullif(p_template->>'id','')::uuid;
  if v_id is null then
    insert into public.app_mail_templates
      (template_key, display_name, subject, body_text, body_html, variables, active)
    values
      (p_template->>'template_key', p_template->>'display_name', p_template->>'subject',
       nullif(p_template->>'body_text','null'), nullif(p_template->>'body_html','null'),
       coalesce(p_template->'variables','[]'::jsonb), coalesce((p_template->>'active')::boolean,false))
    returning * into v_template;
  else
    update public.app_mail_templates set
      template_key = p_template->>'template_key',
      display_name = p_template->>'display_name',
      subject = p_template->>'subject',
      body_text = case when p_template->'body_text' is null or p_template->'body_text' = 'null'::jsonb then null else p_template->>'body_text' end,
      body_html = case when p_template->'body_html' is null or p_template->'body_html' = 'null'::jsonb then null else p_template->>'body_html' end,
      variables = coalesce(p_template->'variables','[]'::jsonb),
      active = coalesce((p_template->>'active')::boolean,false)
    where id = v_id returning * into v_template;
    if not found then raise exception 'Template not found or access denied'; end if;
  end if;

  perform 1 from public.app_mail_templates where id = v_template.id for update;
  select coalesce(max(revision),0)+1 into v_revision
    from public.app_mail_template_revisions where template_id = v_template.id;
  insert into public.app_mail_template_revisions(template_id,revision,snapshot)
    values (v_template.id,v_revision,to_jsonb(v_template));
  return v_template;
end;
$$;

create or replace function public.app_mail_restore_template_revision(p_template_id uuid,p_revision integer)
returns public.app_mail_templates
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_snapshot jsonb;
  v_result public.app_mail_templates;
begin
  select snapshot into v_snapshot from public.app_mail_template_revisions
    where template_id=p_template_id and revision=p_revision;
  if v_snapshot is null then raise exception 'Template revision not found'; end if;
  v_snapshot := v_snapshot || jsonb_build_object('id',p_template_id);
  return public.app_mail_save_template_with_revision(v_snapshot);
end;
$$;

revoke all on function public.app_mail_save_template_with_revision(jsonb) from public;
revoke all on function public.app_mail_restore_template_revision(uuid,integer) from public;
grant execute on function public.app_mail_save_template_with_revision(jsonb) to authenticated, service_role;
grant execute on function public.app_mail_restore_template_revision(uuid,integer) to authenticated, service_role;
