# OrbitFS Theme System

OrbitFS has two independently selectable theme surfaces: Admin Panel and Customer Portal.

Current production bases:
- Admin: V3A
- Customer Portal: V3C

New V5 child themes:
- V5A extends V3A
- V5C extends V3C

V5 starts visually identical to V3 and owns only new overrides. That avoids copying the large legacy CSS stack and gives new design work a clean boundary.

## Runtime selection

Admin layout imports src/themes/active/admin.css.
Customer layout imports src/themes/active/customer.css.

Those files are registries. They compile the V3 base and built-in child-theme overrides together. ThemeRuntime reads the active theme from Billing settings and sets the exact theme ID on the html element.

Legacy compatibility attributes remain in place so existing V3 selectors continue to work while V5 is built.

Database-imported themes are injected only while active.

## Theme package

Each filesystem theme lives under src/themes/<ThemeId>/ and requires:
- manifest.json
- the CSS entry named by manifest.entry
- optional supporting CSS files

Child themes may declare extends.

V5 child override rules must be scoped to their exact runtime ID:
- html[data-admin-theme-id="V5A"]
- html[data-customer-theme-id="V5C"]

## ZIP packages

The package format is .orbit-theme.zip. The ZIP root must match the manifest ID and contain exactly one manifest.json.

CLI:
- npm run theme:pack -- V5C
- npm run theme:install -- <package.zip>
- npm run theme:install-apply -- <package.zip>
- npm run theme:apply -- V5C
- npm run theme:sync

The Admin Theme Manager can also import ZIP packages. Relative CSS imports are bundled on upload. Runtime-imported assets must be embedded as data URLs.

Local CLI apply changes only the local fallback. Production runtime selection is stored in Billing theme settings.

## Naming

A = Admin Panel.
C = Customer Portal.

Examples: V3A, V3C, V5A, V5C.

V1_Changing remains historical/transitional work and is no longer the customer theme baseline.
