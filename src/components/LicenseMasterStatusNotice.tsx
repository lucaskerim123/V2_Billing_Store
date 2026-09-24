"use client";
import {useEffect,useState} from "react";

export default function LicenseMasterStatusNotice(){
  const [state,setState]=useState<any>(null);
  useEffect(()=>{let live=true,t:any;async function load(){try{const r=await fetch("/api/system/license-master-status",{cache:"no-store"});const j=await r.json();if(live)setState(j)}catch{if(live)setState({restricted:true,reason:"unreachable",fulfillment_mode:"manual",notice:"OrbitFS licensing services are temporarily unavailable. New licence fulfilment is paused."})}if(live)t=setTimeout(load,30000)}void load();return()=>{live=false;if(t)clearTimeout(t)}},[]);
  if(!state?.restricted)return null;
  const label=state.reason==="store_maintenance"?"OrbitFS Store maintenance":state.reason==="maintenance"?"License Master maintenance":state.reason==="api_disabled"?"License Master API disabled":state.reason==="licensing_disabled"?"License issuance disabled":state.reason==="billing_database_unavailable"?"Billing Store database unavailable":"License Master unavailable";
  return <div role="status" style={{padding:"10px 16px",borderBottom:"1px solid #7a5d18",background:"#251d08",color:"#f6dda0",fontSize:12,lineHeight:1.5}}>
    <b>{label}.</b> {state.notice||"New licence fulfilment is paused."} <span style={{opacity:.8}}>Fulfilment mode: {state.fulfillment_mode||"manual"}.</span>
  </div>;
}
