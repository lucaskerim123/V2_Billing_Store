# OrbitFS Theme System

Theme files live under `src/themes/<ThemeId>/` and each completed theme is a self-contained package.

## Active themes

- Admin: `V3A`
- Customer Portal (legacy/current baseline): `V3C`
- Customer Portal (transitional redesign): `V1_Changing`

Runtime layouts import only these wrappers:

- `src/themes/active/admin.css`
- `src/themes/active/customer.css`

The wrappers point to one packaged theme entrypoint. Applying a different theme only changes the relevant wrapper.

## Package format

Every theme folder requires:

- `manifest.json`
- the CSS entry file named by `manifest.entry`
- any supporting CSS/assets kept inside the theme folder

Manifest fields:

```json
{
  "id": "V3A",
  "name": "OrbitFS V3 Admin",
  "version": "3.0.0",
  "surface": "admin",
  "entry": "theme.css"
}
```

`surface` must be `admin` or `customer` so an admin theme cannot accidentally replace the customer portal theme and vice versa.

## Commands

From `web/`:

- `npm run theme:pack -- V3A` packages a theme to `theme-packages/` as an `.orbit-theme.zip`.
- `npm run theme:install -- <path-to-package.zip>` validates and installs a package without activating it.
- `npm run theme:install-apply -- <path-to-package.zip>` installs and immediately applies it to its declared surface.
- `npm run theme:apply -- V3A` applies an already installed theme.

The installer validates the package manifest, package root, theme surface and entry file, then rewrites only the appropriate active wrapper.

## Naming

OrbitFS theme IDs use a version plus surface suffix:

- `A` = Admin Panel
- `C` = Customer Portal

Examples: `V3A`, `V3C`.


## V1_Changing

`V1_Changing` is the transitional customer theme used while the customer portal is rebuilt surface-by-surface. It starts from the current customer theme behavior but owns new surface design in its own files. The first rebuilt surface is Base Deployer via `V1_Changing/base-deployer.css`.

Do not add Base Deployer styling back to shared portal CSS; keep it owned by the theme.
