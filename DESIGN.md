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
    theme: "V5C"
  progressMarker:
    shape: "circle"
    size: "32px"
  statusMarker:
    shape: "circle"
    semanticColors: true
---

## Overview

**V5C** is the transitional OrbitFS customer theme. It intentionally begins from the current customer portal behavior while individual surfaces are replaced with a new visual system.

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

## V6 Customer and Admin System

V6 is the compact OrbitFS product interface derived from the supplied 12ui ZIP and maintained with the Frontend Design Premium consistency contract.

### North Star

V6 must feel like one operational product, not legacy portal pages wrapped in dark cards. The interface uses a compact dark navy canvas, restrained violet for selected/primary state, cyan for information and focus, and teal/green only for semantic success. Density is intentionally smaller than V5 while preserving readable controls and clear hierarchy.

Avoid:
- oversized hero blocks in operational screens,
- full-width primary buttons when a compact action is sufficient,
- repeated nested cards,
- pill-shaped navigation actions,
- duplicate selectors or controls for the same decision,
- hidden controls caused by dark-on-dark surfaces,
- page-local button systems that conflict with shared action hierarchy.

### V6C customer flow

Customer shell uses the V6C theme only under `/portal`. The logged-out/public storefront does not import customer theme CSS.

Store purchasing is a three-route flow:
1. Store `/portal/products`
2. Basket `/portal/basket`
3. Checkout `/portal/checkout`

These remain separate pages and share the same step navigation. Each decision region has one clear primary action; navigation and utility actions are compact outline/ghost controls.

### V6A admin system

V6A is an Admin presentation layer over the existing V5A backend, permissions, routes and data ownership. It must not duplicate business state or introduce new technical authority.

Canonical V6A shell:
- compact top navigation,
- compact contextual sub-navigation,
- maximum working canvas approximately 1280px,
- 8px panel radius,
- 6px control radius,
- 32–34px standard controls,
- 23px page headings,
- 7–9px utility/control copy where the existing application uses compact desktop density,
- one obvious primary action per decision region,
- neutral secondary actions,
- visually separated danger actions.

V6A account controls include a compact avatar menu and real logout. V5A keeps that V6A-only control hidden.

### V6A protected exclusions

Do not redesign these Admin systems until explicitly approved:
- Base Deployment / Base Deployer
- Update Release System / Update Release Deployer
- their direct release execution surfaces

`AdminLayoutClient` marks these routes with `data-admin-v6a-exempt="true"`. V6A must preserve the internal Base/Update workflow presentation and structure on those routes. The shared Admin top bar, account menu and contextual sub-navigation may use the V6A chrome so the protected workflows still feel part of the same Admin application.

Release Channels, Customer Licences, License System and Product Connections are not exempt and may use V6A.

### Interaction consistency

Buttons use two axes: emphasis (primary / secondary / quiet) and intent (normal / danger). Full-width primary controls are reserved for workflows where the action genuinely owns the available action area.

Inputs, selects and textareas must remain visibly separated from the background and expose visible focus. Tables/lists should be dense, bounded and readable rather than converted into oversized cards.

Public/customer/Admin theme selectors must stay scoped to their runtime surface; no V6 customer/admin styles may leak onto the logged-out public site.


---

## V6A Admin Theme

**V6A** is the compact OrbitFS Admin presentation layer. It reuses the existing V5A/Admin backend, permissions, routes, and operational APIs; V6A does not create a second source of truth.

### North star

V6A should feel like a focused operations console: compact, fast to scan, structured, and calm. It follows the same dark navy / purple / cyan family as V6C without copying customer-facing layouts into staff workflows.

Use the supplied 12ui design package and the V6C visual family for proportion, density, colour relationships and control treatment. Admin information density is intentionally higher than the customer portal.

### Admin layout

- Global top bar: 58px class, compact horizontal navigation, small utility controls, circular account menu.
- Context/sub-navigation: short, readable and route-specific.
- Content canvas: approximately 1280px maximum where a bounded width improves scanning; data-heavy workspaces may use the available width.
- Headings are operational, not marketing-sized.
- Default panels use one border, minimal/no shadow and 6–8px radii.
- Forms use 32–34px controls with explicit labels and visible focus states.
- Primary actions use the purple V6 brand treatment; secondary actions use navy outlines; destructive actions stay visually separated and quiet until confirmation.

### Settings

Settings is an operational configuration workspace, not a grid of decorative cards.

- The hub shows live Billing configuration state and common live actions.
- Settings editors show authoritative live state, last refresh, setting/group counts, public-read state and high-impact settings.
- Unsaved rows are visibly marked before saving.
- Reload and reset are available without leaving the page.
- Save state remains sticky and reports whether changes are live or unsaved.
- Technical authority remains with the owning system; Billing settings must not duplicate License Manager technical truth.

### Data and workflow surfaces

Customer, order, invoice, support, product, payment, staff, alert, audit and content workflows keep their existing backend behavior. V6A changes presentation and interaction consistency only.

Lists use compact rows and visible states. Detail pages use structured workspaces with one clear action hierarchy. Long forms remain naturally scrollable.

### Base and Update release systems

**Do not redesign the Base Deployment / Base Release workflow or Update Release System workflow until explicitly authorised.**

V6A may apply shared Admin chrome (top bar, account controls, surrounding shell) so these routes remain visually connected to Admin, but their internal layout, release stages, actions and workflow composition stay unchanged.

### Account and logout

V6A exposes a compact circular Admin account menu with identity, role, customer-portal link and Log out. The control is V6A-only; V5A remains visually unchanged.

### Anti-patterns

- No oversized admin heroes or giant metric cards.
- No full-width primary buttons unless the action genuinely owns the entire decision area.
- No tiny pill controls for important navigation.
- No duplicate dropdown + tile selectors for the same choice.
- No browser-native alert/confirm/prompt for product interactions.
- No Base/Update workflow restructuring without explicit approval.


## V6 Mail System

OrbitFS Mail is part of the V6 operational product family. Its current functionality is the design authority for scope; the visual redesign must wrap the existing mail system before new mail capabilities are added.

Current Mail surfaces:
- `/mail` — authorised mailbox launcher plus transactional Mail queue.
- `/mail/mailbox/[account]` — Inbox, Outbox, Sent, Spam and Trash; search, message threads, compose, reply/reply-all, forward, read state, move, spam/block, restore and delete.
- `/mail/admin` — runtime Mail settings, customer email subscription categories/event routing, mailbox management, spam protection, lifecycle templates and delivery history.

Visual direction:
- use the V6 dark navy shell with restrained violet/indigo selection and primary actions;
- preserve cyan for focus/information and green for healthy/success state;
- keep panels compact with 7–10px radii and one border rather than stacked decorative cards;
- desktop mailbox workspaces use three operational regions: folder rail, message list and reader;
- configuration screens use compact disclosure sections and live counts, not invented KPI data;
- mobile must retain real folder navigation and message-reader back navigation.

Do not add visual tabs, metrics, folders, campaigns, scheduling or provider controls unless the underlying system supports them. New capabilities should be added after this current-system pass and then inherit this Mail visual system.
