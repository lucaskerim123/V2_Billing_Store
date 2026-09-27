"use client";

import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

type Channel={id:string;channel:string;label:string;description?:string;enabled:boolean;customer_visible:boolean;access_mode:string;access_request_enabled:boolean;self_join_enabled:boolean};
type Customer={id:string;display_name?:string;company_name?:string;email?:string;customer_number?:string;customer_name?:string;status?:string};
type Access={id?:string;channel_id?:string;channel?:string;license_id?:string;user_id?:string};

const customerName=(u:Customer)=>u.customer_name||u.display_name||u.company_name||u.email||u.customer_number||"Customer";
const channelPolicy=(c:Channel)=>c.channel==="stable"?"Live":c.access_mode==="open"?"Open":c.self_join_enabled?"Self-join":c.access_request_enabled?"Request":"Assigned";

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
   setSelected(current=>visible.some((c:Channel)=>c.channel===current)?current:(visible[0]?.channel||""));
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
  return [u.customer_name,u.display_name,u.company_name,u.email,u.customer_number].some(v=>String(v||"").toLowerCase().includes(q));
 });
 const accessFor=(userId:string)=>((data.access||[]) as Access[]).find(a=>a.channel===channel?.channel&&a.user_id===userId);
 const assignedCustomers=channel?(data.customers||[]).filter((u:Customer)=>Boolean(accessFor(u.id))):[];
 const assignableCustomers=channel?customers.filter(u=>!accessFor(u.id)):[];
 const channelRequests=channel?(data.requests||[]).filter((r:any)=>String(r.channel||"")===String(channel.channel)):[];
 const requestCustomer=(r:any)=>(data.customers||[]).find((u:Customer)=>String(u.id)===String(r.external_reference||""));

 return <main className="orbitAdminPage orbitReferencePage orbitReleaseChannelsReference">
  <header className="orbitReferenceHero">
   <div>
    <p className="eyebrow">MY ORBITFS · RELEASE CHANNELS</p>
    <h1>Release Channels</h1>
    <p className="muted">Control customer release visibility and access while License Manager remains the authoritative source for channel policy.</p>
   </div>
   <div className="orbitReferenceHeroActions">
    <button className="orbitIconAction" title="Refresh this view" aria-label="Refresh this view" onClick={()=>void load()} disabled={busy==="load"}>↻</button>
    <button className="orbitIconAction primary" title="Refresh channel authority" aria-label="Refresh channel authority" onClick={()=>void mutate({action:"sync"},"Channel definitions refreshed from License Manager.")} disabled={!!busy}>⟳</button>
   </div>
  </header>

  {message&&<div className="orbitReferenceNotice" role="status">{message}</div>}

  <div className="orbitReferenceSplit">
   <aside className="orbitReferenceRail">
    <div className="orbitReferenceRailHead">
     <b>Channels</b>
     <span>Select a release path to inspect access and publishing controls.</span>
    </div>
    <div className="orbitReferenceRailList">
     {channels.map(c=>{
      const count=((data.access||[]) as Access[]).filter(a=>a.channel===c.channel).length;
      return <button key={c.id} type="button" className={"orbitReferenceRailCard "+(channel?.channel===c.channel?"active":"")} onClick={()=>setSelected(c.channel)}>
       <div className="orbitReferenceRailCardTop"><b>{c.label}</b><span className={"orbitMiniState "+(c.channel==="stable"?"live":"")}>{channelPolicy(c)}</span></div>
       <small>{c.description||c.channel}</small>
       <div className="orbitReferenceRailMeta"><span>{c.customer_visible?"Visible":"Hidden"}</span><span>{c.channel==="stable"||c.access_mode==="open"?"Automatic":count+" assigned"}</span></div>
      </button>
     })}
     {!channels.length&&<div className="orbitReferenceEmpty">No customer-visible release channels are available.</div>}
    </div>
   </aside>

   <section className="orbitReferenceWorkspace">
    {channel?<>
     <div className="orbitReferenceWorkspaceHead">
      <div>
       <div className="orbitReferenceTitleLine"><h2>{channel.label}</h2><span className={"orbitMiniState "+(channel.channel==="stable"?"live":"")}>{channelPolicy(channel)}</span></div>
       <p>{channel.description||"Customer release channel managed by License Manager."}</p>
      </div>
      <div className="orbitReferenceActions">
       <button className="secondary" onClick={()=>void load()} disabled={busy==="load"}>{busy==="load"?"Refreshing…":"Refresh access"}</button>
      </div>
     </div>

     <div className="orbitReferenceFacts">
      <div><span>Visibility</span><b>{channel.customer_visible?"Visible":"Hidden"}</b></div>
      <div><span>Customer access</span><b>{channel.channel==="stable"||channel.access_mode==="open"?"Automatic":channel.self_join_enabled?"Self-join":channel.access_request_enabled?"Request / assigned":"Assigned customers"}</b></div>
      <div><span>Assigned customers</span><b>{channel.channel==="stable"||channel.access_mode==="open"?"Automatic":assignedCustomers.length+" customers"}</b></div>
      <div><span>Pending requests</span><b>{channelRequests.length}</b></div>
     </div>

     <section className="orbitReferenceSection">
      <div className="orbitReferenceSectionHead"><b>Assigned customers</b><span>{channel.channel==="stable"||channel.access_mode==="open"?"automatic":assignedCustomers.length+" assigned"}</span></div>
      {channel.channel==="stable"||channel.access_mode==="open"
       ?<div className="orbitReferenceEmpty compact">{channel.channel==="stable"?"Stable is available automatically to every eligible active customer.":"This channel is open; explicit customer grants are not required."}</div>
       :assignedCustomers.length
        ?<div className="orbitReferenceTable">
          <div className="orbitReferenceTableHead"><span>Customer</span><span>Access status</span><span>Licence</span><span>Action</span></div>
          {assignedCustomers.map((u:Customer)=>{const grant=accessFor(u.id)!;return <div className="orbitReferenceTableRow" key={u.id}>
           <div><b>{customerName(u)}</b><small>{u.email||u.customer_number||u.id}</small></div>
           <span className="orbitMiniState live">Active</span>
           <span className="orbitMono">{grant.license_id||"Linked Base licence"}</span>
           <button className="danger" disabled={!!busy} onClick={()=>void mutate({action:"revoke",licenseId:grant.license_id,channel:channel.channel,userId:u.id},"Customer access revoked.")}>Revoke</button>
          </div>})}
         </div>
        :<div className="orbitReferenceEmpty compact">No customers are explicitly assigned to this channel.</div>}
     </section>

     {channel.channel!=="stable"&&channel.access_mode!=="open"&&<section className="orbitReferenceSection">
      <div className="orbitReferenceSectionHead"><div><b>Grant customer access</b><small>Only customers with a linked OrbitFS Base licence can be granted channel access.</small></div><span>{assignableCustomers.length} available</span></div>
      <div className="orbitReferenceSearch"><input placeholder="Search customers…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
      <div className="orbitReferenceGrantList">
       {assignableCustomers.slice(0,40).map((u:Customer)=><div className="orbitReferenceGrantRow" key={u.id}><div><b>{customerName(u)}</b><small>{u.email||u.customer_number||u.id}</small></div><button disabled={!!busy} onClick={()=>void mutate({action:"grant",channel:channel.channel,userId:u.id},"Customer access granted.")}>Grant access</button></div>)}
       {!assignableCustomers.length&&<div className="orbitReferenceEmpty compact">No customers match this search, or every matching customer already has access.</div>}
      </div>
     </section>}

     <section className="orbitReferenceSection">
      <div className="orbitReferenceSectionHead"><b>Pending access requests</b><span>{channelRequests.length} pending</span></div>
      {channelRequests.length?<div className="orbitReferenceTable requests">
       <div className="orbitReferenceTableHead"><span>Customer / use case</span><span>Requested</span><span>Environment</span><span>Decision</span></div>
       {channelRequests.map((r:any)=>{const u=requestCustomer(r),details=r.request_details&&typeof r.request_details==="object"?r.request_details:{};return <div className="orbitReferenceTableRow" key={r.id||r.license_id+":"+r.channel}>
        <div><b>{u?customerName(u):r.external_reference||"Customer"}</b><small>{u?.email||r.license_id||""}</small>{details.use_case&&<small className="orbitRequestDetail">{details.use_case}</small>}{details.notes&&<small className="orbitRequestNote">{details.notes}</small>}</div>
        <span>{r.requested_at?new Date(r.requested_at).toLocaleDateString():"Pending"}</span>
        <span>{details.environment||"Not supplied"}</span>
        <div className="orbitReferenceDecision"><button disabled={!!busy} onClick={()=>void mutate({action:"approve",licenseId:r.license_id,channel:r.channel,userId:r.external_reference},"Channel request approved.")}>Approve</button><button className="danger" disabled={!!busy} onClick={()=>void mutate({action:"reject",licenseId:r.license_id,channel:r.channel},"Channel request rejected.")}>Reject</button></div>
       </div>})}
      </div>:<div className="orbitReferenceEmpty compact">No requests are waiting for review on this channel.</div>}
     </section>
    </>:<div className="orbitReferenceEmpty">Select a release channel to inspect its customer access.</div>}
   </section>
  </div>
 </main>
}