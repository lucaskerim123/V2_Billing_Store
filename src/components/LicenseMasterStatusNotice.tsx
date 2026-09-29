"use client";
import {useEffect,useState} from "react";

const DISMISS_KEY="orbitfs.limp.notice.dismissed";

export default function LicenseMasterStatusNotice(){
  const [state,setState]=useState<any>(null);
  const [dismissed,setDismissed]=useState(false);

  useEffect(()=>{
    let live=true,t:any;
    async function load(){
      try{
        const r=await fetch("/api/system/license-master-status",{cache:"no-store"});
        const j=await r.json();
        if(live){
          setState(j);
          const limp=j?.fallback===true||j?.reason==="fallback_limp"||j?.mode==="limp";
          if(limp)setDismissed(typeof window!=="undefined"&&window.localStorage.getItem(DISMISS_KEY)==="1");
          else{
            setDismissed(false);
            if(typeof window!=="undefined")window.localStorage.removeItem(DISMISS_KEY);
          }
        }
      }catch{
        if(live)setState({restricted:true,reason:"unreachable",fallback:false,mode:"unavailable",fulfillment_mode:"manual",notice:"OrbitFS licensing services are temporarily unavailable. New licence fulfilment is paused."});
      }
      if(live)t=setTimeout(load,30000);
    }
    void load();
    return()=>{live=false;if(t)clearTimeout(t)};
  },[]);

  if(!state?.restricted)return null;
  const limp=state?.fallback===true||state?.reason==="fallback_limp"||state?.mode==="limp";
  const label=limp?"API FALLBACK / LIMP MODE":state.reason==="store_maintenance"?"OrbitFS Store maintenance":state.reason==="maintenance"?"License Master maintenance":state.reason==="api_disabled"?"License Master API disabled":state.reason==="licensing_disabled"?"License issuance disabled":state.reason==="billing_database_unavailable"?"Billing Store database unavailable":"License Master unavailable";

  if(limp&&dismissed){
    return <button
      type="button"
      aria-label="Open OrbitFS limp mode notice"
      onClick={()=>{setDismissed(false);if(typeof window!=="undefined")window.localStorage.removeItem(DISMISS_KEY)}}
      style={{position:"fixed",right:16,bottom:16,zIndex:1000,border:"1px solid #9a741f",borderRadius:999,background:"#251d08",color:"#f6dda0",padding:"7px 11px",fontSize:11,fontWeight:800,letterSpacing:".06em",cursor:"pointer"}}
    >LIMP MODE</button>;
  }

  return <div role="status" style={{padding:"10px 16px",borderBottom:"1px solid #7a5d18",background:"#251d08",color:"#f6dda0",fontSize:12,lineHeight:1.5,display:"flex",gap:12,alignItems:"center",justifyContent:"space-between"}}>
    <div>
      <b>{label}.</b> {state.notice||"New licence fulfilment is paused."} <span style={{opacity:.8}}>Fulfilment mode: {state.fulfillment_mode||"manual"}.</span>
      {limp&&<span style={{opacity:.8}}> Primary authority decisions and all deployment/release mutations remain disabled.</span>}
    </div>
    {limp&&<button
      type="button"
      onClick={()=>{setDismissed(true);if(typeof window!=="undefined")window.localStorage.setItem(DISMISS_KEY,"1")}}
      style={{border:"1px solid rgba(246,221,160,.35)",borderRadius:6,background:"transparent",color:"inherit",padding:"4px 8px",fontSize:11,cursor:"pointer",flex:"0 0 auto"}}
    >Dismiss</button>}
  </div>;
}
