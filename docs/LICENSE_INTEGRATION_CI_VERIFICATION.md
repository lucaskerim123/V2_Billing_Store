# License Integration Verification

This file records the cross-system contract exercised by CI.

- License Master owns license issuance, validation, activation, installation state, rotation, suspension and termination.
- Billing Store owns customers, orders, invoices, billing state and commercial fulfilment.
- Order fulfilment uses the canonical customer_number for License Master identity.
- desired_state is the Billing Store request; remote_state changes only after License Master confirms the action.
- Current bindings are unique per customer and product, with orbitfs_base required before add-ons.
- Customer deployment uses the deployer integration role and manifest-driven installation identity.
