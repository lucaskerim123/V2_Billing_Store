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

  async function auth(){const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)throw Error("Administrator session expired. Sign in again.");return {Authorization:"Bearer "+session.access_token};}
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
      setMessage("Delivery controls updated.");
    }catch(e:any){setMessage(e?.message||"Could not update delivery control")}finally{setBusy("")}
  }
  useEffect(()=>{void load()},[]);

  const controls=[
    {key:"enabled" as const,label:"Customer delivery",short:"Delivery"},
    {key:"customer_deploy_enabled" as const,label:"Base installs",short:"Base"},
    {key:"customer_updates_enabled" as const,label:"Update installs",short:"Updates"},
    {key:"customer_rollbacks_enabled" as const,label:"Rollback",short:"Rollback"},
  ];

  return <section className={"orbitDeliveryBar "+(compact?"compact":"")}>
    <div className="orbitDeliveryBarHead">
      <div><p className="eyebrow">CUSTOMER DELIVERY</p><b>Billing Store gates</b></div>
      <button className="secondary orbitMiniButton" onClick={()=>void load()} disabled={!!busy}>{busy==="load"?"Refreshing…":"Refresh"}</button>
    </div>

    <div className="orbitDeliveryControls">
      {controls.map(control=>{
        const on=settings[control.key];
        return <button
          key={control.key}
          type="button"
          className={"orbitGateButton "+(on?"on":"off")}
          disabled={!!busy}
          onClick={()=>void patch(control.key,!on)}
          title={control.label}
        >
          <span className="orbitGateDot"/>
          <span>{compact?control.short:control.label}</span>
          <strong>{on?"ON":"OFF"}</strong>
        </button>
      })}
      {!compact&&<button
        type="button"
        className={"orbitGateButton "+(settings.maintenance_mode?"warn":"on")}
        disabled={!!busy}
        onClick={()=>void patch("maintenance_mode",!settings.maintenance_mode)}
      >
        <span className="orbitGateDot"/>
        <span>Maintenance</span>
        <strong>{settings.maintenance_mode?"ACTIVE":"NORMAL"}</strong>
      </button>}
    </div>

    {!compact&&<div className="orbitDeliveryHint">
      <span>These switches only control Billing Store customer availability.</span>
      <span>License Manager remains the technical authority.</span>
    </div>}
    {message&&<div className="orbitInlineNotice orbitDeliveryMessage">{message}</div>}
  </section>;
}
