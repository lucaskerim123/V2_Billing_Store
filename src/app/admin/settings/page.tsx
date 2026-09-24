import Link from "next/link";
import "../settings-system-v2.css";

type Card={title:string;description:string;href:string;badge:string;tags:string[]};
type Section={title:string;description:string;cards:Card[]};

const sections:Section[]=[
 {title:"Platform & customer experience",description:"Core identity, account behaviour and the customer-facing presentation layer.",cards:[
  {title:"Site identity & naming",description:"Names used across Store, Portal, Admin, support, authentication and browser titles.",href:"/admin/settings/identity",badge:"Identity",tags:["Names","Titles","Company"]},
  {title:"General system",description:"Registrations, verification, maintenance, account lifecycle and regional defaults.",href:"/admin/settings/general",badge:"Core",tags:["Accounts","Availability","Region"]},
  {title:"Site customisation",description:"Branding, colours, canonical URLs, layout density, homepage content, links and portal presentation.",href:"/admin/settings/customization",badge:"Appearance",tags:["Branding","Colours","Layout"]},
  {title:"Storefront presentation",description:"Customer Store copy used by the catalogue and checkout surface, including hero and add-on sections.",href:"/admin/settings/store",badge:"Store",tags:["Storefront","Copy","Checkout"]},
  {title:"Customer downloads",description:"Customer download access, entitlement presentation and delivery behaviour.",href:"/admin/settings/downloads",badge:"Downloads",tags:["Entitlements","Delivery","Portal"]}
 ]},
 {title:"Commerce & billing",description:"Money movement, invoice behaviour, gateways and catalogue defaults.",cards:[
  {title:"Billing & Wallet",description:"Currency, Wallet behaviour, recharge limits, tax and payment rules.",href:"/admin/settings/billing",badge:"Billing",tags:["Currency","Wallet","Tax"]},
  {title:"Invoices",description:"Numbering, due dates, reminders, overdue actions, branding and invoice content.",href:"/admin/settings/invoices",badge:"Invoices",tags:["Lifecycle","Numbering","Reminders"]},
  {title:"Payment gateways",description:"Stripe, PayPal and other providers, webhooks, supported currencies and availability.",href:"/admin/payments/setup",badge:"Gateways",tags:["Stripe","PayPal","Webhooks"]},
  {title:"Products & catalogue",description:"Fulfilment, addons, upgrades, coupons, quantities, stock and checkout defaults.",href:"/admin/settings/products",badge:"Catalogue",tags:["Fulfilment","Add-ons","Stock"]},
  {title:"Support settings",description:"Ticket defaults, customer actions, guest support and support lifecycle behaviour.",href:"/admin/settings/support",badge:"Support",tags:["Tickets","Guest access","Lifecycle"]}
 ]},
 {title:"Licensing, operations & access",description:"License Master connectivity, staff access, messaging, alerts and account enforcement.",cards:[
  {title:"License Master connection",description:"Authority URL, connection status, API contract and bounded health test for the licensing authority.",href:"/admin/settings/license-master",badge:"Licensing",tags:["Authority","Health","API"]},
  {title:"Staff System",description:"Staff identities, groups, primary roles and exact inherited permission maps.",href:"/admin/settings/staff",badge:"Access",tags:["Staff","Groups","Permissions"]},
  {title:"Permission map",description:"Inspect and maintain administrative permission definitions used by staff groups.",href:"/admin/settings/permissions",badge:"Permissions",tags:["RBAC","Capabilities","Audit"]},
  {title:"Themes",description:"Installed themes and active Store/Admin presentation packages.",href:"/admin/settings/themes",badge:"Themes",tags:["Store","Admin","Appearance"]},
  {title:"Support workflow",description:"Departments, routing, staffing, escalations and automatic ticket messages.",href:"/admin/support/settings",badge:"Support ops",tags:["Departments","Routing","Escalation"]},
  {title:"OrbitFS Alert System",description:"Configure alert delivery, composer defaults, safety limits and available alert types.",href:"/admin/settings/alerts",badge:"Alerts",tags:["Types","Delivery","Targeting"]},
  {title:"Outbound Mail",description:"System email behaviour, sender identities, automation and reusable templates.",href:"/admin/settings/outbound-mail",badge:"Messaging",tags:["Senders","Automation","Templates"]},
  {title:"Account enforcement",description:"View and manage currently suspended or banned customer accounts, reasons and expiry times.",href:"/admin/settings/enforcement/accounts",badge:"Enforcement",tags:["Suspensions","Bans","Expiry"]}
 ]}
];

export default function SettingsHub(){return <main className="adminShell settingsHubV2 settingsCompact">
 <header className="settingsHubHeader"><div><p className="eyebrow">MASTER ADMIN · SYSTEM CONFIGURATION</p><h1>System settings</h1><p className="muted settingsHubIntro">Configuration is grouped by responsibility. Expand only the area you need, then open the exact settings page.</p></div><aside className="settingsLiveNote"><b>Live config</b><span>Most changes apply from Supabase without a redeploy.</span></aside></header>
 <div className="settingsAccordion">{sections.map((section,index)=><details className="settingsSectionV2" key={section.title} open={index===0}>
  <summary className="settingsSectionSummary"><span className="settingsSectionIndex">0{index+1}</span><div><h2>{section.title}</h2><p>{section.description}</p></div><span className="settingsSectionCount">{section.cards.length}</span><span className="settingsChevron">⌄</span></summary>
  <div className="settingsAreaGrid">{section.cards.map(card=><Link className="settingsAreaCard" href={card.href} key={card.href}><div className="settingsAreaCopy"><div className="settingsAreaTitle"><b>{card.title}</b><span className="settingsAreaBadge">{card.badge}</span></div><p>{card.description}</p><div className="settingsAreaTags">{card.tags.map(tag=><span key={tag}>{tag}</span>)}</div></div><span className="settingsAreaGo">Open →</span></Link>)}</div>
 </details>)}</div>
 </main>}
