---
version: alpha
colors:
  background:
    value: "#031422"
  shell:
    value: "#001b2b"
  panel:
    value: "#002535"
  panelRaised:
    value: "#002b40"
  border:
    value: "#07516a"
  borderStrong:
    value: "#075b72"
  text:
    value: "#e6efff"
  muted:
    value: "#8eafc3"
  brand:
    value: "#19ccdd"
  brandStrong:
    value: "#18e9de"
  success:
    value: "#28dfcf"
  warning:
    value: "#d39a4b"
  danger:
    value: "#cf5660"
typography:
  sans:
    fontFamily: "Inter, Geist, system-ui, sans-serif"
  utility:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, monospace"
rounded:
  panel:
    value: "10px"
  control:
    value: "7px"
  circle:
    value: "999px"
spacing:
  compact:
    value: "8px"
  standard:
    value: "14px"
  section:
    value: "20px"
  canvas:
    value: "28px"
components:
  baseDeployer:
    reference: "12ui ZIP installation and deployed-application screens"
    theme: "V1_Changing"
  progressMarker:
    shape: "circle"
    size: "32px"
  statusMarker:
    shape: "circle"
    semanticColors: true
---

## Overview

**V1_Changing** is the transitional OrbitFS customer theme. It intentionally begins from the current customer portal behavior while individual surfaces are replaced with a new visual system.

The first rebuilt surface is **Base Deployer** at `/portal/orbitfs`.

Visual authority: the supplied 12ui website package is canonical for Base Deployer and Instance Control Panel presentation. Match its responsive layout, spacing, typography, colors, borders, hierarchy and state composition directly. Do not reinterpret it into a separate OrbitFS theme or use it merely as inspiration.

Base runtime/deployment code remains the functional authority. Visual work adapts real state and actions into the supplied website design without changing deployment semantics.

The design must not drift into a generic Billing Store card stack or introduce a second visual language alongside the supplied website.

## Colors

The Base Deployer follows the supplied website's deep navy, cyan and teal system. Cyan/teal is the interaction and active-state accent; pale blue-white is primary text; muted blue-gray carries secondary information.

Semantic success/warning/danger remain distinct where the supplied state screens use them. Do not substitute the previous red-accent palette.

## Typography

Use Inter/Geist-style compact product typography. Headings are concise and operational. Utility labels use uppercase, high tracking and small sizes. IDs, checksums and environment values may use the utility mono face.

The deployer is a product tool, not a marketing page. Avoid oversized hero typography.

## Layout

Desktop Base Deployer uses three stable regions:

1. **Left rail** — primary stages and only the active stage's substeps.
2. **Main canvas** — one dominant current task.
3. **Right summary** — customer infrastructure and installation status.

The main canvas owns attention. The side rails inform rather than compete.

At smaller desktop/laptop widths, compress before rearranging. At tablet widths, preserve the left progress rail while moving the right summary below the main task. At phone widths, stack intentionally while preserving order and all actions.

After successful validation, the installation workflow disappears and the route becomes the deployed Base control panel.

## Elevation & Depth

Prefer edge, surface and density changes over shadows. Static panels use one border and minimal/no shadow. The top-level deployer shell may use a restrained page-level shadow.

## Shapes

**Progress and status markers are circles.** This is a canonical rule.

Cards/panels use 8–10px radii. Buttons/fields use 7px radii. Pills are reserved for compact textual state badges only.

Do not use rounded squares for numbered installation stages or completion markers.

## Components

### Base Deployer progress rail

Primary stages are vertical on desktop. Each stage has a circular marker, title and short factual state. Completed stages use success semantics; current stage uses OrbitFS red.

Only the active primary stage exposes lettered substeps. Do not render every stage's substeps simultaneously.

### Main task

Show one task surface at a time. Forms and actions remain inside the task canvas. Avoid nested generic portal cards unless the information is genuinely a separate object.

### Deployment summary

Keep infrastructure state compact: Supabase, Vercel, licence/authority, installation identity and release.

### Deployed control panel

Once the deployment is healthy and validated, replace the installer with operational controls: production runtime, infrastructure, update/redeploy, undeploy/uninstall and history.

Danger actions remain visually separated from normal deployment actions.

## Do's and Don'ts

**Do**
- Match the supplied ZIP's hierarchy and density.
- Use circles for staged progress.
- Keep the existing portal top navigation until that surface is deliberately redesigned.
- Preserve real Billing Store actions and License Manager authority.
- Keep layout responsive without turning desktop into a generic vertical card waterfall.

**Don't**
- Restyle V3C selectors to simulate a new deployer theme.
- Add deployer-specific CSS back to shared `portal-v2.css`.
- Introduce a second progress model.
- Use blue as the Base Deployer's primary accent.
- Hide lifecycle consequences or present failed/partial deployment as success.
