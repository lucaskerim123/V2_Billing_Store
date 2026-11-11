"use client";

import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {usePathname} from "next/navigation";
import {createClient} from "@/lib/supabase";
import SuperadminDeleteBar from "@/components/SuperadminDeleteBar";
import AdminRecordQuickSend from "@/components/AdminRecordQuickSend";
import AdminGuestSupportContext from "@/components/AdminGuestSupportContext";
import AdminNotifications from "@/components/AdminNotifications";
import ThemeRuntime from "@/components/ThemeRuntime";
import themeDefaults from "@/themes/active/defaults.json";

type NavItem={label:string;href:string;permission:string};
type NavGroup={label:string;shortLabel:string;items:NavItem[];match:(path:string)=>boolean};

const permissionAliases:Record<string,string[]>={
  "admin.access":["admin.access"],
  "customers.view":["customers.view"],
  "customers.cancellations":["customers.cancellations"],
  "customers.create":["customers.create","customers.edit"],
  "orders.view":["orders.view"],
  "orders.create":["orders.create","orders.manage"],
  "invoices.view":["invoices.view"],
  "invoices.create":["invoices.create","invoices.manage"],
  "coupons.view":["coupons.view","coupons.manage"],
  "payments.manage":["payments.manage","payment_gateways.manage"],
  "payments.view":["payments.view","payment_gateways.manage"],
  "licenses.view":["licenses.view"],
  "licenses.manage":["licenses.manage","licenses.enforce","license_api.manage"],
  "support.view":["support.view","support.manage"],
  "support.create":["support.create","support.ticket_create","support.manage"],
  "support.kb":["support.kb","support.kb.view","support.manage"],
  "support.templates":["support.templates","support.premade.use","support.manage"],
  "support.settings":["support.settings","support.manage"],
  "products.view":["products.view","products.manage"],
  "news.view":["news.view","settings.general"],
  "downloads.view":["downloads.view","products.manage"],
  "staff.view":["staff.view"],
  "settings.view":["settings.view","settings.general"],
  "analytics.view":["analytics.view"],
  "audit.view":["audit.view"],
  "mail.access":["mail.view","mail.admin","mail.admin.send","mail.settings","mail.templates","mail.queue.view","mail.queue.manage"]
};

const billingGroup:NavGroup={
  label:"Billing",
  shortLabel:"Billing",
  match:path=>["/admin/orders","/admin/fulfillment","/admin/invoices","/admin/coupons","/admin/payments","/admin/billing","/admin/product-licenses","/admin/product-groups"].some(x=>path.startsWith(x)),
  items:[
    {label:"Orders",href:"/admin/orders",permission:"orders.view"},
    {label:"Fulfilment",href:"/admin/fulfillment",permission:"licenses.manage"},
    {label:"Product Licences",href:"/admin/product-licenses",permission:"licenses.manage"},
    {label:"Product Groups",href:"/admin/product-groups",permission:"licenses.manage"},
    {label:"Invoices",href:"/admin/invoices",permission:"invoices.view"},
    {label:"Coupons",href:"/admin/coupons",permission:"coupons.view"},
    {label:"Payments",href:"/admin/payments",permission:"payments.view"},
    {label:"Gateway setup",href:"/admin/payments/setup",permission:"payments.manage"}
  ]
};

const customersGroup:NavGroup={
  label:"Customers",
  shortLabel:"Customers",
  match:path=>path.startsWith("/admin/customers"),
  items:[
    {label:"Customers",href:"/admin/customers",permission:"customers.view"},
    {label:"Cancellations",href:"/admin/customers/cancellations",permission:"customers.cancellations"}
  ]
};

const supportGroup:NavGroup={
  label:"Support",
  shortLabel:"Support",
  match:path=>path.startsWith("/admin/support"),
  items:[
    {label:"Tickets",href:"/admin/support",permission:"support.view"},
    {label:"New ticket",href:"/admin/support/new",permission:"support.create"},
    {label:"Knowledge Base",href:"/admin/support/knowledge-base",permission:"support.kb"},
    {label:"Premade Messages",href:"/admin/support/premade-messages",permission:"support.templates"},
    {label:"Support settings",href:"/admin/support/settings",permission:"support.settings"}
  ]
};

