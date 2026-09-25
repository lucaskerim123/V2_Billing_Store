"use client";

import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";
import CustomerVisibleNotes from "@/components/CustomerVisibleNotes";

type ActivityTab="orders"|"invoices"|"support";
const money=(cents:any)=>new Intl.NumberFormat("en-AU",{style:"currency",currency:"AUD"}).format(Number(cents||0)/100);
export default function Portal(){
 const sb=createClient();
 const [d,setD]=useState<any>();
 const [tab,setTab]=useState<ActivityTab>("orders");
 useEffect(()=>{(async()=>{const {data:{user}}=await sb.auth.getUser();if(!user)return;const [p,b,t,o,i,n,e,s]=await Promise.all([
  sb.from("user_profiles").select("id,display_name,first_name").eq("id",user.id).single(),
  sb.from("account_balances").select("user_id,available_cents").eq("user_id",user.id).single(),
  sb.from("support_tickets").select("id,ticket_number,subject,status,updated_at").eq("user_id",user.id).order("updated_at",{ascending:false}).limit(5),
  sb.from("orders").select("id,order_number,status,total_cents,created_at").eq("auth_user_id",user.id).order("created_at",{ascending:false}).limit(25),
  sb.from("invoices").select("id,invoice_number,status,total_cents,created_at").eq("auth_user_id",user.id).order("created_at",{ascending:false}).limit(5),
  sb.from("news_posts").select("title,excerpt,published_at").eq("published",true).order("published_at",{ascending:false}).limit(3),
  sb.from("download_entitlements").select("id").eq("auth_user_id",user.id).eq("status","active").limit(100),
  sb.from("app_settings").select("key,value").eq("category","identity").limit(25)
 ]);const id=Object.fromEntries((s.data||[]).map((x:any)=>[x.key.split(".").pop(),x.value]));setD({user,profile:p.data,balance:b.data,tickets:t.data||[],orders:o.data||[],invoices:i.data||[],news:n.data||[],downloads:e.data?.length||0,id})})()},[]);
 const activeOrders=useMemo(()=>{if(!d)return[];const terminal=new Set(["completed","cancelled","canceled","refunded"]);return d.orders.filter((o:any)=>!terminal.has(String(o.status||"").toLowerCase()))},[d]);
 if(!d)return <section>Loading portal…</section>;
 const portal=d.id.portal_name||"Customer Portal",recentActiveOrders=activeOrders.slice(0,5);
 const meta:Record<ActivityTab,{title:string;href:string;action:string}>={orders:{title:"Recent active orders",href:"/portal/orders",action:"View all orders"},invoices:{title:"Recent invoices",href:"/portal/invoices",action:"View all invoices"},support:{title:"Support tickets",href:"/portal/support",action:"View support"}};
 return <div className="portalOverviewV2">
  <header className="portalOverviewHero"><div><p className="eyebrow">{String(portal).toUpperCase()}</p><h1>Welcome back, {d.profile?.first_name||d.profile?.display_name||"Customer"}</h1><p className="muted">Store, billing, downloads and your OrbitFS services in one place.</p></div><Link className="buttonlink secondary" href="/portal/settings">Account settings</Link></header>

  <div className="portalOverviewStats"><Link href="/portal/settings#wallet" className="portalStatCard"><span className="portalStatIcon">W</span><div><small>WALLET BALANCE</small><strong>{money(d.balance?.available_cents||0)}</strong><span>AUD available</span></div></Link><Link href="/portal/orders" className="portalStatCard"><span className="portalStatIcon">O</span><div><small>ACTIVE ORDERS</small><strong>{activeOrders.length}</strong><span>Current account orders</span></div></Link><Link href="/portal/downloads" className="portalStatCard"><span className="portalStatIcon">D</span><div><small>DOWNLOADS</small><strong>{d.downloads}</strong><span>Paid entitlements</span></div></Link></div>

  <section className="panel portalOrbitfsHub">
   <div className="portalOrbitfsHead"><div><p className="eyebrow">MY ORBITFS</p><h2>Your OrbitFS</h2><p className="muted">Deploy, license and update your OrbitFS installation from your customer account.</p></div><Link href="/portal/orbitfs">Open My OrbitFS →</Link></div>
   <div className="portalOrbitfsGrid">
    <Link href="/portal/orbitfs"><span className="portalOrbitfsStep">01</span><div><b>Base Deployment</b><span>Connect your infrastructure and manage your OrbitFS Base installation.</span></div><i>→</i></Link>
    <Link href="/portal/orbitfs/license"><span className="portalOrbitfsStep">02</span><div><b>License Controller</b><span>View and manage the licence attached to your OrbitFS installation.</span></div><i>→</i></Link>
    <Link href="/portal/orbitfs/releases"><span className="portalOrbitfsStep">03</span><div><b>Update Release System</b><span>See approved updates, release history and available customer releases.</span></div><i>→</i></Link>
   </div>
  </section>

  <div className="portalOverviewGrid"><section className="panel portalActivityPanel portalOverviewActivity"><div className="portalActivityHeader"><div><p className="eyebrow">ACCOUNT ACTIVITY</p><h2>{meta[tab].title}</h2></div><Link href={meta[tab].href}>{meta[tab].action}</Link></div><div className="portalActivityTabs" role="tablist"><button className={tab==="orders"?"active":""} onClick={()=>setTab("orders")}>Orders</button><button className={tab==="invoices"?"active":""} onClick={()=>setTab("invoices")}>Invoices</button><button className={tab==="support"?"active":""} onClick={()=>setTab("support")}>Support</button></div><div className="portalActivityBody">{tab==="orders"&&<>{recentActiveOrders.length?recentActiveOrders.map((o:any)=><Link className="listrow" href={`/portal/orders/${o.id}`} key={o.id}><b>#{o.order_number}</b><span>{o.status} · {money(o.total_cents)}</span></Link>):<p className="muted">No active orders.</p>}</>}{tab==="invoices"&&<>{d.invoices.length?d.invoices.map((i:any)=><Link className="listrow" href={`/portal/invoices/${i.id}`} key={i.id}><b>{i.invoice_number}</b><span>{i.status} · {money(i.total_cents)}</span></Link>):<p className="muted">No invoices yet.</p>}</>}{tab==="support"&&<>{d.tickets.length?d.tickets.map((t:any)=><Link className="listrow" href={`/portal/support/${t.id}`} key={t.id}><b>#{t.ticket_number} {t.subject}</b><span>{String(t.status||"").replaceAll("_"," ")}</span></Link>):<p className="muted">No support tickets.</p>}</>}</div></section><section className="panel portalQuickActions"><div><p className="eyebrow">QUICK ACCESS</p><h2>Common actions</h2></div><Link href="/portal/orbitfs"><b>My OrbitFS</b><span>Deployment, licence and updates</span></Link><Link href="/portal/products"><b>Browse OrbitFS Store</b><span>Products and add-ons</span></Link><Link href="/portal/settings#wallet"><b>Manage Wallet</b><span>Add funds, redeem coupons, view activity</span></Link><Link href="/portal/support"><b>Get support</b><span>Tickets and support messages</span></Link></section></div>
  <div className="portalOverviewBottom"><CustomerVisibleNotes entityType="customer" entityId={d.user.id} title="Account notices" />{!!d.news.length&&<section className="panel"><div className="panelTitle"><h2>OrbitFS news</h2></div><div className="miniNews">{d.news.map((n:any)=><article key={n.title}><b>{n.title}</b><span>{n.excerpt}</span></article>)}</div></section>}</div>
 </div>
}
