-- Global customer portal banner configuration.
-- Separate from the notification/alert message system.

insert into public.app_settings(key,value,category,public_read,updated_at) values
('portal_banner.enabled','false'::jsonb,'portal_banner',true,now()),
('portal_banner.level','"info"'::jsonb,'portal_banner',true,now()),
('portal_banner.title','""'::jsonb,'portal_banner',true,now()),
('portal_banner.message','""'::jsonb,'portal_banner',true,now()),
('portal_banner.dismissible','true'::jsonb,'portal_banner',true,now()),
('portal_banner.revision','1'::jsonb,'portal_banner',true,now())
on conflict(key) do nothing;