const productsGroup:NavGroup={
  label:"Products",
  shortLabel:"Products",
  match:path=>path.startsWith("/admin/products")||path.startsWith("/admin/news")||path.startsWith("/admin/downloads"),
  items:[
    {label:"Products",href:"/admin/products",permission:"products.view"},
    {label:"News",href:"/admin/news",permission:"news.view"},
    {label:"Downloads",href:"/admin/downloads",permission:"downloads.view"}
  ]
};

const orbitfsGroup:NavGroup={
  label:"OrbitFS",
  shortLabel:"OrbitFS",
  match:path=>path.startsWith("/admin/orbitfs")||path.startsWith("/admin/license-controller")||path.startsWith("/admin/licensing")||path.startsWith("/admin/settings/license-master")||path.startsWith("/admin/releases"),
  items:[
    {label:"Installations",href:"/admin/orbitfs/installations",permission:"licenses.view"},
    {label:"Release Review",href:"/admin/orbitfs/release-control",permission:"licenses.manage"},
    {label:"Release Channels",href:"/admin/orbitfs/release-channels",permission:"licenses.manage"},
    {label:"Customer Licences",href:"/admin/license-controller",permission:"licenses.manage"},
    {label:"License System",href:"/admin/licensing",permission:"licenses.view"},
    {label:"Product Connections",href:"/admin/settings/license-master",permission:"licenses.manage"}
  ]
};

const systemGroup:NavGroup={
  label:"System",
  shortLabel:"System",
  match:path=>path.startsWith("/admin/settings")||path.startsWith("/admin/audit")||path.startsWith("/admin/analytics")||path.startsWith("/admin/staff")||path.startsWith("/admin/alerts"),
  items:[
    {label:"Settings",href:"/admin/settings",permission:"settings.view"},
    {label:"Staff",href:"/admin/settings/staff",permission:"staff.view"},
    {label:"Alerts",href:"/admin/alerts",permission:"admin.access"},
    {label:"Themes",href:"/admin/settings/themes",permission:"settings.view"},
    {label:"Analytics",href:"/admin/analytics",permission:"analytics.view"},
    {label:"Audit log",href:"/admin/audit",permission:"audit.view"}
  ]
};

const groups:NavGroup[]=[billingGroup,customersGroup,supportGroup,productsGroup,orbitfsGroup,systemGroup];

function normalizePermissions(raw:any){
  const set=new Set<string>();
  if(Array.isArray(raw)){
    for(const key of raw)if(typeof key==="string")set.add(key);
  }else if(raw&&typeof raw==="object"){
    for(const [key,value] of Object.entries(raw))if(value)set.add(key);
    if(raw.all)set.add("*");
  }
  return set;
}

function allowed(perms:Set<string>,permission:string){
  if(perms.has("*")||perms.has(permission))return true;
  return (permissionAliases[permission]||[]).some(key=>perms.has(key));
}

function itemActive(path:string,href:string){
  return path===href||path.startsWith(href+"/");
}

function adminRouteKey(path:string){
  if(path==="/admin")return "dashboard";
  if(path.startsWith("/admin/orbitfs/installations"))return "installations";
  if(path.startsWith("/admin/orbitfs/base-deployment")||path.startsWith("/admin/orbitfs/base-deploy"))return "base-deployment";
  if(path.startsWith("/admin/orbitfs/release-control")||path.startsWith("/admin/orbitfs/update-release-deployer")||path.startsWith("/admin/orbitfs/releases")||path.startsWith("/admin/releases"))return "update-release";
  if(path.startsWith("/admin/orbitfs/release-channels"))return "release-channels";
  if(path.startsWith("/admin/license-controller"))return "license-controller";
  if(path.startsWith("/admin/licensing")||path.startsWith("/admin/settings/license-master"))return "licensing";
  if(path.startsWith("/admin/customers/")&&!path.endsWith("/cancellations"))return "customer-detail";
  if(path.startsWith("/admin/customers"))return "customers";
  if(path.startsWith("/admin/product-groups"))return "product-groups";
  if(path.startsWith("/admin/product-licenses"))return "product-licenses";
  if(path.startsWith("/admin/orders/"))return "order-detail";
  if(path.startsWith("/admin/orders"))return "orders";
  if(path.startsWith("/admin/invoices/"))return "invoice-detail";
  if(path.startsWith("/admin/invoices"))return "invoices";
  if(path.startsWith("/admin/support/")&&!path.startsWith("/admin/support/settings")&&!path.startsWith("/admin/support/knowledge-base")&&!path.startsWith("/admin/support/premade-messages")&&!path.startsWith("/admin/support/new"))return "support-detail";
  if(path.startsWith("/admin/support"))return "support";
  if(path.startsWith("/admin/products"))return "products";
  if(path.startsWith("/admin/news"))return "news";
  if(path.startsWith("/admin/analytics"))return "analytics";
  if(path.startsWith("/admin/audit"))return "audit";
  if(path.startsWith("/admin/alerts"))return "alerts";
  if(path.startsWith("/admin/payments"))return "payments";
  if(path.startsWith("/admin/settings"))return "settings";
  return "admin";
}

