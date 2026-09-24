-- OrbitFS Billing Store complete settings restore.
-- Idempotent and safe for rebuilt databases: existing administrator values are preserved.

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  category text not null default 'general',
  public_read boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.app_settings add column if not exists value jsonb;
alter table public.app_settings add column if not exists category text default 'general';
alter table public.app_settings add column if not exists public_read boolean default false;
alter table public.app_settings add column if not exists updated_at timestamptz default now();

insert into public.app_settings(key,value,category,public_read,updated_at)
values
('site.public_url','"https://orbitfsstore.vercel.app"'::jsonb,'site',true,now()),
('site.website_url','"https://orbitfsstore.vercel.app"'::jsonb,'site',true,now())
on conflict(key) do nothing;

insert into public.app_settings(key,value,category,public_read,updated_at) values
('store.hero_eyebrow','"ORBITFS STORE"'::jsonb,'store',true,now()),
('store.hero_title','"Build your OrbitFS setup"'::jsonb,'store',true,now()),
('store.hero_lead','"Start with OrbitFS Base System, then add the components you need."'::jsonb,'store',true,now()),
('store.base_action_label','"Base system"'::jsonb,'store',true,now()),
('store.addons_eyebrow','"EXPAND ORBITFS"'::jsonb,'store',true,now()),
('store.addons_title','"Add-ons"'::jsonb,'store',true,now()),
('store.addons_lead','"Add only the capabilities you want."'::jsonb,'store',true,now())
on conflict(key) do nothing;

