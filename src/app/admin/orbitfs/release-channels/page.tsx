"use client";

import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

type Channel={id:string;channel:string;label:string;description?:string;enabled:boolean;customer_visible:boolean;access_mode:string;access_request_enabled:boolean;self_join_enabled:boolean};
type Customer={id:string;display_name?:string;company_name?:string;email?:string;customer_number?:string};
type Access={id?:string;channel_id?:string;channel?:string;license_id?:string;user_id?:string};

export default function ReleaseChannelsAdmin(){
 const sb=useMemo(()=>createClient(),[]);
 const [data,setData]=useState<any>({channels:[],access:[],customers:[],requests:[]});
 const [selected,setSelected]=useState("");
 const [query,setQuery]=useState("");
 const [busy,setBusy]=useState("");
 const [message,setMessage]=useState("");

 async function auth(){const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)throw Error("Administrator session expired. Sign in again.");return {Authorization:"Bearer "+session.access_token};}
 async function load(){
  setBusy("load");setMessage("");
  try{
   const r=await fetch("/api/admin/orbitfs/release-channels",{headers:await auth(),cache:"no-store"});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not load release channels");
   setData(j);
   const visible=(j.channels||[]).filter((c:Channel)=>c.enabled&&c.customer_visible);
   setSelected(current=>visible.some((c:Channel)=>c.channel===current)?current:(visible.find((c:Channel)=>c.channel!=="stable")?.channel||visible[0]?.channel||""));
  }catch(e:any){setMessage(e?.message||"Could not load release channels")}finally{setBusy("")}
 }
 useEffect(()=>{void load()},[]);

 async function mutate(body:any,success:string){
  setBusy(String(body.action||"save"));setMessage("");
  try{
   const r=await fetch("/api/admin/orbitfs/release-channels",{method:"POST",headers:{...(await auth()),"content-type":"application/json"},body:JSON.stringify(body)});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Channel access operation failed");
   setMessage(success);await load();
  }catch(e:any){setMessage(e?.message||"Channel access operation failed")}finally{setBusy("")}
 }

 const channels:Channel[]=(data.channels||[]).filter((c:Channel)=>c.enabled&&c.customer_visible);
 const channel=channels.find(c=>c.channel===selected)||channels[0]||null;
 const customers:Customer[]=(data.customers||[]).filter((u:Customer)=>{
  const q=query.trim().toLowerCase();if(!q)return true;
  return [u.display_name,u.company_name,u.email,u.customer_number].some(v=>String(v||"").toLowerCase().includes(q));
 });
 const accessFor=(userId:string)=>((data.access||[]) as Access[]).find(a=>a.channel===channel?.channel&&a.user_id===userId);

 return <main className="orbitAdminPage">
  <header className="orbitAdminHeader">
   <div><p className="eyebrow">ORBITFS CONTROL · RELEASE CHANNELS</p><h1>Release channel access</h1><p className="muted">Manage customer access from Billing Store while License Manager remains the source of truth for the grant itself.</p></div>
   <div className="orbitAdminActions"><button className="orbitAction orbitActionSecondary" onClick={()=>void mutate({action:"sync"},"Channel definitions synced from License Manager.")} disabled={!!busy}>{busy==="sync"?"Syncing…":"Sync"}</button><button className="orbitAction orbitActionQuiet" onClick={()=>void load()} disabled={busy==="load"}>{busy==="load"?"Refreshing…":"Refresh"}</button></div>
  </header>

  {message&&<div className="orbitInlineNotice">{message}</div>}

  <div className="orbitChannelLayout">
   <aside className="orbitChannelRail">
    <div className="orbitRailHead"><p className="eyebrow">CHANNELS</p><b>{channels.length} available</b></div>
    {channels.map(c=><button key={c.id} className={"orbitChannelButton "+(channel?.channel===c.channel?"active":"")} onClick={()=>setSelected(c.channel)}>
      <div><b>{c.label}</b><span>{c.channel}</span></div>
      <small>{c.channel==="stable"?"Baseline":c.access_mode==="open"?"Open":c.self_join_enabled?"Self-join":c.access_request_enabled?"Request":"Assigned"}</small>
    </button>)}
   </aside>

   <section className="orbitCompactPanel orbitChannelBody">
    {channel?<><div className="orbitPanelHead">
     <div><p className="eyebrow">CUSTOMER ACCESS</p><h2>{channel.label}</h2><p className="muted">{channel.description||"No description."}</p></div>
     <div className="orbitBadgeGroup"><span className="state ready">{channel.channel}</span><span className="state">{channel.access_mode==="open"?"Open access":"Assigned access"}</span></div>
    </div>

    <div className="orbitPolicyStrip">
     <div><span>Customer visible</span><b>{channel.customer_visible?"Yes":"No"}</b></div>
     <div><span>Self-join</span><b>{channel.self_join_enabled||channel.access_mode==="open"?"Allowed":"Off"}</b></div>
     <div><span>Requests</span><b>{channel.access_request_enabled?"Allowed":"Off"}</b></div>
     <div><span>Authority</span><b>License Manager</b></div>
    </div>

    {channel.channel==="stable"||channel.access_mode==="open"?<div className="orbitEmptyCompact">{channel.channel==="stable"?"Stable is automatically available to every active customer.":"This channel is open; explicit customer grants are not required."}</div>:<>
     <div className="orbitToolbar"><input placeholder="Search customers…" value={query} onChange={e=>setQuery(e.target.value)}/><span>{customers.length} customers</span></div>
     <div className="orbitAccessTable">
      {customers.map(u=>{const grant=accessFor(u.id);return <div className="orbitAccessRow" key={u.id}>
       <div><b>{u.display_name||u.email||u.id}</b><span>{u.company_name||u.email||u.customer_number||"Customer"}</span></div>
       <span className={grant?"state ready":"state"}>{grant?"Granted":"No access"}</span>
       {grant?<button className="orbitAction orbitActionDanger" disabled={!!busy} onClick={()=>void mutate({action:"revoke",licenseId:grant.license_id,channel:channel.channel,userId:u.id},"Customer access revoked.")}>Revoke</button>:<button className="orbitAction orbitActionPrimary" disabled={!!busy} onClick={()=>void mutate({action:"grant",channel:channel.channel,userId:u.id},"Customer access granted.")}>Grant access</button>}
      </div>})}
      {!customers.length&&<div className="orbitEmptyCompact">No customers match this search.</div>}
     </div>
    </>}
    </>:<div className="orbitEmptyCompact">No customer-visible release channels are available.</div>}
   </section>
  </div>

  <section className="orbitCompactPanel">
   <div className="orbitPanelHead"><div><p className="eyebrow">ACCESS REQUESTS</p><h2>Pending requests</h2></div><span className="orbitCount">{(data.requests||[]).length}</span></div>
   <div className="orbitRequestTable">
    {(data.requests||[]).map((r:any)=><div className="orbitRequestRow" key={r.id||r.license_id+":"+r.channel}>
     <div><b>{r.channel}</b><span>{r.external_reference||r.license_id}</span></div>
     <span>{r.requested_at?new Date(r.requested_at).toLocaleString():"Pending"}</span>
     <div className="orbitRowActions"><button className="orbitAction orbitActionPrimary" disabled={!!busy} onClick={()=>void mutate({action:"approve",licenseId:r.license_id,channel:r.channel,userId:r.external_reference},"Channel request approved.")}>Approve</button><button className="orbitAction orbitActionDanger" disabled={!!busy} onClick={()=>void mutate({action:"reject",licenseId:r.license_id,channel:r.channel},"Channel request rejected.")}>Reject</button></div>
    </div>)}
    {!(data.requests||[]).length&&<div className="orbitEmptyCompact">No release channel requests are waiting for review.</div>}
   </div>
  </section>
 </main>
}
