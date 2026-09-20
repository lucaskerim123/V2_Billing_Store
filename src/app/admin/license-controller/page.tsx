"use client";

import {useEffect,useState} from "react";
import {getClientAccessToken} from "@/lib/license-api";

type LicenseRow=Record<string,any>;
const actionLabels:Record<string,string>={rotate:"Rotate key",activate:"Activate",suspend:"Suspend",terminate:"Terminate",unlock:"Unlock installations"};

export default function LicenseControllerPage(){
  const [licenses,setLicenses]=useState<LicenseRow[]>([]),[error,setError]=useState(""),[loading,setLoading]=useState(true),[busy,setBusy]=useState(""),[newKey,setNewKey]=useState("");
  async function request(path:string,method:"GET"|"POST"="GET",body?:any){
    const token=await getClientAccessToken();
    const response=await fetch(`/api/admin/license-master?path=${encodeURIComponent(path)}`,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{ } ),...(body?{"content-type":"application/json"}:{})},body:body?JSON.stringify(body):undefined,cache:"no-store"});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data?.error||`License Master request failed (${response.status})`);return data;
  }
  async function load(){setLoading(true);setError("");try{const data=await request("/api/licenses");setLicenses(Array.isArray(data?.licenses)?data.licenses:[])}catch(e){setError(e instanceof Error?e.message:"Failed to load licences")}finally{setLoading(false)}}
  async function control(id:string,action:string){if(action==="rotate"&&!confirm("Rotate this licence key? The replacement key will be shown once and the old key will be revoked."))return;setBusy(`${id}:${action}`);setError("");setNewKey("");try{const result=await request(`/api/license/${encodeURIComponent(id)}/control`,"POST",{action,actorRef:"billing_store_license_controller"});const key=result?.key||result?.license?.key||result?.license_key||result?.licenseKey||"";if(action==="rotate"){if(!key)throw new Error("License Master completed the rotation but did not return the replacement key.");setNewKey(String(key));requestAnimationFrame(()=>window.scrollTo({top:0,behavior:"smooth"}));}await load()}catch(e){setError(e instanceof Error?e.message:"License control request failed")}finally{setBusy("")}}
  useEffect(()=>{void load()},[]);
  return <main className="lmPage licenseControllerPage">
    <div className="lmHero"><div><div className="lmEyebrow">MY ORBITFS · LICENSING</div><h1>License Controller</h1><p>Billing Store is the control surface. License Master remains the licensing authority for license state and enforcement.</p></div><div className="lmHeroActions"><button onClick={()=>void load()} disabled={loading}>{loading?"Refreshing…":"Refresh"}</button></div></div>
    {error&&<div className="lmCard" role="alert"><b>License Master request failed</b><p className="muted">{error}</p></div>}{newKey&&<section className="lmCard" role="status" style={{marginBottom:14,position:"sticky",top:12,zIndex:30}}><div className="lmKicker">NEW LICENSE KEY</div><h2>Replacement key generated</h2><p className="muted">This plaintext key is displayed once and remains visible until you dismiss it or refresh the page. License Master does not store plaintext keys.</p><code style={{display:"block",wordBreak:"break-all",fontSize:"1.05rem",padding:"12px 14px",border:"1px solid currentColor",borderRadius:8}}>{newKey}</code><div style={{display:"grid",gridTemplateColumns:"1fr",gap:8,marginTop:12}}><button onClick={()=>void navigator.clipboard?.writeText(newKey)}>Copy new key</button><button onClick={()=>setNewKey("")}>Dismiss</button></div></section>}
    {loading?<div className="lmCard lmLoading">Loading licences…</div>:!licenses.length?<div className="lmCard"><div className="lmKicker">LICENSING</div><h2>No licences</h2><p className="muted">No licences have been provisioned yet.</p></div>:<section className="lmCard"><div className="lmKicker">LICENSE MASTER RECORDS</div><h2>Licences</h2><p className="lmHint">Customer ID is the Billing Store customer reference.</p><div className="lmReleaseList">{licenses.map((license)=><article className="lmRelease" key={String(license.id)}>
      <header><div><b>{String(license.product_code||license.product||"orbitfs_base")}</b><small>License {String(license.id||"")}</small></div><span className="state ready">{String(license.status||"unknown")}</span></header>
      <div className="lmKV"><div><span>Customer ID</span><b>{String(license.customer_external_id||license.metadata?.customerNumber||license.metadata?.customerId||"—")}</b></div><div><span>Customer reference</span><b>{String(license.customer_external_id||license.customer_ref||"—")}</b></div><div><span>Order</span><b>{String(license.external_reference||license.order_ref||"—")}</b></div><div><span>Installations</span><b>{String(license.max_installations||1)}</b></div><div><span>Expires</span><b>{license.expires_at?new Date(license.expires_at).toLocaleString():"Never"}</b></div></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr",gap:8,marginTop:12}}>{["rotate","activate","suspend","terminate","unlock"].map(action=><button key={action} disabled={!!busy||String(license.status)==="terminated"&&action!=="unlock"&&action!=="rotate"} onClick={()=>void control(String(license.id),action)}>{busy===`${license.id}:${action}`?"Working…":actionLabels[action]}</button>)}</div>
    </article>)}</div></section>}
  </main>;
}