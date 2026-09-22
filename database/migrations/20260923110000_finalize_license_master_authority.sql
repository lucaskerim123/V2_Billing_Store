-- OrbitFS licensing authority cleanup.
-- The Billing Store never acts as the License Master and must not retain executable
-- website-local license issuance/validation/controller paths.
drop function if exists public.admin_delete_website_license(uuid,text);
drop function if exists public.admin_edit_website_license(uuid,text,text,timestamptz,text,jsonb);
drop function if exists public.admin_rotate_website_license(uuid);
drop function if exists public.customer_retrieve_website_key(uuid);
drop function if exists public.request_license_controller_action(uuid,text,text,text);
drop function if exists public.website_license_validate(text,text,text[],boolean,text,text,text);

update public.products
set license_api_mode='master',
    license_api_enabled=true,
    license_api_url='https://incendiarynetworks.cc/api/v1/license',
    updated_at=now()
where license_product_key in ('orbitfs_base','orbitfs_mcp','orbitfs_apex','orbitfs_studio');
