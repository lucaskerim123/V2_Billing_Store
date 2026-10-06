"use client";

import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

type StatusTone="ready"|"warning"|"offline"|"neutral";
type StatusItem={label:string;value:string;detail:string;tone:StatusTone};

function stateLabel(value:unknown){
  const raw=String(value||"").trim();
  return raw?raw.replaceAll("_"," "):"Unknown";
}

export default function MyOrbitFSHome(){
  const sb=useMemo(()=>createClient(),[]);
  const [data,setData]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState("");

  async function load(){
    setLoading(true);setMessage("");
    try{
      const {data:{session}}=await sb.auth.getSession();
      if(!session?.access_token)throw new Error("Your session has expired. Please sign in again.");
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),15000);
      try{
        const response=await fetch("/api/orbitfs/status",{headers:{Authorization:`Bearer ${session.access_token}`},cache:"no-store",signal:controller.signal});
        const body=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(body.error||"Could not load OrbitFS status.");
        setData(body);
      }finally{clearTimeout(timer)}
    }catch(error:any){
      setMessage(error?.name==="AbortError"?"OrbitFS status request timed out.":error?.message||"Could not load OrbitFS status.");
    }finally{setLoading(false)}
  }

  useEffect(()=>{void load()},[]);

  const settings=data?.settings||{};
  const connections=Array.isArray(data?.connections)?data.connections:[];
  const installations=Array.isArray(data?.installations)?data.installations:[];
  const supabase=connections.find((row:any)=>row?.provider==="supabase");
  const vercel=connections.find((row:any)=>row?.provider==="vercel");
  const install=installations[0]||null;

  const status:StatusItem[]=[
    {
      label:"License Manager API",
      value:settings.maintenance_mode?"Maintenance":settings.enabled===false||settings.license_authority_available===false?"Unavailable":"Operational",
      detail:settings.maintenance_mode?(settings.maintenance_message||"Maintenance mode is active."):settings.license_authority_available===false?(settings.license_authority_notice||"Licensing authority is unavailable."):"Licensing and entitlement authority is responding.",
      tone:settings.maintenance_mode?"warning":settings.enabled===false||settings.license_authority_available===false?"offline":"ready"
    },
    {
      label:"Release Authority",
      value:settings.release_authority_available===false?"Unavailable":"Operational",
      detail:settings.release_authority_available===false?"Published release discovery is currently unavailable.":"Published Base and Update release authority is available.",
      tone:settings.release_authority_available===false?"offline":"ready"
    },
    {
      label:"Deployment Authority",
      value:settings.deployment_authority_available===false||settings.customer_deploy_enabled===false?"Restricted":"Operational",
      detail:settings.deployment_authority_available===false?"Deployment authorization is unavailable.":settings.customer_deploy_enabled===false?"Customer Base deployment is currently disabled.":"Customer deployment authorization is available.",
      tone:settings.deployment_authority_available===false||settings.customer_deploy_enabled===false?"warning":"ready"
    },
    {
      label:"Supabase Connection",
      value:supabase?.status==="connected"?"Connected":"Not connected",
      detail:supabase?.status==="connected"?(supabase?.provider_account_name||"Customer Supabase account connected."):"Connect Supabase from Base Deployment when needed.",
      tone:supabase?.status==="connected"?"ready":"neutral"
    },
    {
      label:"Vercel Connection",
      value:vercel?.status==="connected"&&vercel?.metadata?.api_ready===true?"Connected":vercel?.status==="connected"?"Needs attention":"Not connected",
      detail:vercel?.status==="connected"&&vercel?.metadata?.api_ready===true?(vercel?.provider_account_name||"Vercel API access is ready."):vercel?.status==="connected"?"Connection exists but API access is not ready.":"Connect Vercel from Base Deployment when needed.",
      tone:vercel?.status==="connected"&&vercel?.metadata?.api_ready===true?"ready":vercel?.status==="connected"?"warning":"neutral"
    },
    {
      label:"Base Runtime",
      value:install?stateLabel(install?.health_status||install?.state):"Not deployed",
      detail:install?.production_url?String(install.production_url):install?"Installation exists but no production URL is recorded.":"No Base installation is recorded yet.",
      tone:install?.health_status==="healthy"?"ready":install&&String(install?.state||"").toLowerCase()==="failed"?"offline":install?"warning":"neutral"
    }
  ];

  const healthy=status.filter(item=>item.tone==="ready").length;
  const attention=status.filter(item=>item.tone==="warning"||item.tone==="offline").length;

  return <main className="v6c-orbit-home">
    <section className="v6c-orbit-landing-hero">
      <div>
        <span className="v6c-context-badge">MY ORBITFS</span>
        <h1>Your OrbitFS control hub.</h1>
        <p>Open Base Deployment or the Update Release System, manage licence access and check the live status of the services your installation depends on.</p>
      </div>
      <div className="v6c-orbit-landing-art" aria-hidden="true"><i/><b/><span/></div>
    </section>

    <section className="v6c-orbit-primary-grid">
      <Link className="v6c-orbit-destination primary" href="/portal/orbitfs/base">
        <span className="v6c-destination-number">01</span>
        <div><small>DEPLOYMENT</small><h2>Base Deployment</h2><p>Connect Supabase and Vercel, configure the approved Base release and manage the deployed customer runtime.</p></div>
        <b>Open Base Deployment →</b>
      </Link>
      <Link className="v6c-orbit-destination primary update" href="/portal/orbitfs/releases">
        <span className="v6c-destination-number">02</span>
        <div><small>UPDATES</small><h2>Update Release System</h2><p>Choose published Updates, review compatibility, follow live execution and use recovery controls when required.</p></div>
        <b>Open Update System →</b>
      </Link>
    </section>

    <section className="v6c-orbit-secondary-grid">
      <Link className="v6c-orbit-destination compact" href="/portal/orbitfs/license"><small>LICENSING</small><h3>License Controller</h3><p>View authoritative licence state and permitted customer actions.</p><span>Open →</span></Link>
      <Link className="v6c-orbit-destination compact" href="/portal/orbitfs/channels"><small>RELEASE ACCESS</small><h3>Release Channels</h3><p>Manage the shared Base + Update channels your licence can discover.</p><span>Open →</span></Link>
    </section>

    <section className="v6c-system-status">
      <header>
        <div><span className="v6c-context-badge">SYSTEM STATUS</span><h2>OrbitFS service health</h2><p>Live customer-facing status from the existing OrbitFS authority and provider connections.</p></div>
        <div className="v6c-status-summary"><b>{loading?"…":healthy}/{status.length}</b><span>{loading?"Checking services":attention?"service checks need attention":"services operational"}</span><button type="button" onClick={()=>void load()} disabled={loading}>{loading?"Checking…":"Refresh status"}</button></div>
      </header>
      {message&&<p className="v6c-status-message">{message}</p>}
      <div className="v6c-status-grid">
        {status.map(item=><article className={"v6c-status-card tone-"+item.tone} key={item.label}>
          <div><i/><small>{item.label}</small></div>
          <b>{loading?"Checking…":item.value}</b>
          <p>{loading?"Reading live status…":item.detail}</p>
        </article>)}
      </div>
    </section>
  </main>;
}
