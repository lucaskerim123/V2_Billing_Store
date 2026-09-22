-- License issuance authority is the independent License Master.
-- Remove the obsolete Billing Store-local website key minting function and
-- enforce one current license binding per customer/product.
drop function if exists public.admin_issue_website_license(uuid,text,jsonb,timestamptz,text,boolean);
drop function if exists public.admin_issue_website_license(uuid,text,jsonb,timestamptz,text);
drop index if exists public.license_bindings_one_active_per_user;
create unique index if not exists license_bindings_one_active_per_user_product
  on public.license_bindings(auth_user_id,license_product_key)
  where archived_at is null and desired_state <> 'revoked';
