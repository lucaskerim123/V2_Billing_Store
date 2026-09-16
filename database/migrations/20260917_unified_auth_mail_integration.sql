-- Account mail stays inside OrbitFS Mail; Resend is transport only.
insert into public.mail_automations(event_key,name,category,description,template_key,enabled,variables)
values
('account.email_verification','Account email verification','account','Send the OrbitFS account verification link.','account.email_verification',true,'["customer_name","verification_url","expires_hours"]'::jsonb),
('account.password_reset','Password reset','account','Send the OrbitFS password reset link.','account_password_reset',true,'["customer_name","reset_url","expires_minutes"]'::jsonb)
on conflict(event_key) do update set name=excluded.name,category=excluded.category,description=excluded.description,template_key=excluded.template_key,enabled=true,variables=excluded.variables,updated_at=now();
