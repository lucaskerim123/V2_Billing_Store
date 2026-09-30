# OrbitFS Theme System

OrbitFS has two independent theme surfaces:

- `A` = **Admin Panel**
- `C` = **Customer Portal**

That suffix is part of the theme contract. Admin theme IDs must end in `A`; customer theme IDs must end in `C`.

## Built-in families

- `V3A` — stable Admin baseline
- `V5A` — current Admin redesign, extending `V3A`
- `V3C` — stable Customer baseline
- `V5C` — current Customer redesign, extending `V3C`

V5 is an overlay family. It keeps the V3 baseline underneath it and only owns the surfaces intentionally redesigned for V5.

## Runtime switching

The application always bundles the built-in baseline and its built-in overlays:

- `src/themes/active/admin.css`
- `src/themes/active/customer.css`

The database setting chooses which theme ID is active for each surface. `ThemeRuntime` sets `data-orbitfs-theme` and built-in V5 CSS is scoped to that exact ID, so Admin and Customer themes can be switched independently without moving files around.

The Admin Theme Manager at `/admin/settings/themes` is the production switch. It has separate Admin and Customer selectors and broadcasts a change to other open OrbitFS tabs.

## Theme package format

Every filesystem theme lives under `src/themes/<ThemeId>/` and requires:

- `manifest.json`
- the CSS entry named by `manifest.entry`
- optional supporting CSS/assets inside the theme folder

Example child theme:

```json
{
  "id": "V5C",
  "name": "OrbitFS V5 Customer",
  "version": "5.0.0",
  "surface": "customer",
  "entry": "theme.css",
  "family": "V5",
  "extends": "V3C"
}
```

An `.orbit-theme.zip` must contain exactly one theme root whose folder name matches the manifest ID. Runtime-uploaded package assets must be embedded as data URLs.

## Commands

- `npm run theme:pack -- V5C` — create an `.orbit-theme.zip`
- `npm run theme:install -- <package.zip>` — validate/install a filesystem theme
- `npm run theme:install-apply -- <package.zip>` — install and change the local fallback
- `npm run theme:apply -- V5C` — change the local fallback only
- `npm run theme:sync` — rebuild built-in CSS bundles
- `npm run theme:validate` — validate IDs, surfaces, inheritance and entry files

Production selection stays database-backed in the Theme Manager. The CLI fallback is only used when runtime theme settings are unavailable.

## V5C ownership

V5C currently owns the customer Base Deployer redesign in:

- `src/themes/V5C/base-deployer-foundation.css`
- `src/themes/V5C/base-deployer.css`

Do not move V5C Base Deployer styling back into shared V3C portal CSS.
