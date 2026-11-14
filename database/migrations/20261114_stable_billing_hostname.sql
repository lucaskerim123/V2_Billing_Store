-- Set the one public customer-facing Billing origin for MAIN and FALLBACK.
-- Historical migrations are left intact; this forward migration updates live settings.

begin;

update public.app_settings
set value=to_jsonb('https://billing.incendiarynetworks.cc'::text),
    updated_at=now()
where key in ('site.public_url','site.website_url');

update private.orbitfs_oauth_callback_origins
set origin='https://billing.incendiarynetworks.cc'
where mode in ('main','fallback');

-- Record the new canonical origin and mark only enabled, registered payment
-- webhooks for provider-side reconfiguration. Disabled/unconfigured gateways
-- do not require a webhook change.
update public.payment_gateway_setups s
set metadata=coalesce(s.metadata,'{}'::jsonb)||jsonb_build_object(
      'canonical_store_origin','https://billing.incendiarynetworks.cc',
      'webhook_reconfigure_required',
      case
        when g.code in ('stripe','paypal')
          and g.enabled
          and nullif(s.webhook_config->>'provider_webhook_id','') is not null
        then coalesce(s.webhook_config->>'registered_url','') <>
          'https://billing.incendiarynetworks.cc/api/payments/webhook/'||g.code
        else false
      end
    ),
    updated_at=now()
from public.payment_gateways g
where g.id=s.gateway_id;

commit;
