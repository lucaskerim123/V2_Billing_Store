"use client";
import {useEffect,useState} from "react";

export default function LicenseKeyRevealPage(){
  const [token,setToken]=useState("");
  const [key,setKey]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);

  useEffect(()=>{setToken(new URLSearchParams(window.location.search).get("token")||"")},[]);

  async function reveal(){
    if(!token||busy)return;
    setBusy(true);setMessage("");
    try{
      const r=await fetch("/api/license-key/reveal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token}),cache:"no-store"});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(j.error||"Could not reveal licence key.");
      setKey(String(j.licenseKey||""));
      setToken("");
      history.replaceState(null,"",window.location.pathname);
    }catch(e:any){setMessage(e?.message||"Could not reveal licence key.")}
    finally{setBusy(false)}
  }

  async function copy(){
    if(!key)return;
    await navigator.clipboard.writeText(key);
    setMessage("Licence key copied.");
  }

  return <main style={{maxWidth:760,margin:"64px auto",padding:"0 20px"}}>
    <section className="panel">
      <p className="eyebrow">ORBITFS LICENSING</p>
      <h1>Your licence key</h1>
      {!key&&<p className="muted">This link can reveal your initial OrbitFS licence key once. After you reveal it, the link is permanently consumed.</p>}
      {!key&&<button disabled={!token||busy} onClick={()=>void reveal()}>{busy?"Revealing…":"Reveal licence key"}</button>}
      {key&&<div style={{marginTop:20}}>
        <p className="muted">Save this key now. It will not be shown by this link again.</p>
        <code style={{display:"block",wordBreak:"break-all",padding:16,border:"1px solid var(--line)",borderRadius:10}}>{key}</code>
        <button style={{marginTop:12}} onClick={()=>void copy()}>Copy key</button>
      </div>}
      {message&&<p style={{marginTop:16}}>{message}</p>}
    </section>
  </main>;
}
