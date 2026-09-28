-- License Manager decides whether a customer may hold multiple current licences.
-- Billing Store must not duplicate the old one-current-per-user/product authority rule.

drop index if exists public.license_bindings_one_active_per_user;
drop index if exists public.license_bindings_one_active_per_user_product;

create unique index if not exists license_bindings_one_current_master_license_uidx
  on public.license_bindings(license_id)
  where license_id is not null
    and archived_at is null
    and desired_state <> 'revoked';
