"use client";

import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

export default function ReleaseChannelsAdmin(){
 const sb=useMemo(()=>createClient(),[]);
 const [data,setData]=useState<any>({channels:[],access:[],customers:[],requests:[]}),[busy,setBusy]=useState(""),[msg,setMsg]=useState("");
 const authHeaders=async()=>{const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)throw Error("Administrator session expired. Sign in again.");return {Authorization:`Bearer ${session.access_token}`};};
 const load=async()=>{setBusy("load");setMsg("");try{const r=await fetch("/api/admin/orbitfs/release-channels",{headers:await authHeaders(),cache:"no-store"}),j=await r.json();if(!r.ok)throw new Error(j.error||"Could not load release channels");setData(j)}catch(e:any){setMsg(e.message||"Could not load release channels")}finally{setBusy("")}};
 useEffect(()=>{void load()},[]);
 const customers=useMemo(()=>new Map<string,any>((data.customers||[]).map((x:any)=>[String(x.id),x])),[data.customers]);
 async function mutate(body:any){setBusy(body.action||"save");setMsg("");try{const r=await fetch("/api/admin/orbitfs/release-channels",{method:"POST",headers:{"content-type":"application/json",...(await authHeaders())},body:JSON.stringify(body)}),j=await r.json();if(!r.ok)throw new Error(j.error||"Operation failed");setMsg("Release channel state synced.");await load()}catch(e:any){setMsg(e.message||"Operation failed")}finally{setBusy("")}}
 const visible=(data.channels||[]).filter((c:any)=>c.enabled&&c.customer_visible);
 return <main className="adminShell">
  <header className="adminTop">
   <div><p className="eyebrow">ORBITFS CONTROL · RELEASE CHANNELS</p><h1>Customer release access</h1><p className="muted">License Manager owns channel definitions and entitlement policy. Billing Store mirrors that state and manages the customer-facing access workflow.</p></div>
   <div className="actions"><button className="secondary" onClick={()=>void mutate({action:"sync"})} disabled={!!busy}>{busy==="sync"?"Syncing…":"Sync from License Manager"}</button><button className="secondary" onClick={()=>void load()} disabled={!!busy}>{busy==="load"?"Refreshing…":"Refresh"}</button></div>
  </header>

  {msg&&<p className="notice">{msg}</p>}

  <div className="stats">
   <article><span>Visible channels</span><b>{visible.length}</b><small>Customer-facing definitions</small></article>
   <article><span>Pending requests</span><b>{(data.requests||[]).length}</b><small>Awaiting an access decision</small></article>
   <article><span>Explicit grants</span><b>{(data.access||[]).length}</b><small>Assigned channel access</small></article>
   <article><span>Customers</span><b>{(data.customers||[]).length}</b><small>Available for assignment</small></article>
  </div>

  <section className="panel">
   <div className="panelTitle"><div><p className="eyebrow">CHANNEL DEFINITIONS</p><h2>Authoritative channels</h2><p className="muted">Read-only mirror from License Manager. No channel policy is authored in Billing Store.</p></div></div>
   <div className="workspaceGrid">
    {visible.map((c:any)=><article className="workspaceBlock" key={c.id}>
      <div className="sectionHead"><div><h2>{c.label}</h2><p className="muted">{c.description||"No description."}</p></div><span className="state ready">Enabled</span></div>
      <div className="serviceSummary">
       <div><span>Channel</span><b>{c.channel}</b></div>
       <div><span>Access</span><b>{c.access_mode==="open"?"Open":"Assigned"}</b></div>
       <div><span>Requests</span><b>{c.access_request_enabled?"Allowed":"Off"}</b></div>
      </div>
      <small className="muted">{c.self_join_enabled||c.access_mode==="open"?"Customer self-join is available.":"Access is granted by an administrator or approved request."}</small>
    </article>)}
    {!visible.length&&<div className="emptyState"><b>No customer-visible channels</b><p className="muted">Sync from License Manager to refresh channel definitions.</p></div>}
   </div>
  </section>

  <section className="panel">
   <div className="panelTitle"><div><p className="eyebrow">ACCESS REQUESTS</p><h2>Pending customer requests</h2><p className="muted">Approvals and rejections are sent back to License Manager immediately.</p></div><span className="badge">{(data.requests||[]).length}</span></div>
   <div className="orderControlList">
    {(data.requests||[]).map((r:any)=><div key={r.id}>
      <div><b>{r.channel}</b><span>{r.external_reference||r.license_id} · requested {r.requested_at?new Date(r.requested_at).toLocaleString():"—"}</span></div>
      <div className="inlineActions"><button disabled={!!busy} onClick={()=>void mutate({action:"request",licenseId:r.license_id,channel:r.channel,userId:r.external_reference})}>Approve</button><button className="secondary" disabled={!!busy} onClick={()=>void mutate({action:"reject",licenseId:r.license_id,channel:r.channel})}>Reject</button></div>
    </div>)}
    {!(data.requests||[]).length&&<div><div><b>No pending requests</b><span>There are no customer channel requests waiting for review.</span></div><span className="state ready">Clear</span></div>}
   </div>
  </section>

  <section className="panel">
   <div className="panelTitle"><div><p className="eyebrow">CUSTOMER ACCESS</p><h2>Channel assignments</h2><p className="muted">Stable remains the baseline. Additional channels are additive and do not replace Stable.</p></div></div>
   {visible.map((c:any)=><div className="workspaceBlock" key={c.id} style={{marginTop:12}}>
     <div className="sectionHead">
      <div><h2>{c.label}</h2><p className="muted">{c.channel}{c.channel==="stable"?" · baseline":c.access_mode==="open"?" · open access":" · assigned access"}</p></div>
      {c.channel!=="stable"&&c.access_mode!=="open"&&<select className="input" style={{maxWidth:360}} defaultValue="" onChange={e=>{const userId=e.target.value;if(userId)void mutate({action:"grant",channel:c.channel,userId})}}><option value="">Grant access to customer…</option>{(data.customers||[]).map((u:any)=><option key={u.id} value={u.id}>{u.display_name||u.email||u.id}{u.company_name?" · "+u.company_name:""}</option>)}</select>}
     </div>
     {c.channel==="stable"?<p className="muted">Every active customer receives Stable automatically.</p>:c.access_mode==="open"?<p className="muted">All active customers are eligible automatically.</p>:<div className="orderControlList">{(data.access||[]).filter((a:any)=>a.channel_id===c.id).map((a:any)=><div key={a.id}><div><b>{customers.get(a.user_id)?.display_name||customers.get(a.user_id)?.email||a.user_id}</b><span>{a.license_id||"License assignment"}</span></div><button className="secondary" disabled={!!busy} onClick={()=>void mutate({action:"revoke",licenseId:a.license_id,channel:a.channel,userId:a.user_id})}>Revoke</button></div>)}{!(data.access||[]).some((a:any)=>a.channel_id===c.id)&&<div><div><b>No explicit assignments</b><span>No customers currently have this channel assigned.</span></div><span className="state">None</span></div>}</div>}
   </div>)}
  </section>
 </main>
}