insert into public.app_settings(key,value,category,public_read,updated_at)
select 'internal.gateway_sync_token',to_jsonb(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','')),'internal',false,now()
where not exists(select 1 from public.app_settings where key='internal.gateway_sync_token');

-- Core platform settings. Existing values are deliberately preserved.
insert into public.app_settings(key,value,category,public_read,updated_at) values
('identity.site_name','"OrbitFS"'::jsonb,'identity',true,now()),
('identity.store_name','"OrbitFS Store"'::jsonb,'identity',true,now()),
('identity.portal_name','"My OrbitFS"'::jsonb,'identity',true,now()),
('identity.admin_name','"OrbitFS Master"'::jsonb,'identity',false,now()),
('identity.admin_subtitle','"Master administration and operations"'::jsonb,'identity',false,now()),
('identity.company_name','"OrbitFS"'::jsonb,'identity',true,now()),
('identity.support_name','"OrbitFS Support"'::jsonb,'identity',true,now()),
('identity.tagline','"OrbitFS Store"'::jsonb,'identity',true,now()),
('identity.login_title','"Sign in to OrbitFS"'::jsonb,'identity',true,now()),
('identity.register_title','"Create your OrbitFS account"'::jsonb,'identity',true,now()),
('identity.browser_site_name','"OrbitFS"'::jsonb,'identity',true,now()),
('identity.browser_store_name','"OrbitFS Store"'::jsonb,'identity',true,now()),
('identity.browser_portal_name','"My OrbitFS"'::jsonb,'identity',true,now()),
('identity.browser_admin_name','"OrbitFS Master"'::jsonb,'identity',false,now()),
('identity.browser_title_separator','" - "'::jsonb,'identity',true,now()),
('general.registration_enabled','true'::jsonb,'general',true,now()),
('general.require_email_verification','true'::jsonb,'general',true,now()),
('general.account_deletion_enabled','true'::jsonb,'general',true,now()),
('general.maintenance_mode','false'::jsonb,'general',true,now()),
('general.default_locale','"en-AU"'::jsonb,'general',true,now()),
('general.default_timezone','"Australia/Sydney"'::jsonb,'general',true,now()),
('general.support_email','"support@orbitfs.cc"'::jsonb,'general',true,now()),
('billing.currency','"AUD"'::jsonb,'billing',true,now()),
('billing.order_prefix','"ORB-"'::jsonb,'billing',true,now()),
('billing.allow_account_credit','true'::jsonb,'billing',true,now()),
('billing.credit_topups_enabled','true'::jsonb,'billing',true,now()),
('billing.auto_apply_credit','false'::jsonb,'billing',true,now()),
('billing.minimum_credit_topup_cents','500'::jsonb,'billing',true,now()),
('billing.maximum_credit_topup_cents','100000'::jsonb,'billing',true,now()),
('billing.allow_manual_payments','true'::jsonb,'billing',false,now()),
('billing.allow_partial_payments','true'::jsonb,'billing',true,now()),
('billing.tax_enabled','true'::jsonb,'billing',true,now()),
('billing.tax_name','"GST"'::jsonb,'billing',true,now()),
('billing.tax_rate','10'::jsonb,'billing',true,now()),
('invoice.auto_generate','true'::jsonb,'invoice',false,now()),
('invoice.prefix','"INV-"'::jsonb,'invoice',true,now()),
('invoice.due_days','7'::jsonb,'invoice',true,now()),
('invoice.reminder_before_days','2'::jsonb,'invoice',false,now()),
('invoice.reminder_after_days','3'::jsonb,'invoice',false,now()),
('invoice.suspend_after_days','14'::jsonb,'invoice',false,now()),
('invoice.auto_cancel_unpaid_days','30'::jsonb,'invoice',false,now()),
('invoice.company_name','"OrbitFS"'::jsonb,'invoice',true,now()),
('invoice.company_abn','""'::jsonb,'invoice',true,now()),
('invoice.company_address','""'::jsonb,'invoice',true,now()),
('invoice.footer_note','"Thank you for your business."'::jsonb,'invoice',true,now()),
('invoice.payment_instructions','"Payment instructions will appear here when configured."'::jsonb,'invoice',true,now()),
('invoice.show_company_details','true'::jsonb,'invoice',true,now()),
('invoice.presentation_template','"modern"'::jsonb,'invoice',true,now()),
('invoice.presentation_accent','"#3b82f6"'::jsonb,'invoice',true,now()),
('invoice.presentation_show_logo','true'::jsonb,'invoice',true,now()),
('invoice.presentation_show_tax','true'::jsonb,'invoice',true,now()),
('invoice.presentation_show_payment_instructions','true'::jsonb,'invoice',true,now()),
('products.default_currency','"AUD"'::jsonb,'products',true,now()),
('products.default_setup_mode','"after_payment"'::jsonb,'products',false,now()),
('products.require_payment_before_fulfillment','true'::jsonb,'products',false,now()),
('products.allow_addons','true'::jsonb,'products',true,now()),
('products.allow_upgrades','true'::jsonb,'products',true,now()),
('products.allow_coupons','true'::jsonb,'products',true,now()),
('products.allow_quantity','true'::jsonb,'products',true,now()),
('products.hide_out_of_stock','false'::jsonb,'products',true,now()),
('products.show_disabled_to_admin','true'::jsonb,'products',false,now()),
('products.sort_mode','"sort_order"'::jsonb,'products',true,now()),
('license.integration_mode','"active"'::jsonb,'license',false,now()),
('license.auto_suspend_on_account_suspend','true'::jsonb,'license',false,now()),
('license.auto_suspend_on_overdue_invoice','true'::jsonb,'license',false,now()),
('license.auto_restore_after_payment','true'::jsonb,'license',false,now()),
('license.grace_days','14'::jsonb,'license',false,now()),
('license.customer_key_retrieval','true'::jsonb,'license',true,now()),
('license.customer_key_rotation','true'::jsonb,'license',true,now()),
('license.customer_unlock_all','true'::jsonb,'license',true,now()),
('license.customer_unlock_component','true'::jsonb,'license',true,now()),
('support.default_priority','"normal"'::jsonb,'support',true,now()),
('support.allow_reopen','true'::jsonb,'support',true,now()),
('support.customer_can_close','true'::jsonb,'support',true,now()),
('support.auto_close_days','14'::jsonb,'support',false,now()),
('support.intro','"Need help with your OrbitFS account, billing, licensing or deployment? Open a support ticket and our team will help."'::jsonb,'support',true,now()),
('site.logo_text','"OrbitFS"'::jsonb,'site',true,now()),
('site.logo_url','""'::jsonb,'site',true,now()),
('site.favicon_url','""'::jsonb,'site',true,now()),
('site.primary_accent','"#38bdf8"'::jsonb,'site',true,now()),
('site.secondary_accent','"#22d3ee"'::jsonb,'site',true,now()),
('site.background_color','"#0b0f16"'::jsonb,'site',true,now()),
('site.panel_color','"#121824"'::jsonb,'site',true,now()),
('site.border_color','"#2a3444"'::jsonb,'site',true,now()),
('site.text_color','"#f5f7fb"'::jsonb,'site',true,now()),
('site.muted_text_color','"#9aa8bb"'::jsonb,'site',true,now()),
('site.default_theme','"dark"'::jsonb,'site',true,now()),
('site.interface_density','"comfortable"'::jsonb,'site',true,now()),
('site.navigation_style','"topbar"'::jsonb,'site',true,now()),
('site.rounded_corners','"medium"'::jsonb,'site',true,now()),
('site.card_radius','12'::jsonb,'site',true,now()),
('site.content_width','1280'::jsonb,'site',true,now()),
('site.hero_heading','"Build your OrbitFS setup"'::jsonb,'site',true,now()),
('site.hero_subheading','"Start with OrbitFS Base System, then add the components you need."'::jsonb,'site',true,now()),
('site.hero_primary_cta','"Explore products"'::jsonb,'site',true,now()),
('site.hero_secondary_cta','"Open My OrbitFS"'::jsonb,'site',true,now()),
('site.show_feature_band','true'::jsonb,'site',true,now()),
('site.show_news','true'::jsonb,'site',true,now()),
('site.show_product_prices','true'::jsonb,'site',true,now()),
('site.footer_text','"OrbitFS Store"'::jsonb,'site',true,now()),
('site.terms_url','""'::jsonb,'site',true,now()),
('site.privacy_url','""'::jsonb,'site',true,now()),
('site.status_url','""'::jsonb,'site',true,now()),
('site.portal_welcome','"Welcome back to My OrbitFS."'::jsonb,'site',true,now())
on conflict(key) do nothing;

insert into public.app_settings(key,value,category,public_read) values
  ('alerts.enabled','true'::jsonb,'alerts',false),
  ('alerts.manual_send_enabled','true'::jsonb,'alerts',false),
  ('alerts.realtime_enabled','true'::jsonb,'alerts',false),
  ('alerts.action_links_enabled','true'::jsonb,'alerts',false),
  ('alerts.default_type','"notification"'::jsonb,'alerts',false),
  ('alerts.default_severity','"info"'::jsonb,'alerts',false),
  ('alerts.default_audience','"selected"'::jsonb,'alerts',false),
  ('alerts.confirmation_threshold','25'::jsonb,'alerts',false),
  ('alerts.feed_limit','40'::jsonb,'alerts',false),
  ('alerts.max_message_length','4000'::jsonb,'alerts',false),
  ('alerts.type_notification_enabled','true'::jsonb,'alerts',false),
  ('alerts.type_message_enabled','true'::jsonb,'alerts',false),
  ('alerts.type_alert_enabled','true'::jsonb,'alerts',false),
  ('alerts.type_announcement_enabled','true'::jsonb,'alerts',false),
  ('alerts.type_maintenance_enabled','true'::jsonb,'alerts',false)
on conflict (key) do nothing;

insert into public.app_settings(key,value,category,public_read,updated_at) values
('general.maintenance_message','"OrbitFS Store is temporarily under maintenance. Existing account and support access may remain available."'::jsonb,'general',true,now()),
('general.master_restricted_notice','"OrbitFS licensing services are temporarily restricted. New licence fulfilment is paused and paid orders will be held for manual processing until License Master is available."'::jsonb,'general',true,now()),
('products.fulfillment_mode','"automatic"'::jsonb,'products',false,now()),
('products.pause_fulfillment_when_master_restricted','true'::jsonb,'products',false,now()),
('products.pause_fulfillment_when_master_unreachable','true'::jsonb,'products',false,now()),
('support.enabled','true'::jsonb,'support',true,now()),
('support.guest_enabled','true'::jsonb,'support',true,now()),
('support.guest_retention_hours','48'::jsonb,'support',false,now()),
('support.max_attachment_mb','25'::jsonb,'support',true,now()),
('support.customer_priority_enabled','true'::jsonb,'support',true,now())
on conflict(key) do nothing;

-- Normalize every known setting into the admin area that owns it.
-- This also repairs legacy "customization" / plural category values without overwriting values.
update public.app_settings
set category=case
  when key like 'identity.%' then 'identity'
  when key like 'general.%' then 'general'
  when key like 'billing.%' then 'billing'
  when key like 'invoice.%' then 'invoice'
  when key like 'products.%' then 'products'
  when key like 'license.%' then 'license'
  when key like 'support.%' then 'support'
  when key like 'site.%' then 'site'
  when key like 'store.%' then 'store'
  when key like 'alerts.%' then 'alerts'
  else category
end,
updated_at=now()
where
  (key like 'identity.%' and category is distinct from 'identity') or
  (key like 'general.%' and category is distinct from 'general') or
  (key like 'billing.%' and category is distinct from 'billing') or
  (key like 'invoice.%' and category is distinct from 'invoice') or
  (key like 'products.%' and category is distinct from 'products') or
  (key like 'license.%' and category is distinct from 'license') or
  (key like 'support.%' and category is distinct from 'support') or
  (key like 'site.%' and category is distinct from 'site') or
  (key like 'store.%' and category is distinct from 'store') or
  (key like 'alerts.%' and category is distinct from 'alerts');

-- Keep the internal sync secret present without exposing it through the settings UI.
insert into public.app_settings(key,value,category,public_read,updated_at)
select 'internal.gateway_sync_token',
       to_jsonb(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','')),
       'internal',false,now()
where not exists(select 1 from public.app_settings where key='internal.gateway_sync_token');
