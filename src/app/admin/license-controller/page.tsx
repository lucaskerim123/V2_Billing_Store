"use client";
import {useEffect,useState} from "react";
import {getClientAccessToken} from "@/lib/license-api";

type LicenseRow=Record<string,any>;
const actionLabels:Record<string,string>={activate:"Activate",suspend:"Suspend",terminate:"Terminate",unlock:"Unlock installations"};

export default function LicenseControllerPage(){
  const [licenses,setLicenses]=useState<LicenseRow[]>([]),[error,setError]=useState(""),[loading,setLoading]=useState(true),[busy,setBusy]=useState("");
  async function request(path:string,method:"GET"|"POST"="GET",body?:any){
    const token=await getClientAccessToken();
    const response=await fetch(`/api/admin/license-master?path=${encodeURIComponent(path)}`,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{}),...(body?{"content-type":"application/json"}:{})},body:body?JSON.stringify(body):undefined,cache:"no-store"});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data?.error||`License Master request failed (${response.status})`);return data;
  }
  async function load(){setLoading(true);setError("");try{const data=await request("/api/licenses");setLicenses(Array.isArray(data?.licenses)?data.licenses:[])}catch(e){setError(e instanceof Error?e.message:"Failed to load licences")}finally{setLoading(false)}}
  async function control(id:string,action:string){setBusy(`${id}:${action}`);setError("");try{await request(`/api/license/${encodeURIComponent(id)}/control`,"POST",{action,actorRef:"billing_store_license_controller"});await load()}catch(e){setError(e instanceof Error?e.message:"License control request failed")}finally{setBusy("")}}
  useEffect(()=>{void load()},[]);
  return <main style={{padding:24,maxWidth:1250,margin:"0 auto"}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"center",marginBottom:20}}><div><div style={{fontSize:12,letterSpacing:1,textTransform:"uppercase",opacity:.65}}>My OrbitFS · Licensing</div><h1 style={{margin:"6px 0"}}>License Controller</h1><p style={{margin:0,opacity:.75}}>Billing Store is the control surface. License Master remains the licensing authority.</p></div><button onClick={()=>void load()} disabled={loading}>{loading?"Loading…":"Refresh"}</button></div>
    {error&&<div role="alert" style={{padding:12,marginBottom:16,border:"1px solid #b33",borderRadius:8}}>{error}</div>}
    {loading?<p>Loading licences…</p>:!licenses.length?<div style={{padding:20,border:"1px solid #ddd",borderRadius:10}}>No licences have been provisioned yet.</div>:<div style={{display:"grid",gap:12}}>{licenses.map((license)=><section key={String(license.id)} style={{padding:16,border:"1px solid #ddd",borderRadius:10}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><div><strong>{String(license.product_code||license.product||"orbitfs_base")}</strong><div style={{fontSize:13,opacity:.7}}>License {String(license.id||"")}</div></div><strong>{String(license.status||"unknown")}</strong></div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10,marginTop:14,fontSize:13}}>
        <div><span>Customer ID</span><br/><strong>{String(license.customer_id||license.metadata?.customerId||"—")}</strong></div>
        <div><span>Customer reference</span><br/><strong>{String(license.customer_external_id||license.customer_ref||"—")}</strong></div>
        <div><span>Order</span><br/><strong>{String(license.external_reference||license.order_ref||"—")}</strong></div>
        <div><span>Installations</span><br/><strong>{String(license.max_installations||1)}</strong></div>
        <div><span>Expires</span><br/><strong>{license.expires_at?new Date(license.expires_at).toLocaleString():"Never"}</strong></div>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>{["activate","suspend","terminate","unlock"].map(action=><button key={action} disabled={!!busy||String(license.status)==="terminated"&&action!=="unlock"} onClick={()=>void control(String(license.id),action)}>{busy===`${license.id}:${action}`?"Working…":actionLabels[action]}</button>)}</div>
    </section>)}</div>}
  </main>;
}