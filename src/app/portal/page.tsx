"use client";

import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";
import CustomerVisibleNotes from "@/components/CustomerVisibleNotes";

type ActivityTab="orders"|"invoices"|"support";
const money=(cents:any)=>new Intl.NumberFormat("en-AU",{style:"currency",currency:"AUD"}).format(Number(cents||0)/100);

export default function Portal(){
 const sb=useMemo(()=>createClient(),[]);
 const [d,setD]=useState<any>();
 const [tab,setTab]=useState<ActivityTab>("orders");
 useEffect(()=>{let alive=true;(async()=>{const {data:{user}}=await sb.auth.getUser();if(!user)return;const [p,b,t,o,i,n,e,s]=await Promise.all([
  sb.from("user_profiles").select("id,display_name,first_name").eq("id",user.id).single(),
  sb.from("account_balances").select("user_id,available_cents").eq("user_id",user.id).single(),
  sb.from("support_tickets").select("id,ticket_number,subject,status,updated_at").eq("user_id",user.id).order("updated_at",{ascending:false}).limit(5),
  sb.from("orders").select("id,order_number,status,total_cents,created_at").eq("auth_user_id",user.id).order("created_at",{ascending:false}).limit(25),
  sb.from("invoices").select("id,invoice_number,status,total_cents,paid_cents,created_at").eq("auth_user_id",user.id).order("created_at",{ascending:false}).limit(5),
  sb.from("news_posts").select("title,excerpt,published_at").eq("published",true).order("published_at",{ascending:false}).limit(3),
  sb.from("download_entitlements").select("id").eq("auth_user_id",user.id).eq("status","active").limit(100),
  sb.from("app_settings").select("key,value").eq("category","identity").limit(25)
 ]);if(!alive)return;const id=Object.fromEntries((s.data||[]).map((x:any)=>[x.key.split(".").pop(),x.value]));setD({user,profile:p.data,balance:b.data,tickets:t.data||[],orders:o.data||[],invoices:i.data||[],news:n.data||[],downloads:e.data?.length||0,id})})();return()=>{alive=false}},[sb]);

 const activeOrders=useMemo(()=>{if(!d)return[];const terminal=new Set(["completed","cancelled","canceled","refunded","terminated"]);return d.orders.filter((o:any)=>!terminal.has(String(o.status||"").toLowerCase()))},[d]);
 if(!d)return <section className="v6c-loading-state">Loading portal…</section>;

 const portal=d.id.portal_name||"Customer Portal",recentActiveOrders=activeOrders.slice(0,5);
 const outstandingInvoices=d.invoices.filter((i:any)=>Math.max(0,Number(i.total_cents||0)-Number(i.paid_cents||0))>0).length;
 const meta:Record<ActivityTab,{title:string;href:string;action:string}>={orders:{title:"Recent active orders",href:"/portal/orders",action:"View all orders"},invoices:{title:"Recent invoices",href:"/portal/invoices",action:"View all invoices"},support:{title:"Support tickets",href:"/portal/support",action:"View support"}};

 return <div className="portalOverviewV2">
  <section className="v6c-dashboard-live">
    <div className="v6c-dashboard-statbar">
      <Link href="/portal/settings#wallet"><span>W</span><div><small>WALLET</small><b>{money(d.balance?.available_cents||0)}</b><em>AUD available</em></div></Link>
      <Link href="/portal/orders"><span>O</span><div><small>ACTIVE ORDERS</small><b>{activeOrders.length}</b><em>{d.orders.length} total orders</em></div></Link>
      <Link href="/portal/invoices"><span>I</span><div><small>OPEN INVOICES</small><b>{outstandingInvoices}</b><em>{d.invoices.length} recent invoices</em></div></Link>
      <Link href="/portal/downloads"><span>D</span><div><small>DOWNLOADS</small><b>{d.downloads}</b><em>active entitlements</em></div></Link>
    </div>

    <section className="v6c-dashboard-platform">
      <div className="v6c-dashboard-section-head">
        <div><span>MY ORBITFS</span><h2>Run your OrbitFS system.</h2><p>Deployment, updates, licensing and release access from one control area.</p></div>
        <Link href="/portal/orbitfs">Open My OrbitFS →</Link>
      </div>
      <div className="v6c-dashboard-destinations">
        <Link href="/portal/orbitfs/base"><i>01</i><div><small>DEPLOYMENT</small><b>Base Deployment</b><p>Connect infrastructure, configure Base and manage the deployed runtime.</p></div><strong>→</strong></Link>
        <Link href="/portal/orbitfs/releases"><i>02</i><div><small>UPDATES</small><b>Update Release System</b><p>Review authorized releases and follow real update execution.</p></div><strong>→</strong></Link>
        <Link href="/portal/orbitfs/license"><i>03</i><div><small>LICENSING</small><b>License Controller</b><p>Review the authoritative licence and customer actions.</p></div><strong>→</strong></Link>
        <Link href="/portal/orbitfs/channels"><i>04</i><div><small>RELEASE ACCESS</small><b>Release Channels</b><p>Manage stable, preview and restricted channel access.</p></div><strong>→</strong></Link>
      </div>
    </section>

    <div className="v6c-dashboard-lower">
      <section className="v6c-dashboard-activity">
        <header><div><span>ACCOUNT ACTIVITY</span><h2>{meta[tab].title}</h2></div><Link href={meta[tab].href}>{meta[tab].action} →</Link></header>
        <nav aria-label="Activity type"><button className={tab==="orders"?"active":""} onClick={()=>setTab("orders")}>Orders</button><button className={tab==="invoices"?"active":""} onClick={()=>setTab("invoices")}>Invoices</button><button className={tab==="support"?"active":""} onClick={()=>setTab("support")}>Support</button></nav>
        <div className="v6c-dashboard-activity-list">
          {tab==="orders"&&<>{recentActiveOrders.length?recentActiveOrders.map((o:any)=><Link href={"/portal/orders/"+o.id} key={o.id}><div><b>#{o.order_number}</b><small>{new Date(o.created_at).toLocaleDateString()}</small></div><span>{o.status}</span><strong>{money(o.total_cents)}</strong></Link>):<p>No active orders.</p>}</>}
          {tab==="invoices"&&<>{d.invoices.length?d.invoices.map((i:any)=><Link href={"/portal/invoices/"+i.id} key={i.id}><div><b>{i.invoice_number}</b><small>{new Date(i.created_at).toLocaleDateString()}</small></div><span>{i.status}</span><strong>{money(i.total_cents)}</strong></Link>):<p>No invoices yet.</p>}</>}
          {tab==="support"&&<>{d.tickets.length?d.tickets.map((t:any)=><Link href={"/portal/support/"+t.id} key={t.id}><div><b>#{t.ticket_number}</b><small>{new Date(t.updated_at).toLocaleDateString()}</small></div><span>{String(t.status||"").replaceAll("_"," ")}</span><strong>{t.subject}</strong></Link>):<p>No support tickets.</p>}</>}
        </div>
      </section>

      <aside className="v6c-dashboard-actions">
        <span>QUICK ACCESS</span><h2>Common actions</h2>
        <Link href="/portal/products"><div><b>Browse Store</b><small>Products and add-ons</small></div><strong>→</strong></Link>
        <Link href="/portal/settings#wallet"><div><b>Manage Wallet</b><small>Add funds and review activity</small></div><strong>→</strong></Link>
        <Link href="/portal/support"><div><b>Support Centre</b><small>Tickets and Knowledge Base</small></div><strong>→</strong></Link>
        <Link href="/portal/settings"><div><b>Account Settings</b><small>Profile, billing and security</small></div><strong>→</strong></Link>
      </aside>
    </div>
    <div className="v6c-dashboard-bottom">
      <CustomerVisibleNotes entityType="customer" entityId={d.user.id} title="Account notices" />
      {!!d.news.length&&<section className="v6c-dashboard-news"><header><span>ORBITFS NEWS</span><h2>Latest updates</h2></header>{d.news.map((n:any)=><article key={n.title}><b>{n.title}</b><p>{n.excerpt}</p><small>{n.published_at?new Date(n.published_at).toLocaleDateString():""}</small></article>)}</section>}
    </div>
  </section>

  <div className="v6c-dashboard-legacy">
    <header className="portalOverviewHero"><div><p className="eyebrow">{String(portal).toUpperCase()}</p><h1>Welcome back, {d.profile?.first_name||d.profile?.display_name||"Customer"}</h1><p className="muted">Store, billing, downloads and your OrbitFS services in one place.</p></div><Link className="buttonlink secondary" href="/portal/settings">Account settings</Link></header>
    <div className="portalOverviewStats"><Link href="/portal/settings#wallet" className="portalStatCard"><span className="portalStatIcon">W</span><div><small>WALLET BALANCE</small><strong>{money(d.balance?.available_cents||0)}</strong><span>AUD available</span></div></Link><Link href="/portal/orders" className="portalStatCard"><span className="portalStatIcon">O</span><div><small>ACTIVE ORDERS</small><strong>{activeOrders.length}</strong><span>Current account orders</span></div></Link><Link href="/portal/downloads" className="portalStatCard"><span className="portalStatIcon">D</span><div><small>DOWNLOADS</small><strong>{d.downloads}</strong><span>Paid entitlements</span></div></Link></div>
    <section className="panel portalOrbitfsHub"><div className="portalOrbitfsHead"><div><p className="eyebrow">MY ORBITFS</p><h2>Your OrbitFS</h2><p className="muted">Deploy, license and update your OrbitFS installation from your customer account.</p></div><Link href="/portal/orbitfs">Open My OrbitFS →</Link></div><div className="portalOrbitfsGrid"><Link href="/portal/orbitfs/base"><span className="portalOrbitfsStep">01</span><div><b>Base Deployment</b><span>Connect infrastructure, manage Base, install approved updates and view deployment status.</span></div><i>→</i></Link><Link href="/portal/orbitfs/license"><span className="portalOrbitfsStep">02</span><div><b>Licence</b><span>View and manage the licence attached to your OrbitFS installation.</span></div><i>→</i></Link><Link href="/portal/orbitfs/channels"><span className="portalOrbitfsStep">03</span><div><b>Release Channels</b><span>Join open channels or request access to restricted beta and preview releases.</span></div><i>→</i></Link><Link href="/portal/orbitfs/releases"><span className="portalOrbitfsStep">04</span><div><b>Updates</b><span>View published Update releases, see the installed Update, and deploy approved customer updates.</span></div><i>→</i></Link></div></section>
    <div className="portalOverviewGrid"><section className="panel portalActivityPanel portalOverviewActivity"><div className="portalActivityHeader"><div><p className="eyebrow">ACCOUNT ACTIVITY</p><h2>{meta[tab].title}</h2></div><Link href={meta[tab].href}>{meta[tab].action}</Link></div><div className="portalActivityTabs" role="tablist"><button className={tab==="orders"?"active":""} onClick={()=>setTab("orders")}>Orders</button><button className={tab==="invoices"?"active":""} onClick={()=>setTab("invoices")}>Invoices</button><button className={tab==="support"?"active":""} onClick={()=>setTab("support")}>Support</button></div></section><section className="panel portalQuickActions"><div><p className="eyebrow">QUICK ACCESS</p><h2>Common actions</h2></div></section></div>
    <div className="portalOverviewBottom"><CustomerVisibleNotes entityType="customer" entityId={d.user.id} title="Account notices" />{!!d.news.length&&<section className="panel"><div className="panelTitle"><h2>OrbitFS news</h2></div><div className="miniNews">{d.news.map((n:any)=><article key={n.title}><b>{n.title}</b><span>{n.excerpt}</span></article>)}</div></section>}</div>
  </div>
 </div>;
}
