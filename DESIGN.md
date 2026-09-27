---
version: alpha
colors:
  background:
    value: "#071019"
  shell:
    value: "#09141f"
  panel:
    value: "#0c1925"
  panelRaised:
    value: "#102131"
  border:
    value: "#1e3547"
  borderStrong:
    value: "#31536a"
  text:
    value: "#edf5fa"
  muted:
    value: "#8297aa"
  brand:
    value: "#b64049"
  brandStrong:
    value: "#d05760"
  success:
    value: "#53b18f"
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

North Star: the supplied 12ui ZIP installation and deployed-application screens. The deployer should feel like a dedicated infrastructure installer/control console, not a generic Billing Store dashboard card stack.

The design must never drift back toward blue-first SaaS cards, rounded-square step markers, or multiple competing progress systems.

## Colors

The Base Deployer is near-black navy with cool blue-gray structure and a restrained OrbitFS red brand accent.

Red is reserved for active installation state, primary action, focus and deliberate emphasis. Green is semantic success only. Amber is warning only. The interface should not glow or use decorative gradients where a border or surface shift communicates hierarchy more clearly.

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
