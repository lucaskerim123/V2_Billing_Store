"use client";

import Link from "next/link";
import {useCallback,useEffect,useRef,type ReactNode} from "react";

type Props={
  path:string;
  children:ReactNode;
  canAccessAdmin?:boolean;
  loggingOut?:boolean;
  onLogout?:()=>void;
  tools?:ReactNode;
  banner?:ReactNode;
  accountName?:string;
  accountEmail?:string;
};

const nav=[
  ["Dashboard","/portal"],
  ["Store","/portal/products"],
  ["Support","/portal/support"],
] as const; type RouteInfo={key:string;eyebrow:string;title:string;description:string};
function routeInfo(path:string):RouteInfo|null{
  if(path==="/portal")return {key:"dashboard",eyebrow:"COMPLETE PLATFORM",title:"Your OrbitFS, all in one place.",description:"Billing, support, products, deployments, licences and updates in one consistent customer portal."};
  if(path==="/portal/products")return {key:"store",eyebrow:"ORBITFS STORE",title:"Build your OrbitFS setup.",description:"Choose your core system, add the components you need and move through Basket and Checkout when you are ready."};
  if(path==="/portal/support")return {key:"support",eyebrow:"SUPPORT CENTRE",title:"Help when you need it.",description:"Open and track support requests, review conversations and browse the OrbitFS knowledge base."};
  if(path.startsWith("/portal/settings"))return {key:"settings",eyebrow:"MY ACCOUNT",title:"Account settings.",description:"Manage your profile, billing details, Wallet, preferences and security."};
  if(path.startsWith("/portal/downloads"))return {key:"downloads",eyebrow:"PRODUCT DOWNLOADS",title:"Your OrbitFS downloads.",description:"Access published files attached to your active paid product entitlements."};
  if(path.startsWith("/portal/billing"))return {key:"billing",eyebrow:"BILLING",title:"Billing overview.",description:"Review orders, invoices and payments from your account."};
  if(path.startsWith("/portal/payment-history"))return {key:"payment-history",eyebrow:"BILLING · HISTORY",title:"Payment history.",description:"All recorded charges and refunds from this billing system."};
  if(path.startsWith("/portal/orbitfs/license"))return {key:"license",eyebrow:"MY ORBITFS · LICENCE",title:"License Controller",description:"Review authoritative licence state, component entitlements, installation bindings and the customer actions License Manager permits."};
  if(path.startsWith("/portal/orbitfs/channels"))return {key:"channels",eyebrow:"MY ORBITFS · RELEASE CHANNELS",title:"Release Channels",description:"Manage the single License Manager channel entitlement used by both Base and Update release discovery."};
  return null;
}

function active(label:string,path:string){
  if(label==="Dashboard")return path==="/portal";
  if(label==="Store")return path.startsWith("/portal/products")||path.startsWith("/portal/basket")||path.startsWith("/portal/checkout");
  if(label==="Billing")return path.startsWith("/portal/billing")||path.startsWith("/portal/orders")||path.startsWith("/portal/invoices")||path.startsWith("/portal/payment-history");
  if(label==="Support")return path.startsWith("/portal/support");
  if(label==="My OrbitFS")return path.startsWith("/portal/orbitfs");
  return false;
}

function initials(name?:string,email?:string){
  const clean=String(name||"").trim();
  if(clean){
    const parts=clean.split(/\s+/).filter(Boolean);
    return (parts.length>1?parts[0][0]+parts[parts.length-1][0]:parts[0].slice(0,2)).toUpperCase();
  }
  const local=String(email||"").split("@")[0]||"OF";
  return local.slice(0,2).toUpperCase();
}

