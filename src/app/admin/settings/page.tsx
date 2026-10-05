"use client";

import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import "../settings-system-v2.css";

type Card={title:string;description:string;href:string;badge:string;tags:string[]};
type Section={title:string;description:string;cards:Card[]};

const sections:Section[]=[
 {title:"Platform & customer experience",description:"Core identity, account behaviour and the customer-facing presentation layer.",cards:[
  {title:"Site identity & naming",description:"Names used across Store, Portal, Admin, support, authentication and browser titles.",href:"/admin/settings/identity",badge:"Identity",tags:["Names","Titles","Company"]},
  {title:"General system",description:"Registrations, verification, maintenance, account lifecycle and regional defaults.",href:"/admin/settings/general",badge:"Core",tags:["Accounts","Availability","Region"]},
  {title:"Site customisation",description:"Branding, colours, canonical URLs, layout density, homepage content, links and portal presentation.",href:"/admin/settings/customization",badge:"Appearance",tags:["Branding","Colours","Layout"]},
  {title:"Storefront presentation",description:"Customer Store copy used by the catalogue and checkout surface, including hero and add-on sections.",href:"/admin/settings/store",badge:"Store",tags:["Storefront","Copy","Checkout"]},
  {title:"Customer downloads",description:"Customer download access, entitlement presentation and delivery behaviour.",href:"/admin/settings/downloads",badge:"Downloads",tags:["Entitlements","Delivery","Portal"]},
  {title:"Global portal banner",description:"Configure the persistent Info, Warning or Alert banner shown across every customer portal page.",href:"/admin/settings/portal-banner",badge:"Banner",tags:["Global","Customer portal","Dismissal"]}
 ]},
 {title:"Commerce & billing",description:"Money movement, invoice behaviour, gateways and catalogue defaults.",cards:[
  {title:"Billing & Wallet",description:"Currency, Wallet behaviour, recharge limits, tax and payment rules.",href:"/admin/settings/billing",badge:"Billing",tags:["Currency","Wallet","Tax"]},
  {title:"Invoices",description:"Numbering, due dates, reminders, overdue actions, branding and invoice content.",href:"/admin/settings/invoices",badge:"Invoices",tags:["Lifecycle","Numbering","Reminders"]},
  {title:"Payment gateways",description:"Stripe, PayPal and other providers, webhooks, supported currencies and availability.",href:"/admin/payments/setup",badge:"Gateways",tags:["Stripe","PayPal","Webhooks"]},
  {title:"Products & catalogue",description:"Fulfilment, addons, upgrades, coupons, quantities, stock and checkout defaults.",href:"/admin/settings/products",badge:"Catalogue",tags:["Fulfilment","Add-ons","Stock"]}
 ]},
 {title:"Licensing, operations & access",description:"License Manager connectivity, staff access, messaging, alerts and account enforcement.",cards:[
  {title:"API Connections",description:"Select the official OrbitFS API used by Billing. URLs must exactly match the License Manager registry.",href:"/admin/settings/api-connections",badge:"API",tags:["Authority","Registry","Health"]},
  {title:"Licence commerce policy",description:"Billing-side enforcement triggers and customer Licence Controller permissions. License Manager remains authoritative for licence state.",href:"/admin/settings/licensing",badge:"Policy",tags:["Enforcement","Customer controls","Grace"]},
  {title:"Staff System",description:"Staff identities, groups, primary roles and exact inherited permission maps.",href:"/admin/settings/staff",badge:"Access",tags:["Staff","Groups","Permissions"]},
  {title:"Permission map",description:"Inspect and maintain administrative permission definitions used by staff groups.",href:"/admin/settings/permissions",badge:"Permissions",tags:["RBAC","Capabilities","Audit"]},
  {title:"Themes",description:"Installed themes and active Store/Admin presentation packages.",href:"/admin/settings/themes",badge:"Themes",tags:["Store","Admin","Appearance"]},
  {title:"Support settings",description:"Ticket defaults, customer actions, guest support and support lifecycle behaviour.",href:"/admin/settings/support",badge:"Support",tags:["Tickets","Guest access","Lifecycle"]},
  {title:"Support workflow",description:"Departments, routing, staffing, escalations and automatic ticket messages.",href:"/admin/support/settings",badge:"Support ops",tags:["Departments","Routing","Escalation"]},
  {title:"OrbitFS Alert System",description:"Configure alert delivery, composer defaults, safety limits and available alert types.",href:"/admin/settings/alerts",badge:"Alerts",tags:["Types","Delivery","Targeting"]},
  {title:"Outbound Mail",description:"System email behaviour, sender identities, automation and reusable templates.",href:"/admin/settings/outbound-mail",badge:"Messaging",tags:["Senders","Automation","Templates"]},
  {title:"Account enforcement",description:"View and manage currently suspended or banned customer accounts, reasons and expiry times.",href:"/admin/settings/enforcement/accounts",badge:"Enforcement",tags:["Suspensions","Bans","Expiry"]}
 ]}
];

