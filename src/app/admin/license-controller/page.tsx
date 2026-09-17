"use client";

import {useEffect,useState} from "react";

const actions=["block","unblock","suspend","unsuspend","revoke","terminate"] as const;

export default function LicenseControllerPage(){
  const [licenses,setLicenses]=useState<any[]>([]); const [loading,setLoading]=useState(true); const [busy,setBusy]=useState<string>(""); const [error,setError]=useState("");
  async function load(){setLoading(true);setError("");try{const r=await fetch("/api/admin/license-master",{cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error(d?.error||"Unable to load licenses");setLicenses(Array.isArray(d?.licenses)?d.licenses:[]);}catch(e:any){setError(e?.message||"Unable to load licenses");}finally{setLoading(false);}}
  async function control(id:string,action:string){setBusy(`${id}:${action}`);setError("");try{const r=await fetch("/api/orbitfs/license-control",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({licenseId:id,action})});const d=await r.json();if(!r.ok)throw new Error(d?.error||"License action failed");await load();}catch(e:any){setError(e?.message||"License action failed");}finally{setBusy("");}}
  useEffect(()=>{load();},[]);
  return <main style={{padding:24,maxWidth:1200,margin:"0 auto"}}><h1>License Controller</h1><p>Billing Store controls licenses through the Custom License Master API.</p>{error&&<div role="alert" style={{margin:"12px 0"}}>{error}</div>}{loading?<p>Loading licenses…</p>:licenses.length===0?<p>No licenses returned by License Master.</p>:<div style={{display:"grid",gap:12}}>{licenses.map((license)=><section key={license.id||license.license_id} style={{border:"1px solid currentColor",borderRadius:10,padding:16}}><strong>{license.license_key||license.key||license.id}</strong><div>{license.product_code||license.product||"OrbitFS"} · {license.status||"unknown"}</div><div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>{actions.map(action=><button key={action} disabled={busy.length>0} onClick={()=>control(String(license.id||license.license_id),action)}>{busy===`${license.id||license.license_id}:${action}`?"Working…":action}</button>)}</div></section>)}</div>}</main>;
