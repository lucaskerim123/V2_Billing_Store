"use client";

import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";
import "./licensing.css";

type AuthorityData={
 connection?:any;
 configuredUrl?:string;
 masterPanelUrl?:string;
 connections?:Array<{code:string;connected:boolean;master?:any;local?:any}>;
 masterProducts?:any[];
 pulse?:any;
 officialConnections?:any[];
};

const labelFor=(code:string)=>({
 orbitfs_base:"OrbitFS Base",
 orbitfs_apex:"OrbitFS APEX",
 orbitfs_mcp:"OrbitFS MCP",
 orbitfs_studio:"OrbitFS Studio"
}[code]||code);

export default function LicensingAdmin(){
 const sb=useMemo(()=>createClient(),[]);
 const [data,setData]=useState<AuthorityData|null>(null);
 const [loading,setLoading]=useState(true);
 const [testing,setTesting]=useState(false);
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const [latency,setLatency]=useState<number|null>(null);

 async function token(){
  const {data:{session}}=await sb.auth.getSession();
  if(!session?.access_token)throw Error("Administrator session expired.");
  return session.access_token;
 }

 async function fallbackLoad(authToken:string){
  const h={Authorization:"Bearer "+authToken};
  const [health,products]=await Promise.all([
   fetch("/api/admin/license-master?path="+encodeURIComponent("/api/v1/license/health"),{headers:h,cache:"no-store"}),
   fetch("/api/admin/license-master?path="+encodeURIComponent("/api/v1/products"),{headers:h,cache:"no-store"})
  ]);
  const hj=await health.json().catch(()=>({})),pj=await products.json().catch(()=>({}));
  if(!health.ok)throw Error(hj.error||"License Manager health request failed.");
  if(!products.ok)throw Error(pj.error||"License Manager product request failed.");
  const productsList=Array.isArray(pj.products)?pj.products:[];
  return {
   configuredUrl:"https://incendiarynetworks.cc/api/v1",
   masterPanelUrl:"https://panel.incendiarynetworks.cc",
   masterProducts:productsList,
   pulse:hj,
   connections:productsList.map((p:any)=>({code:String(p.code||p.slug||""),connected:true,master:p,local:null}))
  } satisfies AuthorityData;
 }

 async function load(options?:{preserveFeedback?:boolean}){
  setLoading(true);
  if(!options?.preserveFeedback){setError("");setMessage("")}
  try{
   const authToken=await token();
   const r=await fetch("/api/admin/settings/license-master",{headers:{Authorization:"Bearer "+authToken},cache:"no-store"});
   if(r.ok){
    const j=await r.json().catch(()=>({}));
    setData(j);
   }else if(r.status===403){
    setData(await fallbackLoad(authToken));
   }else{
    const j=await r.json().catch(()=>({}));
    throw Error(j.error||"License Manager connection state could not be loaded.");
   }
  }catch(e:any){
   setData(null);
   setError(String(e?.message||"License Manager unavailable"));
  }finally{setLoading(false)}
 }

 async function testConnection(){
  setTesting(true);setError("");setMessage("");
  try{
   const authToken=await token();
   const r=await fetch("/api/admin/settings/license-master",{
    method:"POST",
    headers:{Authorization:"Bearer "+authToken,"content-type":"application/json"},
    body:JSON.stringify({action:"test"})
   });
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"License Manager connection test failed.");
   setLatency(Number.isFinite(Number(j.latencyMs))?Number(j.latencyMs):null);
   setMessage("License Manager connection test passed.");
   await load({preserveFeedback:true});
  }catch(e:any){setError(String(e?.message||"License Manager connection test failed."))}
  finally{setTesting(false)}
 }

 useEffect(()=>{void load()},[]);

 const products=data?.masterProducts||[];
 const connections=data?.connections||[];
 const connectedCount=connections.filter(x=>x.connected).length;
 const configuredUrl=String(data?.configuredUrl||"https://incendiarynetworks.cc/api/v1");
 const authorityOnline=Boolean(data&&!error);
 const connection=data?.connection||{};
 const lastSuccess=connection?.last_success_at?new Date(connection.last_success_at).toLocaleString():"Not recorded";
 const lastTested=connection?.last_tested_at?new Date(connection.last_tested_at).toLocaleString():"Not recorded";
 const pulseRevision=Number(data?.pulse?.pulse_revision||data?.pulse?.revision||0);

 return <main className="lmPage orbitAuthorityPage orbitPhaseOne">
  <header className="orbitReferenceHero orbitPhaseHero">
   <div>
    <p className="eyebrow">MY ORBITFS · LICENSE AUTHORITY</p>
    <h1>License System</h1>
    <p className="muted">Billing Store connects to the standalone License Manager for licences, products, release channels and deployment authority. This page reports that connection; it does not duplicate technical state.</p>
   </div>
   <div className="orbitReferenceHeroActions">
    <a className="buttonlink secondary" href={data?.masterPanelUrl||"https://panel.incendiarynetworks.cc"} target="_blank" rel="noreferrer">Open Master Panel</a>
    <Link className="buttonlink secondary" href="/admin/license-controller">Customer licences</Link>
    <Link className="buttonlink secondary" href="/admin/settings/license-master">Product connections</Link>
    <button type="button" onClick={()=>void load()} disabled={loading}>{loading?"Refreshing…":"Refresh"}</button>
   </div>
  </header>

  {error&&<div className="orbitReferenceNotice danger" role="alert"><b>Authority unavailable</b><span>{error}</span></div>}
  {message&&<div className="orbitReferenceNotice" role="status">{message}</div>}

  <section className="orbitAuthorityStatus">
   <div className="orbitAuthorityState">
    <span className={"orbitAuthorityDot "+(authorityOnline?"online":"offline")} aria-hidden="true"/>
    <div><small>AUTHORITY CONNECTION</small><b>{authorityOnline?"Online":"Unavailable"}</b><span>{authorityOnline?"License Manager is responding through the configured API.":"Billing will not create substitute licensing state."}</span></div>
   </div>
   <button className="secondary" type="button" onClick={()=>void testConnection()} disabled={testing||loading}>{testing?"Testing…":"Test connection"}</button>
  </section>

  {loading&&!data?<section className="orbitAuthorityPanel"><div className="orbitReferenceEmpty">Checking License Manager authority…</div></section>:<>
   <section className="orbitAuthorityGrid">
    <article className="orbitAuthorityPanel">
     <div className="orbitAuthorityPanelHead"><div><p className="eyebrow">CONNECTION</p><h2>Authority endpoint</h2></div><span className={"orbitMiniState "+(authorityOnline?"live":"")}>{authorityOnline?"Online":"Offline"}</span></div>
     <div className="orbitAuthorityFacts">
      <div><span>API</span><b className="orbitMono">{configuredUrl}</b></div>
      <div><span>Last successful test</span><b>{lastSuccess}</b></div>
      <div><span>Last checked</span><b>{lastTested}</b></div>
      <div><span>Last measured latency</span><b>{latency!==null?latency+" ms":"Run connection test"}</b></div>
     </div>
    </article>

    <article className="orbitAuthorityPanel">
     <div className="orbitAuthorityPanelHead"><div><p className="eyebrow">CAPABILITIES</p><h2>Authority coverage</h2></div><span>{connectedCount}/{Math.max(connections.length,4)} products</span></div>
     <div className="orbitAuthorityCapabilityList">
      <div><b>Licensing</b><span>Issuance, status, keys, entitlements and activations</span><strong>License Manager</strong></div>
      <div><b>Release channels</b><span>Shared Base + Update channel definitions and access</span><strong>License Manager</strong></div>
      <div><b>Release authority</b><span>Validation, approval, artifacts, manifests and publication state</span><strong>License Manager</strong></div>
      <div><b>Deployment authority</b><span>Authorization, coordination and result recording</span><strong>License Manager</strong></div>
     </div>
    </article>
   </section>

   <section className="orbitAuthorityPanel">
    <div className="orbitAuthorityPanelHead">
     <div><p className="eyebrow">CANONICAL CATALOGUE</p><h2>Connected OrbitFS products</h2><p>Product mappings compare the Billing catalogue with the authoritative License Manager registry.</p></div>
     <span>{products.length} returned</span>
    </div>
    <div className="orbitAuthorityProducts">
     {(connections.length?connections:products.map((p:any)=>({code:String(p.code||p.slug||""),connected:true,master:p,local:null}))).map((row:any)=>{
      const code=String(row.code||row.master?.code||row.master?.slug||"");
      return <article key={code||row.master?.id}>
       <div className="orbitAuthorityProductMark">{code==="orbitfs_base"?"B":code==="orbitfs_mcp"?"M":code==="orbitfs_apex"?"A":"S"}</div>
       <div><b>{labelFor(code)}</b><span className="orbitMono">{code||"Unknown product"}</span><small>{row.master?.name||"Registered in License Manager"}</small></div>
       <span className={"orbitMiniState "+(row.connected?"live":"")}>{row.connected?"Connected":"Needs mapping"}</span>
      </article>
     })}
     {!products.length&&!connections.length&&<div className="orbitReferenceEmpty compact">No canonical OrbitFS products were returned by License Manager.</div>}
    </div>
   </section>

   <section className="orbitAuthorityPanel orbitAuthorityRuntime">
    <div className="orbitAuthorityPanelHead"><div><p className="eyebrow">RUNTIME AUTHORITY</p><h2>Current authority state</h2></div><span>Revision {pulseRevision||"—"}</span></div>
    <div className="orbitAuthorityFacts">
     <div><span>Connection enabled</span><b>{connection?.enabled===false?"Disabled":"Enabled"}</b></div>
     <div><span>Official endpoints</span><b>{Array.isArray(data?.officialConnections)?data!.officialConnections!.length:"—"}</b></div>
     <div><span>Product mappings</span><b>{connectedCount} connected</b></div>
     <div><span>Authority owner</span><b>License Manager</b></div>
    </div>
   </section>
  </>}
 </main>
}
