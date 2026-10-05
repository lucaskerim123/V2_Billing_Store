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
  ["Billing","/portal/orders"],
  ["Support","/portal/support"],
  ["My OrbitFS","/portal/orbitfs"],
] as const;

type RouteInfo={key:string;eyebrow:string;title:string;description:string};
function routeInfo(path:string):RouteInfo|null{
  if(path==="/portal")return {key:"dashboard",eyebrow:"COMPLETE PLATFORM",title:"Your OrbitFS, all in one place.",description:"Billing, support, products, deployments, licences and updates in one consistent customer portal."};
  if(path==="/portal/products")return {key:"store",eyebrow:"ORBITFS STORE",title:"Build your OrbitFS setup.",description:"Choose your core system, add the components you need and move through Basket and Checkout when you are ready."};
  if(path==="/portal/support")return {key:"support",eyebrow:"SUPPORT CENTRE",title:"Help when you need it.",description:"Open and track support requests, review conversations and browse the OrbitFS knowledge base."};
  if(path.startsWith("/portal/settings"))return {key:"settings",eyebrow:"MY ACCOUNT",title:"Account settings.",description:"Manage your profile, billing details, Wallet, preferences and security."};
  if(path.startsWith("/portal/downloads"))return {key:"downloads",eyebrow:"PRODUCT DOWNLOADS",title:"Your OrbitFS downloads.",description:"Access published files attached to your active paid product entitlements."};
  if(path.startsWith("/portal/orbitfs/license"))return {key:"license",eyebrow:"MY ORBITFS · LICENCE",title:"License Controller",description:"View your authoritative licence state, entitlements and permitted customer actions."};
  if(path.startsWith("/portal/orbitfs/channels"))return {key:"channels",eyebrow:"MY ORBITFS · RELEASE CHANNELS",title:"Release Channels",description:"Choose how early you receive OrbitFS releases and manage access to restricted channels."};
  return null;
}

function active(label:string,path:string){
  if(label==="Dashboard")return path==="/portal";
  if(label==="Store")return path.startsWith("/portal/products")||path.startsWith("/portal/basket")||path.startsWith("/portal/checkout");
  if(label==="Billing")return path.startsWith("/portal/orders")||path.startsWith("/portal/invoices");
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
  const orbitfsMenuRef=useRef<HTMLDetailsElement|null>(null);
  const accountMenuRef=useRef<HTMLDetailsElement|null>(null);
  const closeMenus=useCallback((except?:HTMLDetailsElement|null)=>{
    if(orbitfsMenuRef.current&&orbitfsMenuRef.current!==except)orbitfsMenuRef.current.open=false;
    if(accountMenuRef.current&&accountMenuRef.current!==except)accountMenuRef.current.open=false;
  },[]);
  useEffect(()=>{closeMenus()},[path,closeMenus]);
  useEffect(()=>{
    const onPointer=(event:PointerEvent)=>{
      const target=event.target as Node;
      if(!orbitfsMenuRef.current?.contains(target)&&!accountMenuRef.current?.contains(target))closeMenus();
    };
    const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")closeMenus()};
    document.addEventListener("pointerdown",onPointer);
    document.addEventListener("keydown",onKey);
    return()=>{document.removeEventListener("pointerdown",onPointer);document.removeEventListener("keydown",onKey)};
  },[closeMenus]);

  const info=routeInfo(path);
  const routeKey=info?.key ?? ((path.startsWith("/portal/products")||path.startsWith("/portal/basket")||path.startsWith("/portal/checkout"))?"store":path.startsWith("/portal/support")?"support":(path.startsWith("/portal/orders")||path.startsWith("/portal/invoices"))?"billing":path.startsWith("/portal/orbitfs/releases")?"updates":path.startsWith("/portal/orbitfs/base")?"base":path==="/portal/orbitfs"?"orbit-home":"page");
  return <div className="v6c-screen">
    <header className="v6c-appbar">
      <Link className="v6c-mark" href="/portal" aria-label="OrbitFS home"><span/><b>OrbitFS</b></Link>
      <nav className="v6c-globalnav" aria-label="Customer Portal">
        {nav.filter(([label])=>label!=="My OrbitFS").map(([label,href])=><Link key={href} href={href} className={active(label,path)?"is-active":""}>{label}</Link>)}
        <details ref={orbitfsMenuRef} onToggle={event=>{const el=event.currentTarget;if(el.open)closeMenus(el)}} className={"v6c-orbitfs-nav "+(path.startsWith("/portal/orbitfs")?"is-active":"")}>
          <summary>My OrbitFS <span>⌄</span></summary>
          <div className="v6c-orbitfs-menu">
            <Link onClick={()=>closeMenus()} href="/portal/orbitfs">Overview</Link>
            <Link onClick={()=>closeMenus()} href="/portal/orbitfs/base">Base Deployment</Link>
            <Link onClick={()=>closeMenus()} href="/portal/orbitfs/releases">Update Release System</Link>
            <Link onClick={()=>closeMenus()} href="/portal/orbitfs/license">License Controller</Link>
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
          <Link onClick={()=>closeMenus()} href="/portal/settings"><span>Account Settings</span><b>›</b></Link>
          <Link onClick={()=>closeMenus()} href="/portal/support"><span>Help</span><b>›</b></Link>
          <div className="v6c-account-future"><span>More coming soon</span><small>Future account tools will appear here.</small></div>
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
