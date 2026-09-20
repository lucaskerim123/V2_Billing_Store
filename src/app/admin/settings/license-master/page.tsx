"use client";
import {useEffect,useState} from "react";
import {createClient} from "@/lib/supabase";
import Link from "next/link";

export default function LicenseMasterSettings(){
  const [data,setData]=useState<any>(null),[url,setUrl]=useState(""),[busy,setBusy]=useState(false),[msg,setMsg]=useState("");
  async function headers(): Promise<Record<string,string>> {
    const {data:{session}}=await createClient().auth.getSession();
    return session?.access_token ? {Authorization:`Bearer ${session.access_token}`} : {};
  }
  async function load(test=false,saveUrl?:string){
    setBusy(true);setMsg("");
    try{
      const h=await headers();
      const r=await fetch("/api/admin/settings/license-master",{method:test?"POST":"GET",headers:{...h,...(test&&saveUrl?{"Content-Type":"application/json"}:{})},body:test&&saveUrl?JSON.stringify({action:"save",url:saveUrl}):undefined,cache:"no-store"});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(j.error||"License Master request failed");
      setData(test?{...(data||{}),configuredUrl:j.configuredUrl||saveUrl,connection:{...(data?.connection||{}),last_success_at:new Date().toISOString(),last_error:null},test:j,connections:j.products?.map((p:any)=>({code:p.code||p.slug,master:p,local:null,connected:true}))||[]}:j);if(j.configuredUrl)setUrl(j.configuredUrl);
      if(test)setMsg(`License Master connected · ${j.latencyMs}ms · ${j.productCount} products`);
    }catch(e:any){setMsg(e?.message||"License Master unavailable")}finally{setBusy(false)}
  }
  useEffect(()=>{void load(false)},[]);
  const c=data?.connection;
  const connections=Array.isArray(data?.connections)?data.connections:[];
  return <main className="adminShell settingsCompact">
    <header className="adminTop"><div><p className="eyebrow">MY ORBITFS · LICENSE MASTER</p><h1>Product Connections</h1><p className="muted">Billing Store connects to the standalone License Master. Licensing, releases and deployment authority stay in License Master.</p></div><div style={{display:"flex",gap:8}}><Link className="buttonlink secondary" href="/admin/licensing">License Master</Link><button className="buttonlink secondary" onClick={()=>load(true,url)} disabled={busy}>{busy?"Saving…":"Save & test"}</button></div></header>
    <section className="panel"><h2>Connection</h2><p className="muted">This is the Billing Store’s server-side License Master authority endpoint. Changes are admin-only and are tested before being marked healthy. The retired api.incendiarynetworks.cc host is blocked.</p><div className="form"><label>Master API<input value={url||data?.configuredUrl||"https://incendiarynetworks.cc/api"} onChange={e=>setUrl(e.target.value)} spellCheck={false}/></label><label>Master Admin<input readOnly value="https://panel.incendiarynetworks.cc"/></label><label>Status<input readOnly value={c?.enabled!==false?(c?.last_error?"Error":"Connected"):"Disabled"}/></label><label>Last successful test<input readOnly value={c?.last_success_at?new Date(c.last_success_at).toLocaleString():"Not tested"}/></label><label>Last error<input readOnly value={c?.last_error||"None"}/></label></div></section>
    <section className="panel"><h2>OrbitFS products</h2><p className="muted">These are the only product mappings this Store needs from License Master.</p><div className="lmRuntimeList">{connections.map((x:any)=><div key={x.code}><div><b>{x.code}</b><span>{x.master?.name||"Not found in License Master"}</span></div><strong>{x.connected?"Connected":"Not connected"}</strong></div>)}{!connections.length&&<div><b>No product data</b><span>Test the License Master connection to load the canonical catalogue.</span></div>}</div></section>
    {msg&&<p className="inlineStatus">{msg}</p>}
  </main>;
}