export default function AdminLayoutClient({
  children,
  githubProfile
}:{
  children:React.ReactNode;
  githubProfile:"primary"|"fallback"|"unknown";
}){
  const pathname=usePathname();
  const [permissions,setPermissions]=useState<Set<string>>(new Set());
  const [role,setRole]=useState<string|null>(null);
  const [ready,setReady]=useState(false);
  const [siteTitle,setSiteTitle]=useState("OrbitFS");
  const [adminName,setAdminName]=useState("Admin");
  const [adminEmail,setAdminEmail]=useState("");
  const sb=useMemo(()=>createClient(),[]);

  const activeGroup=groups.find(group=>group.match(pathname));
  const area=pathname==="/admin"
    ?"home"
    :activeGroup===billingGroup
      ?"billing"
      :activeGroup===customersGroup
        ?"customers"
        :activeGroup===supportGroup
          ?"support"
          :activeGroup===productsGroup
            ?"products"
            :activeGroup===orbitfsGroup
              ?"orbitfs"
              :"system";
  const routeKey=adminRouteKey(pathname);
  const v6aExempt=routeKey==="base-deployment"||routeKey==="update-release";

  useEffect(()=>{
    const selector="details.adminV6Account";
    const closeAll=(except?:HTMLDetailsElement|null)=>document.querySelectorAll<HTMLDetailsElement>(selector).forEach(el=>{if(el!==except)el.open=false});
    const onToggle=(event:Event)=>{const el=event.currentTarget as HTMLDetailsElement;if(el.open)closeAll(el)};
    const onPointer=(event:PointerEvent)=>{const target=event.target as Element|null;if(!target?.closest(selector))closeAll()};
    const onClick=(event:MouseEvent)=>{const target=event.target as Element|null;if(target?.closest(selector)&&target.closest("a,button"))closeAll()};
    const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")closeAll()};
    const menus=Array.from(document.querySelectorAll<HTMLDetailsElement>(selector));
    menus.forEach(el=>el.addEventListener("toggle",onToggle));
    document.addEventListener("pointerdown",onPointer);
    document.addEventListener("click",onClick);
    document.addEventListener("keydown",onKey);
    return()=>{
      menus.forEach(el=>el.removeEventListener("toggle",onToggle));
      document.removeEventListener("pointerdown",onPointer);
      document.removeEventListener("click",onClick);
      document.removeEventListener("keydown",onKey);
    };
  },[pathname,ready]);

  useEffect(()=>{
    if(pathname==="/admin/login"||pathname==="/admin/setup")return;
    let live=true;
    (async()=>{
      const {data:{user}}=await sb.auth.getUser();
      if(!user){window.location.href="/admin/login";return}
      setAdminEmail(user.email||"");
      setAdminName(String(user.user_metadata?.display_name||user.user_metadata?.full_name||user.email?.split("@")[0]||"Admin"));
      const {data,error}=await sb.rpc("get_my_staff_access");
      if(!live)return;
      const row=Array.isArray(data)?data[0]:data;
      const set=normalizePermissions(row?.permissions);
      if(error||!row||!allowed(set,"admin.access")){window.location.href="/portal";return}
      setPermissions(set);
      setRole(row?.primary_role||row?.role||(row?.is_staff?"staff":null));
      const {data:identity}=await sb.from("app_settings").select("key,value").eq("category","identity");
      const id=Object.fromEntries((identity||[]).map((x:any)=>[x.key.split(".").pop(),x.value]));
      setSiteTitle(id.admin_name||id.site_name||"OrbitFS");
      setReady(true);
    })();
    return()=>{live=false};
  },[sb,pathname]);

  if(pathname==="/admin/login"||pathname==="/admin/setup"){
    return <><ThemeRuntime surface="admin" fallback={themeDefaults.admin}/>{children}</>;
  }

  if(!ready)return <div className="adminLoading">Loading admin…</div>;

  const visibleGroups=groups
    .map(group=>({...group,items:group.items.filter(item=>allowed(permissions,item.permission))}))
    .filter(group=>group.items.length);
  const contextItems=activeGroup?.items.filter(item=>allowed(permissions,item.permission))||[];

  async function logout(){
    await sb.auth.signOut();
    window.location.href="/";
  }

  return <div className="adminV6App adminV3Layout" data-admin-area={area} data-admin-route={routeKey} data-admin-v6a-exempt={v6aExempt?"true":"false"}>
    <ThemeRuntime surface="admin" fallback={themeDefaults.admin}/>
    <header className="adminV6Header">
      <div className="adminV6HeaderMain">
        <Link className="adminV6Brand" href="/admin" aria-label="OrbitFS Admin home">
          <span className="adminV6BrandMark">O</span>
          <span className="adminV6BrandText"><b>{siteTitle}</b><small>ADMIN</small></span>
        </Link>

        <nav className="adminV6MainNav" aria-label="Admin main navigation">
          <Link className={pathname==="/admin"?"active":""} href="/admin">Home</Link>
          {visibleGroups.map(group=><Link key={group.shortLabel} className={group.match(pathname)?"active":""} href={group.shortLabel==="OrbitFS"?"/admin/orbitfs":group.items[0].href}>{group.shortLabel}</Link>)}
        </nav>

        <div className="adminV6Utilities">
          <div className={"adminV6Source adminV6Source-"+githubProfile} title={githubProfile==="fallback"?"remipetrovich-design/OrbitFS-Billing-Shopfront":githubProfile==="primary"?"lucaskerim123/V2_Billing_Store":"Active GitHub source could not be verified"}>
            <span>Source</span>
            <strong>{githubProfile==="fallback"?"Fallback":githubProfile==="primary"?"Primary":"Unknown"}</strong>
          </div>
          {allowed(permissions,"mail.access")&&<Link className="adminV6UtilityLink" href="/mail">Mail</Link>}
          <Link className="adminV6UtilityLink" href="/portal">Portal</Link>
          <AdminNotifications/>
          <details className="adminV6Account">
            <summary aria-label="Admin account"><span>{adminName.slice(0,2).toUpperCase()}</span></summary>
            <div className="adminV6AccountMenu">
              <div className="adminV6Identity"><b>{adminName}</b><small>{adminEmail}</small><em>{role||"staff"}</em></div>
              <Link href="/portal">Customer portal</Link>
              <button type="button" onClick={()=>void logout()}>Log out</button>
            </div>
          </details>
        </div>
      </div>

      <div className="adminV6ContextBar">
        <strong className="adminV6ContextLabel">{activeGroup?.shortLabel||"Home"}</strong>
        <nav className="adminV3Subnav" aria-label={(activeGroup?.shortLabel||"Home")+" subpages"}>
          {activeGroup
            ?contextItems.map(item=><Link key={item.href+item.label} className={itemActive(pathname,item.href)?"active":""} href={item.href}>{item.label}</Link>)
            :<><Link className="active" href="/admin">Overview</Link><Link href="/admin#attention">Attention</Link></>}
        </nav>
        <div className="adminV6ContextActions">
          {area==="billing"&&allowed(permissions,"orders.create")&&<Link href="/admin/billing/create?mode=order_only">+ Order</Link>}
          {area==="billing"&&allowed(permissions,"invoices.create")&&<Link href="/admin/billing/create">+ Invoice</Link>}
          {area==="support"&&allowed(permissions,"support.create")&&<Link href="/admin/support/new">+ Ticket</Link>}
        </div>
      </div>
    </header>

    <main className="masterContent adminV6Content">{children}</main>
    <AdminGuestSupportContext/>
    <AdminRecordQuickSend/>
    <SuperadminDeleteBar role={role}/>
  </div>;
}
