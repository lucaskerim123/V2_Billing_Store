"use client";

import Link from "next/link";
import {useEffect,useMemo,useRef,useState} from "react";
import {usePathname,useRouter} from "next/navigation";
import {createClient} from "@/lib/supabase";
import {trackCustomerActivity} from "@/lib/customer-activity";
import NotificationCenter from "@/components/NotificationCenter";
import ThemeRuntime from "@/components/ThemeRuntime";

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
  ?[{label:"Home",href:"/portal",short:"HM"},{label:"Support",href:"/portal/support",short:"SP"}]
  :[
   {label:"Overview",href:"/portal",short:"OV"},
   {label:"Store",href:"/portal/products",short:"ST"},
   {label:"Billing",href:"/portal/orders",short:"BL"},
   {label:"Downloads",href:"/portal/downloads",short:"DL"},
   {label:"Support",href:"/portal/support",short:"SP"}
  ];
 const active=(h:string)=>{
  if(h==="/portal")return path==="/portal";
  if(h==="/portal/orders")return path.startsWith("/portal/orders")||path.startsWith("/portal/invoices")||path.startsWith("/portal/checkout");
  if(h==="/portal/orbitfs")return path==="/portal/orbitfs";
  return path===h||path.startsWith(h+"/");
 };

 async function logout(){
  if(loggingOut)return;setLoggingOut(true);
  await trackCustomerActivity("logout",{source:"auth",route:path});
  await sb.auth.signOut();router.replace("/login");router.refresh();
 }

 return <div className="portalLayout portalCustomerSite">
  <ThemeRuntime surface="customer" fallback="V3C"/>

  <header className="portalTopbar">
   <Link className="portalTopBrand" href="/portal">
    <span className="portalTopBrandMark">OPS</span>
    <span>{d.id.site_name||"OrbitFS"}</span>
   </Link>

   <button className="portalMobileMenuButton" type="button" aria-expanded={mobileMenuOpen} aria-controls="portal-mobile-nav" onClick={()=>setMobileMenuOpen(v=>!v)}>
    {mobileMenuOpen?"Close":"Menu"}
   </button>

   <nav id="portal-mobile-nav" className={"portalTopNav "+(mobileMenuOpen?"mobileOpen":"")}>
    {primary.map(item=><Link key={item.href} className={active(item.href)?"active":""} href={item.href}>{item.label}</Link>)}
    {!suspended&&<details className={"portalTopNavGroup "+(path.startsWith("/portal/orbitfs")?"active":"")}>
     <summary>My OrbitFS <span className="portalTopNavChevron">⌄</span></summary>
     <div className="portalTopNavSub">
      <Link className={path==="/portal/orbitfs"?"active":""} href="/portal/orbitfs">Base Deployer</Link>
      <Link className={path.startsWith("/portal/orbitfs/license")?"active":""} href="/portal/orbitfs/license">License Controller</Link>
      <Link className={path.startsWith("/portal/orbitfs/releases")?"active":""} href="/portal/orbitfs/releases">Update Releaser</Link>
     </div>
    </details>}
    {d.staff?.is_staff&&<Link className="portalMobileOnly" href="/admin">Admin</Link>}
    {!suspended&&<Link className="portalMobileOnly" href="/portal/settings">Account</Link>}
   </nav>

   <div className="portalTopTools">
    {d.staff?.is_staff&&<Link className="portalAdminLink" href="/admin">Admin</Link>}
    {!suspended&&<Link className="portalAccountLink" href="/portal/settings">Account</Link>}
    <NotificationCenter surface="portal"/>
    <button className="portalLogoutButton" type="button" onClick={logout} disabled={loggingOut}>{loggingOut?"…":"Logout"}</button>
   </div>
  </header>

  <main className="portalMain">
   {suspended&&path==="/portal"?<section className="portalPage"><div className="panel"><p className="eyebrow">ACCOUNT SUSPENDED</p><h1>Your OrbitFS account is suspended</h1><p>{enforcement.reason||"Your account has been suspended."}</p><div className="listrow"><b>Suspension expiry</b><span>{enforcement.expires_at?new Date(enforcement.expires_at).toLocaleString():"No automatic expiry"}</span></div><p>While suspended, your OrbitFS licences are suspended and Store, Billing, Licences, My OrbitFS and Downloads are unavailable. Support remains available.</p><p>Contact support via ticket or <a href="mailto:support@orbitfs.cc">support@orbitfs.cc</a>.</p><Link className="buttonlink" href="/portal/support">Open support</Link></div></section>:children}
  </main>
 </div>;
}