export default function SettingsHub(){
 const sb=useMemo(()=>createClient(),[]);
 const [live,setLive]=useState<{count:number;admin:string;customer:string;refreshed:Date|null;loading:boolean;error:string}>({count:0,admin:"—",customer:"—",refreshed:null,loading:true,error:""});

 async function refresh(){
  setLive(current=>({...current,loading:true,error:""}));
  const [settingsResult,themeResult]=await Promise.all([
    sb.from("app_settings").select("key"),
    sb.rpc("orbitfs_theme_list")
  ]);
  if(settingsResult.error||themeResult.error){
    setLive(current=>({...current,loading:false,error:settingsResult.error?.message||themeResult.error?.message||"Could not read live configuration."}));
    return;
  }
  setLive({
    count:settingsResult.data?.length||0,
    admin:themeResult.data?.active_admin||"—",
    customer:themeResult.data?.active_customer||"—",
    refreshed:new Date(),
    loading:false,
    error:""
  });
 }

 useEffect(()=>{void refresh()},[sb]);

 return <main className="adminShell settingsHubV2 settingsCompact">
  <header className="settingsHubHeader">
   <div><p className="eyebrow">MASTER ADMIN · SYSTEM CONFIGURATION</p><h1>System settings</h1><p className="muted settingsHubIntro">Live Billing configuration grouped by responsibility. Open one area, review its current state, then apply only the settings you intend to change.</p></div>
   <aside className="settingsLiveNote"><b>Live configuration</b><span>{live.loading?"Refreshing authoritative state…":live.error?"Status unavailable":"Connected to Billing Supabase"}</span><button type="button" className="secondary" onClick={()=>void refresh()} disabled={live.loading}>{live.loading?"Refreshing…":"Refresh live"}</button></aside>
  </header>

  <section className="settingsRuntimeStrip" aria-label="Settings runtime status">
   <article><small>Configuration items</small><strong>{live.loading?"…":live.count}</strong><span>Authoritative app settings</span></article>
   <article><small>Admin theme</small><strong>{live.admin}</strong><span>Current Admin presentation</span></article>
   <article><small>Customer theme</small><strong>{live.customer}</strong><span>Current Portal presentation</span></article>
   <article><small>Last refresh</small><strong>{live.refreshed?live.refreshed.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}):"—"}</strong><span>{live.error||"Read live from current Billing project"}</span></article>
  </section>

  <section className="settingsQuickActions" aria-label="Live settings actions">
   <div className="settingsQuickActionsIntro"><p className="eyebrow">LIVE ACTIONS</p><b>Common configuration controls</b><span>These open live administrative settings. Changes remain governed by each destination's save/test flow.</span></div>
   <div className="settingsQuickActionGrid">
    <Link href="/admin/settings/api-connections"><small>Authority</small><b>API Connections</b><span>Test or select the official License Manager endpoint.</span></Link>
    <Link href="/admin/settings/themes"><small>Presentation</small><b>Theme Manager</b><span>Review installed themes and active Admin/Customer surfaces.</span></Link>
    <Link href="/admin/settings/portal-banner"><small>Customer portal</small><b>Global banner</b><span>Publish or disable the persistent portal notice.</span></Link>
    <Link href="/admin/settings/staff"><small>Access</small><b>Staff System</b><span>Manage staff, groups and inherited permission maps.</span></Link>
   </div>
  </section>

  <div className="settingsAccordion">{sections.map((section,index)=><details className="settingsSectionV2" key={section.title} open={index===0}>
   <summary className="settingsSectionSummary"><span className="settingsSectionIndex">0{index+1}</span><div><h2>{section.title}</h2><p>{section.description}</p></div><span className="settingsSectionCount">{section.cards.length}</span><span className="settingsChevron">⌄</span></summary>
   <div className="settingsAreaGrid">{section.cards.map(card=><Link className="settingsAreaCard" href={card.href} key={card.href}><div className="settingsAreaCopy"><div className="settingsAreaTitle"><b>{card.title}</b><span className="settingsAreaBadge">{card.badge}</span></div><p>{card.description}</p><div className="settingsAreaTags">{card.tags.map(tag=><span key={tag}>{tag}</span>)}</div></div><span className="settingsAreaGo">Open →</span></Link>)}</div>
  </details>)}</div>
 </main>;
}
