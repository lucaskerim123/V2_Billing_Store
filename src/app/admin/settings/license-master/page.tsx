"use client";
import {useEffect,useState} from "react";
import {createClient} from "@/lib/supabase";

export default function LicenseMasterSettings(){
  const [data,setData]=useState<any>(null),[busy,setBusy]=useState(false),[msg,setMsg]=useState("");
  async function load(test=false){
    setBusy(true);setMsg("");
    try{
      const sb=createClient();const {data:{session}}=await sb.auth.getSession();
      if(!session?.access_token)throw new Error("Staff session required");
      const r=await fetch("/api/admin/settings/license-master",{method:test?"POST":"GET",headers:{Authorization:`Bearer ${session.access_token}`},cache:"no-store"});
      const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Request failed");
      setData(test?{...(data||{}),test:j}:j);if(test)setMsg(j.ok?`Connection OK · ${j.latencyMs}ms · ${j.productCount} products`:(j.error||"Connection failed"));
    }catch(e:any){setMsg(e?.message||"Request failed")}finally{setBusy(false)}
  }
  useEffect(()=>{load(false)},[]);
  const c=data?.connection;
  return <main className="adminShell settingsCompact">
    <header className="adminTop"><div><p className="eyebrow">LICENSING AUTHORITY</p><h1>License Master connection</h1><p className="muted">V2 Billing Store uses License Master as the sole authority for product licensing, validation, issuance and control.</p></div><button className="buttonlink secondary" onClick={()=>load(true)} disabled={busy}>{busy?"Testing…":"Test connection"}</button></header>
    <section className="panel"><h2>Authority</h2><div className="form"><label>Master URL<input readOnly value={data?.configuredUrl||"https://customlicensev1.vercel.app"}/></label><label>Status<input readOnly value={c?.enabled?"Enabled":"Disabled"}/></label><label>Last successful test<input readOnly value={c?.last_success_at?new Date(c.last_success_at).toLocaleString():"Not tested"}/></label><label>Last error<input readOnly value={c?.last_error||"None"}/></label></div></section>
    <section className="panel"><h2>API contract</h2><div className="form"><label>Health<input readOnly value="/api/license/v1/health"/></label><label>Issue licence<input readOnly value="/api/v1/licenses"/></label><label>Validate licence<input readOnly value="/api/v1/licenses/validate"/></label><label>Control licence<input readOnly value="/api/license/{id}/control"/></label></div></section>
    {msg&&<p className="inlineStatus">{msg}</p>}
  </main>;
}
