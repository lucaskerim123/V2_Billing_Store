"use client";

import {useEffect,useMemo,useState} from "react";

export default function ReleaseChannelsAdmin(){
 const [data,setData]=useState<any>({channels:[],access:[],customers:[]}),[busy,setBusy]=useState(""),[msg,setMsg]=useState("");
 const load=async()=>{setBusy("load");try{const r=await fetch("/api/admin/orbitfs/release-channels",{cache:"no-store"}),j=await r.json();if(!r.ok)throw new Error(j.error||"Could not load release channels");setData(j)}catch(e:any){setMsg(e.message||"Could not load release channels")}finally{setBusy("")}};
 useEffect(()=>{void load()},[]);
 const customers=useMemo(()=>new Map<string,any>((data.customers||[]).map((x:any)=>[String(x.id),x])),[data.customers]);
 async function mutate(body:any){setBusy(body.action||"save");setMsg("");try{const r=await fetch("/api/admin/orbitfs/release-channels",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),j=await r.json();if(!r.ok)throw new Error(j.error||"Operation failed");setMsg("Saved.");await load()}catch(e:any){setMsg(e.message||"Operation failed")}finally{setBusy("")}}
 return <main className="lmPage">
  <div className="lmHero"><div><div className="lmEyebrow">ORBITFS · CUSTOMER DELIVERY</div><h1>Release Channels</h1><p>Billing Store controls which published License Master releases each customer can receive. Developer builds the package; License Master remains the release authority.</p></div><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><a className="buttonlink" href="/admin/orbitfs">← My OrbitFS</a><button onClick={()=>void load()} disabled={!!busy}>{busy==="load"?"Refreshing…":"Refresh"}</button></div></div>
  <section className="lmGrid2">
   <div className="lmCard"><div className="lmKicker">CHANNELS</div><h2>Available delivery channels</h2>{(data.channels||[]).map((c:any)=><div className="lmRelease" key={c.id}><b>{c.label}</b><small>{c.channel} · {c.enabled?"enabled":"disabled"} · {c.customer_visible?"customer visible":"hidden"}</small><p>{c.description}</p></div>)}</div>
   <div className="lmCard"><div className="lmKicker">CREATE / UPDATE</div><h2>Custom channel</h2><div className="form"><label>Channel key<input id="rc-key" className="input" placeholder="dev"/></label><label>Label<input id="rc-label" className="input" placeholder="Development"/></label><label>Description<textarea id="rc-description" className="input" rows={3} placeholder="Development releases for assigned customers."/></label><button className="primary" disabled={!!busy} onClick={()=>void mutate({action:"channel",channel:(document.getElementById("rc-key") as HTMLInputElement)?.value,label:(document.getElementById("rc-label") as HTMLInputElement)?.value,description:(document.getElementById("rc-description") as HTMLTextAreaElement)?.value})}>Save channel</button></div></div>
  </section>
  <section className="lmCard" style={{marginTop:14}}><div className="lmKicker">CUSTOMER ACCESS</div><h2>Who receives each channel</h2><p className="muted">Customers with no explicit channel assignment receive Stable. Once assignments exist, access is explicit.</p>
   {(data.channels||[]).map((c:any)=><div className="lmRelease" key={c.id} style={{marginTop:10}}><div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}><div><b>{c.label}</b><small>{c.channel}</small></div><select className="input" style={{maxWidth:360}} defaultValue="" onChange={e=>{const userId=e.target.value;if(userId)void mutate({action:"grant",channel:c.channel,userId})}}><option value="">Grant access to customer…</option>{(data.customers||[]).map((u:any)=><option key={u.id} value={u.id}>{u.display_name||u.email||u.id}</option>)}</select></div>{(data.access||[]).filter((a:any)=>a.channel_id===c.id).map((a:any)=><div key={a.id} style={{display:"flex",justifyContent:"space-between",gap:10,marginTop:8}}><span>{customers.get(a.user_id)?.display_name||customers.get(a.user_id)?.email||a.user_id}</span><button className="secondary" disabled={!!busy} onClick={()=>void mutate({action:"revoke",id:a.id})}>Revoke</button></div>)}</div>)}
  </section>{msg&&<div className="lmNotice" style={{marginTop:14}}>{msg}</div>}
 </main>
}
