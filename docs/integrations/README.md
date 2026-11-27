# Billing Store Integration Manager

The Integration Manager is a permanent Billing Store admin feature. Individual integrations are separate modules and are not part of Billing Store's core event system.

## Installation destination

- The only installation destination is `src/integrations/`.
- That directory is intentionally empty in this build (apart from its Git keep-file). Do not develop, store, or maintain the Mail module here until it is transferred from the Mail System repository.
- A future module is placed in `src/integrations/<module-id>/` and discovered from its manifest.
- The manager must report zero installed and zero installable modules while this directory contains no valid module packages.
- Discovery reads and validates metadata only. It does not execute arbitrary module code, run package scripts, or apply SQL automatically.
- Installing executable code requires trusted package validation, host integration review, an explicit installation action, and a manually authorised production release. It never deploys automatically.

## Billing-owned events

Business events are defined in `src/lib/billing-email-events.ts`. They are part of Billing Store and exist independently of any installed integration. Password reset, email verification, customer creation, staff invitations, license delivery, invoice/order/service lifecycle, support and deployment events are examples.

The read-only authenticated endpoint `GET /api/admin/integrations/events` exposes the event catalogue to authorised integrations. It includes stable event keys, descriptions and variable names. Sensitive values such as reset, verification, invitation and guest-access links are marked sensitive; actual token values are never included in the catalogue.

Billing Store owns event creation and trusted event payloads. A future email integration may configure templates, sender selection, recipient rules, routing, conditions and enablement for those existing events. It must not create, rename, or own Billing business events.

## Ownership boundaries

- Billing Store owns customers, orders, subscriptions, payments, business workflows, event definitions, event payloads, authentication and authorisation.
- Mail System owns mail infrastructure, mailboxes, transport, sending/receiving, credentials, delivery processing and delivery logs.
- The installed integration connects the two and owns configurable event-to-email mappings. It does not replace Billing's event definitions or Mail System's transport.

## Database and deployment

Integration state and authoritative database ownership remain with the central Master Database System. This repository change does not apply migrations, delete database records, or alter live Supabase data.

Production deployment remains manual-only. A commit or Full Scan must never deploy production.
