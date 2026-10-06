# OrbitFS UX Contract

## Scope

This contract covers authenticated V6 customer and Admin product workflows. Business authority remains with the owning system; presentation must not duplicate technical truth.

## Shared interaction rules

- Navigation uses links; actions use buttons.
- Route changes close open menus and popovers.
- Loading, empty, success and error states stay inside the product surface and preserve stable layout.
- Browser `alert()`, `confirm()` and `prompt()` are not product UI. Security-sensitive, destructive and permission-changing actions use the shared app confirmation dialog.
- Busy actions keep their control footprint stable and cannot be double-submitted.
- Success feedback names the completed action. Correctable failures remain inline next to the owning workflow.
- Keyboard focus is visible. Modal dialogs restore focus when closed and support Escape unless an action is actively committing.

## My OrbitFS authority surfaces

### License Controller

Trigger → select a linked licence.

Pending → keep the selected licence visible while authoritative status loads or an action commits.

Success → refresh authoritative licence/install/channel state without navigating away.

Failure → keep the selected licence and show an inline actionable error.

Rotate key → confirm in-app; replacement key is shown once and stays visible until dismissed or the selected licence changes.

Unlock installation → confirm in-app; do not imply infrastructure deletion.

### Release Channels

License Manager owns channel definition and access.

Stable/open channels may be available automatically to eligible customers. Restricted channels are available only from authoritative grants.

Request access → collect use case and environment inline; submitting does not imply approval.

Leave restricted channel → confirm in-app; removal affects future Base + Update discovery but must not silently rewrite an installed Base channel.

Approved request without an authoritative grant remains a pending synchronization state, not available access.

### Base + Update channel consistency

Base Deployment and Update Release System consume the same enabled customer-visible channel definitions. Customer-facing access must never be duplicated into a separate Base-only or Update-only channel authority.
