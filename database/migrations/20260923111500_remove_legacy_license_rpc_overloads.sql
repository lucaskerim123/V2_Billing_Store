-- Remove unused legacy Billing Store license RPCs now that License Master is authoritative.
drop function if exists public.admin_unlock_website_license(uuid,text);
drop function if exists public.website_license_register(text,text,text[],text,text,text);
drop function if exists public.website_license_revision();
drop function if exists public.website_license_runtime_settings();
drop function if exists public.admin_order_service_action(uuid,text,text,boolean);
