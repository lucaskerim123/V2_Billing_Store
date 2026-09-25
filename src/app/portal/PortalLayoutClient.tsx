"use client";

import Link from "next/link";
import {useEffect,useMemo,useRef,useState} from "react";
import {usePathname,useRouter} from "next/navigation";
import {createClient} from "@/lib/supabase";
import {trackCustomerActivity} from "@/lib/customer-activity";
import NotificationCenter from "@/components/NotificationCenter";
import ThemeRuntime from "@/components/ThemeRuntime";

function staffCanAdmin(staff:any){
 const permissions=staff?.permissions;
 if(permissions?.all||permissions?.["admin.access"])return true;
 if(Array.isArray(permissions))return permissions.includes("*")||permissions.includes("admin.access");
 return false;
}

type NavItem={label:string;href:string;short:string};

export default function PortalLayoutClient({children}:{children:React.ReactNode}){
 const sb=useMemo(()=>createClient(),[]),path=usePathname(),router=useRouter();
 const [d,setD]=useState<any>(),[enforcement,setEnforcement]=useState<any>({state:"active"}),[loggingOut,setLoggingOut]=useState(false),[mobileMenuOpen,setMobileMenuOpen]=useState(false);
 const lastEnforcementCheck=useRef(0),lastPulseRevision=useRef<number|null>(null);

 useEffect(()=>{
  let alive=true;
  async function applyEnforcement(enf:any){
   if(!alive)return false;
   if(enf?.state==="banned"){
    try{const payload=JSON.stringify({...enf,stored_at:new Date().toISOString()});localStorage.setItem("orbitfs_account_blocked",payload);sessionStorage.setItem("orbitfs_account_blocked",payload)}catch{}
    await sb.auth.signOut();location.replace("/account-blocked");return false;
   }
   if(enf?.state==="active"){try{localStorage.removeItem("orbitfs_account_blocked");sessionStorage.removeItem("orbitfs_account_blocked")}catch{}}
   setEnforcement(enf||{state:"active"});return true;
  }
  async function loadInitial(){
   const {data:{user}}=await sb.auth.getUser();if(!user){location.href="/login";return}
   const [{data:p},{data:s},{data:staff},{data:enf}]=await Promise.all([
    sb.from("user_profiles").select("display_name,first_name").eq("id",user.id).single(),
    sb.from("app_settings").select("key,value").eq("category","identity"),
    sb.rpc("get_my_staff_access"),
    sb.rpc("account_enforcement_status")
   ]);
   lastEnforcementCheck.current=Date.now();if(!alive||!(await applyEnforcement(enf)))return;
   const id=Object.fromEntries((s||[]).map((x:any)=>[x.key.split(".").pop(),x.value]));
   setD({user,p,id,staff});
  }
  async function refreshEnforcement(force=false){
   if(!force&&Date.now()-lastEnforcementCheck.current<120000)return;
   const {data:enf,error}=await sb.rpc("account_enforcement_status");if(error||!alive)return;
   lastEnforcementCheck.current=Date.now();await applyEnforcement(enf);
  }
  void loadInitial();
  const timer=setInterval(()=>void refreshEnforcement(),300000),onFocus=()=>void refreshEnforcement(true);
  window.addEventListener("focus",onFocus);
  return()=>{alive=false;clearInterval(timer);window.removeEventListener("focus",onFocus)};
 },[sb]);

 useEffect(()=>{
  let alive=true,timer:ReturnType<typeof setTimeout>|undefined;
  async function checkPulse(){
   try{
    const r=await fetch("/api/orbitfs/license-pulse",{cache:"no-store"});if(!r.ok)throw new Error("pulse unavailable");
    const j=await r.json();if(!alive)return;
    const revision=Number(j?.pulse_revision||0),poll=Math.min(3600,Math.max(5,Number(j?.runtime_policy?.pulse_poll_seconds||15)));
    if(lastPulseRevision.current===null)lastPulseRevision.current=revision;
    else if(revision>0&&revision!==lastPulseRevision.current){lastPulseRevision.current=revision;location.reload();return}
    timer=setTimeout(()=>void checkPulse(),poll*1000);
   }catch{if(alive)timer=setTimeout(()=>void checkPulse(),30000)}
  }
  void checkPulse();return()=>{alive=false;if(timer)clearTimeout(timer)};
 },[]);

 useEffect(()=>{trackCustomerActivity("page_view",{source:"portal",route:path});setMobileMenuOpen(false)},[path]);
 const suspended=enforcement?.state==="suspended";
 useEffect(()=>{if(suspended&&path!=="/portal"&&!path.startsWith("/portal/support"))router.replace("/portal")},[suspended,path,router]);

 if(!d)return <div className="adminGate">Loading portal…</div>;

 const primary:NavItem[]=suspended
  ?[{label:"Overview",href:"/portal",short:"OV"},{label:"Support",href:"/portal/support",short:"SP"}]
  :[
   {label:"Overview",href:"/portal",short:"OV"},
   {label:"Store",href:"/portal/products",short:"ST"},
   {label:"Orders & billing",href:"/portal/orders",short:"BL"},
   {label:"Downloads",href:"/portal/downloads",short:"DL"},
   {label:"Support",href:"/portal/support",short:"SP"}
  ];
 const orbitfs:NavItem[]=[
  {label:"Overview",href:"/portal/orbitfs",short:"OR"},
  {label:"Base deployment",href:"/portal/orbitfs",short:"BD"},
  {label:"License",href:"/portal/orbitfs/license",short:"LC"},
  {label:"Releases & updates",href:"/portal/orbitfs/releases",short:"UP"}
 ];
 const active=(h:string)=>{
  if(h==="/portal")return path==="/portal";
  if(h==="/portal/orders")return path.startsWith("/portal/orders")||path.startsWith("/portal/invoices")||path.startsWith("/portal/checkout");
  if(h==="/portal/orbitfs")return path==="/portal/orbitfs";
  return path===h||path.startsWith(h+"/");
 };
 const pageTitle=path.startsWith("/portal/orbitfs/releases")?"Releases & updates":
  path.startsWith("/portal/orbitfs/license")?"OrbitFS licence":
  path==="/portal/orbitfs"?"My OrbitFS":
  path.startsWith("/portal/products")?"Store":
  path.startsWith("/portal/orders")||path.startsWith("/portal/invoices")||path.startsWith("/portal/checkout")?"Orders & billing":
  path.startsWith("/portal/downloads")?"Downloads":
  path.startsWith("/portal/support")?"Support":
  path.startsWith("/portal/settings")?"Account settings":"Overview";
 const displayName=d.p?.first_name||d.p?.display_name||d.user?.email?.split("@")[0]||"Customer";

 async function logout(){
  if(loggingOut)return;setLoggingOut(true);
  await trackCustomerActivity("logout",{source:"auth",route:path});
  await sb.auth.signOut();router.replace("/login");router.refresh();
 }

 return <div className="portalShellV3 portalCustomerSite">
  <ThemeRuntime surface="customer" fallback="V3C"/>

  <header className="portalShellMobileHead">
   <Link className="portalShellBrandCompact" href="/portal"><span>O</span><b>{d.id.site_name||"OrbitFS"}</b></Link>
   <div className="portalShellMobileActions"><NotificationCenter surface="portal"/><button type="button" className="portalShellMenuButton" aria-expanded={mobileMenuOpen} onClick={()=>setMobileMenuOpen(v=>!v)}>{mobileMenuOpen?"Close":"Menu"}</button></div>
  </header>

  <aside className={"portalShellSidebar "+(mobileMenuOpen?"open":"")}>
   <div className="portalShellBrand">
    <Link href="/portal"><span className="portalShellLogo">O</span><div><b>{d.id.site_name||"OrbitFS"}</b><small>Customer Portal</small></div></Link>
   </div>

   <nav className="portalShellNav">
    <div className="portalShellNavGroup">
     <span className="portalShellNavLabel">ACCOUNT</span>
     {primary.map(item=><Link key={item.href} href={item.href} className={active(item.href)?"active":""}><span className="portalShellNavIcon">{item.short}</span><b>{item.label}</b></Link>)}
    </div>

    {!suspended&&<div className="portalShellNavGroup">
     <span className="portalShellNavLabel">MY ORBITFS</span>
     {orbitfs.slice(1).map(item=><Link key={item.href} href={item.href} className={active(item.href)?"active":""}><span className="portalShellNavIcon">{item.short}</span><b>{item.label}</b></Link>)}
    </div>}
   </nav>

   <div className="portalShellSidebarBottom">
    {!suspended&&<Link href="/portal/settings" className={path.startsWith("/portal/settings")?"active":""}><span className="portalShellNavIcon">AC</span><div><b>Account settings</b><small>{d.user?.email||""}</small></div></Link>}
    {staffCanAdmin(d.staff)&&<Link href="/admin"><span className="portalShellNavIcon">AD</span><div><b>Admin</b><small>Staff portal</small></div></Link>}
   </div>
  </aside>

  <div className="portalShellContent">
   <header className="portalShellToolbar">
    <div><span className="portalShellBreadcrumb">Customer Portal</span><b>{pageTitle}</b></div>
    <div className="portalShellTools">
     <div className="portalShellUser"><span>{String(displayName).slice(0,1).toUpperCase()}</span><div><b>{displayName}</b><small>{d.user?.email||""}</small></div></div>
     <NotificationCenter surface="portal"/>
     <button type="button" className="portalShellLogout" onClick={logout} disabled={loggingOut}>{loggingOut?"Signing out…":"Sign out"}</button>
    </div>
   </header>

   <main className="portalShellMain">
    {suspended&&path==="/portal"?<section className="portalPage"><div className="panel"><p className="eyebrow">ACCOUNT SUSPENDED</p><h1>Your OrbitFS account is suspended</h1><p>{enforcement.reason||"Your account has been suspended."}</p><div className="listrow"><b>Suspension expiry</b><span>{enforcement.expires_at?new Date(enforcement.expires_at).toLocaleString():"No automatic expiry"}</span></div><p>While suspended, your OrbitFS licences are suspended and Store, Billing, Licences, My OrbitFS and Downloads are unavailable. Support remains available.</p><p>Contact support via ticket or <a href="mailto:support@orbitfs.cc">support@orbitfs.cc</a>.</p><Link className="buttonlink" href="/portal/support">Open support</Link></div></section>:children}
   </main>
  </div>

  {mobileMenuOpen&&<button className="portalShellBackdrop" aria-label="Close navigation" onClick={()=>setMobileMenuOpen(false)}/>}
 </div>;
}
