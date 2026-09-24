"use client";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

type Settings={
  enabled:boolean;
  maintenance_mode:boolean;
  maintenance_message?:string;
  customer_deploy_enabled:boolean;
  customer_updates_enabled:boolean;
  customer_rollbacks_enabled:boolean;
};

const defaults:Settings={enabled:true,maintenance_mode:false,customer_deploy_enabled:true,customer_updates_enabled:true,customer_rollbacks_enabled:true};

export default function DeliveryControls({compact=false}:{compact?:boolean}){
  const sb=useMemo(()=>createClient(),[]);
  const [settings,setSettings]=useState<Settings>(defaults);
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");

  async function auth(){const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)throw Error("Administrator session expired. Sign in again.");return {Authorization:`Bearer ${session.access_token}`};}
  async function load(){
    setBusy("load");setMessage("");
    try{
      const r=await fetch("/api/admin/orbitfs/delivery-controls",{headers:await auth(),cache:"no-store"});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw Error(j.error||"Could not load Billing Store delivery controls");
      setSettings({...defaults,...(j.settings||{})});
    }catch(e:any){setMessage(e?.message||"Could not load delivery controls")}finally{setBusy("")}
  }
  async function patch(key:keyof Settings,value:any){
    setBusy(String(key));setMessage("");
    try{
      const r=await fetch("/api/admin/orbitfs/delivery-controls",{method:"PATCH",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify({[key]:value})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw Error(j.error||"Could not update delivery control");
      setSettings({...defaults,...(j.settings||settings),[key]:value});
      setMessage("Billing Store delivery controls updated.");
    }catch(e:any){setMessage(e?.message||"Could not update delivery control")}finally{setBusy("")}
  }
  useEffect(()=>{void load()},[]);

  const rows=[
    {key:"enabled" as const,label:"Customer delivery",detail:"Master Billing Store shutdown for Base installs, Updates and rollback entry points."},
    {key:"customer_deploy_enabled" as const,label:"Base installs",detail:"Allows customers to start or redeploy a published Base release."},
    {key:"customer_updates_enabled" as const,label:"Updates",detail:"Allows customers to apply published manifest-driven Update releases."},
    {key:"customer_rollbacks_enabled" as const,label:"Rollback",detail:"Allows customer rollback where a valid checkpoint is available."},
  ];

  return <section className="panel">
    <div className="panelTitle">
      <div><p className="eyebrow">BILLING STORE · CUSTOMER DELIVERY</p><h2>Delivery switches</h2><p className="muted">These are Billing Store availability gates only. License Manager still owns technical authorization, licensing state and release validation.</p></div>
      <button className="secondary" onClick={()=>void load()} disabled={!!busy}>{busy==="load"?"Refreshing…":"Refresh"}</button>
    </div>
    <div className="orderControlList">
      {rows.map(row=><div key={row.key}>
        <div><b>{row.label}</b><span>{row.detail}</span></div>
        <button type="button" className={`switchControl ${settings[row.key]?"on":""}`} disabled={!!busy} onClick={()=>void patch(row.key,!settings[row.key])}><span/><b>{settings[row.key]?"Enabled":"Disabled"}</b></button>
      </div>)}
      {!compact&&<div>
        <div><b>Maintenance mode</b><span>Temporarily blocks customer delivery while keeping release information visible.</span></div>
        <button type="button" className={`switchControl ${settings.maintenance_mode?"on":""}`} disabled={!!busy} onClick={()=>void patch("maintenance_mode",!settings.maintenance_mode)}><span/><b>{settings.maintenance_mode?"Active":"Normal"}</b></button>
      </div>}
    </div>
    {message&&<p className="notice" style={{marginTop:12}}>{message}</p>}
  </section>;
}