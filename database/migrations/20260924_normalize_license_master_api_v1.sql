-- Normalize all Billing Store references to the canonical License Master v1 API.
-- Safe to re-run.

UPDATE public.license_master_connection
SET master_url = 'https://incendiarynetworks.cc/api/v1',
    enabled = true,
    last_error = NULL,
    updated_at = now()
WHERE master_url IS DISTINCT FROM 'https://incendiarynetworks.cc/api/v1';

UPDATE public.products
SET license_api_url = 'https://incendiarynetworks.cc/api/v1/license'
WHERE lower(coalesce(license_product_key,'')) IN ('orbitfs_base','orbitfs_mcp','orbitfs_apex','orbitfs_studio')
  AND license_api_url IS DISTINCT FROM 'https://incendiarynetworks.cc/api/v1/license';

UPDATE public.license_api_settings
SET base_url = 'https://incendiarynetworks.cc/api/v1/license'
WHERE base_url IS DISTINCT FROM 'https://incendiarynetworks.cc/api/v1/license';