export default function V6CDesignShell({path,children,canAccessAdmin=false,loggingOut=false,onLogout,tools,banner,accountName,accountEmail}:Props){
  const billingMenuRef=useRef<HTMLDetailsElement|null>(null);\n  const licenseMenuRef=useRef<HTMLDetailsElement|null>(null);   const orbitfsMenuRef=useRef<HTMLDetailsElement|null>(null);
  const accountMenuRef=useRef<HTMLDetailsElement|null>(null);
  const closeMenus=useCallback((except?:HTMLDetailsElement|null)=>{
    if(billingMenuRef.current&&billingMenuRef.current!==except)billingMenuRef.current.open=false;\n    if(licenseMenuRef.current&&licenseMenuRef.current!==except)licenseMenuRef.current.open=false;     if(orbitfsMenuRef.current&&orbitfsMenuRef.current!==except)orbitfsMenuRef.current.open=false;
    if(accountMenuRef.current&&accountMenuRef.current!==except)accountMenuRef.current.open=false;
  },[]);
  useEffect(()=>{closeMenus()},[path,closeMenus]);
  useEffect(()=>{
    const onPointer=(event:PointerEvent)=>{
      const target=event.target as Node;
      if(!billingMenuRef.current?.contains(target)&&!licenseMenuRef.current?.contains(target)&&!orbitfsMenuRef.current?.contains(target)&&!accountMenuRef.current?.contains(target))closeMenus();
    };
    const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")closeMenus()};
    document.addEventListener("pointerdown",onPointer);
    document.addEventListener("keydown",onKey);
    return()=>{document.removeEventListener("pointerdown",onPointer);document.removeEventListener("keydown",onKey)};
  },[closeMenus]);

  const info=routeInfo(path);
  const routeKey=info?.key ?? ((path.startsWith("/portal/products")||path.startsWith("/portal/basket")||path.startsWith("/portal/checkout"))?"store":path.startsWith("/portal/support")?"support":(path.startsWith("/portal/billing")||path.startsWith("/portal/orders")||path.startsWith("/portal/invoices"))?"billing":path.startsWith("/portal/orbitfs/releases")?"updates":path.startsWith("/portal/orbitfs/base")?"base":path==="/portal/orbitfs"?"orbit-home":"page");
  return <div className="v6c-screen">
    <header className="v6c-appbar">
      <Link className="v6c-mark" href="/portal" aria-label="OrbitFS home"><span/><b>OrbitFS</b></Link>
      <nav className="v6c-globalnav" aria-label="Customer Portal">
        <Link href="/portal" className={active("Dashboard",path)?"is-active":""}>Dashboard</Link>
        <Link href="/portal/products" className={active("Store",path)?"is-active":""}>Store</Link>
        <details ref={billingMenuRef} onToggle={event=>{const el=event.currentTarget;if(el.open)closeMenus(el)}} className={"v6c-orbitfs-nav "+((path.startsWith("/portal/orders")||path.startsWith("/portal/invoices")||path.startsWith("/portal/payment-history"))?"is-active":"")}>
          <summary>Billing <span>⌄</span></summary>
          <div className="v6c-orbitfs-menu">
            <Link onClick={()=>closeMenus()} href="/portal/billing">Overview</Link>
            <Link onClick={()=>closeMenus()} href="/portal/orders">Orders</Link>
            <Link onClick={()=>closeMenus()} href="/portal/invoices">Invoices</Link>
            <Link onClick={()=>closeMenus()} href="/portal/payment-history">Payment History</Link>
          </div>
        </details>
        <Link href="/portal/support" className={active("Support",path)?"is-active":""}>Support</Link>
        <details ref={licenseMenuRef} onToggle={event=>{const el=event.currentTarget;if(el.open)closeMenus(el)}} className={"v6c-orbitfs-nav "+(path.startsWith("/portal/orbitfs/license")?"is-active":"")}><summary>License System <span>⌄</span></summary><div className="v6c-orbitfs-menu"><Link onClick={()=>closeMenus()} href="/portal/orbitfs/license">License Controller</Link></div></details>
        <details ref={orbitfsMenuRef} onToggle={event=>{const el=event.currentTarget;if(el.open)closeMenus(el)}} className={"v6c-orbitfs-nav "+(path.startsWith("/portal/orbitfs")&&!path.startsWith("/portal/orbitfs/license")?"is-active":"")}>
          <summary>My OrbitFS <span>⌄</span></summary>
          <div className="v6c-orbitfs-menu">
            <Link onClick={()=>closeMenus()} href="/portal/orbitfs/base">Deployment system</Link>
            <Link onClick={()=>closeMenus()} href="/portal/orbitfs/releases">Update system</Link>
            <Link onClick={()=>closeMenus()} href="/portal/orbitfs/channels">Release Channels</Link>
          </div>
        </details>
      </nav>
      <div className="v6c-appbar-spacer"/>
      <div className="v6c-app-search">⌕ <span>Search anything...</span></div>
      <div className="v6c-notification-compact">{tools}</div>
      {canAccessAdmin&&<Link className="v6c-admin-toplink" href="/admin">Admin</Link>}
      <details ref={accountMenuRef} onToggle={event=>{const el=event.currentTarget;if(el.open)closeMenus(el)}} className="v6c-account-menu">
        <summary aria-label="Open account menu">
          <span className="v6c-avatar">{initials(accountName,accountEmail)}</span>
        </summary>
        <div className="v6c-account-popover">
          <div className="v6c-account-identity"><span className="v6c-avatar large">{initials(accountName,accountEmail)}</span><div><b>{accountName||"OrbitFS Customer"}</b><small>{accountEmail||"Customer account"}</small></div></div>
          <div className="v6c-account-menu-heading">ACCOUNT SETTINGS</div>
          <Link onClick={()=>closeMenus()} href="/portal/settings?tab=profile"><span>Profile</span><b>›</b></Link>
          <Link onClick={()=>closeMenus()} href="/portal/settings?tab=billing"><span>Billing Details</span><b>›</b></Link>
          <Link onClick={()=>closeMenus()} href="/portal/settings?tab=wallet"><span>Wallet Settings</span><b>›</b></Link>
          <Link onClick={()=>closeMenus()} href="/portal/settings?tab=preferences"><span>Preferences</span><b>›</b></Link>
          <Link onClick={()=>closeMenus()} href="/portal/settings?tab=security"><span>Security</span><b>›</b></Link>
          {onLogout&&<button type="button" onClick={()=>{closeMenus();onLogout()}} disabled={loggingOut}><span>{loggingOut?"Logging out…":"Logout"}</span><b>↗</b></button>}
        </div>
      </details>
    </header>
    {banner}
    <main className={"v6c-content v6c-route-"+routeKey}>
      {info&&<section className="v6c-context-hero">
        <div>
          <span className="v6c-context-badge">{info.eyebrow}</span>
          <h1>{info.title}</h1>
          <p>{info.description}</p>
        </div>
        <div className={"v6c-context-art art-"+info.key} aria-hidden="true"><i/><b/><span/></div>
      </section>}
      {children}
    </main>
  </div>;
}
