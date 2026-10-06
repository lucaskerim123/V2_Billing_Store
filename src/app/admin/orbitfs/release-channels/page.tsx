"use client";

import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import V6ConfirmDialog from "@/components/V6ConfirmDialog";

type Channel={
 id:string;
 channel:string;
 label:string;
 description?:string;
 enabled:boolean;
 customer_visible:boolean;
 access_mode:string;
 access_request_enabled:boolean;
 self_join_enabled:boolean;
 sort_order?:number;
};
type Customer={id:string;display_name?:string;company_name?:string;email?:string;customer_number?:string;customer_name?:string;status?:string};
type Access={id?:string;channel_id?:string;channel?:string;license_id?:string;user_id?:string;external_reference?:string};
type ChannelUsage={base?:{total?:number;published?:number};update?:{total?:number;published?:number}};

const customerName=(u:Customer)=>u.customer_name||u.display_name||u.company_name||u.email||u.customer_number||"Customer";
const channelPolicy=(c:Channel)=>c.channel==="stable"?"Included":c.access_mode==="open"?"Open":c.self_join_enabled?"Self-join":c.access_request_enabled?"Approval":"Assigned";
const usageLabel=(usage:ChannelUsage)=>{
 const base=Number(usage?.base?.total||0),update=Number(usage?.update?.total||0);
 return base&&update?"Base + Update":base?"Base":update?"Update":"No releases";
};

export default function ReleaseChannelsAdmin(){
 const sb=useMemo(()=>createClient(),[]);
 const [data,setData]=useState<any>({channels:[],access:[],customers:[],requests:[],releaseUsage:{}});
 const [selected,setSelected]=useState("");
 const [query,setQuery]=useState("");
 const [creating,setCreating]=useState(false);
 const [newChannel,setNewChannel]=useState({channel:"",label:"",description:"",access_mode:"closed"});
 const [confirmAction,setConfirmAction]=useState<null|{title:string;description:string;confirmLabel:string;danger?:boolean;body:any;success:string}>(null);
 const [busy,setBusy]=useState("");
 const [message,setMessage]=useState("");
 const [error,setError]=useState("");
 const [policy,setPolicy]=useState({label:"",description:"",enabled:true,customer_visible:true,access_mode:"closed",access_request_enabled:false,self_join_enabled:false,sort_order:100});

 async function auth(){
  const {data:{session}}=await sb.auth.getSession();
  if(!session?.access_token)throw Error("Administrator session expired. Sign in again.");
  return {Authorization:"Bearer "+session.access_token};
 }

 async function load(options?:{preserveFeedback?:boolean}){
  setBusy("load");
  if(!options?.preserveFeedback){setMessage("");setError("")}
  try{
   const r=await fetch("/api/admin/orbitfs/release-channels",{headers:await auth(),cache:"no-store"});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not load release channels");
   setData(j);
   const all=(j.channels||[]) as Channel[];
   setSelected(current=>all.some((c:Channel)=>c.channel===current)?current:(all.find((c:Channel)=>c.channel==="stable")?.channel||all[0]?.channel||""));
  }catch(e:any){setError(e?.message||"Could not load release channels")}
  finally{setBusy("")}
 }

 useEffect(()=>{void load()},[]);

 async function mutate(body:any,success:string){
  const action=String(body.action||"save");
  setBusy(action);setMessage("");setError("");
  try{
   const r=await fetch("/api/admin/orbitfs/release-channels",{
    method:"POST",
    headers:{...(await auth()),"content-type":"application/json"},
    body:JSON.stringify(body)
   });
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Channel access operation failed");
   setMessage(success);
   await load({preserveFeedback:true});
  }catch(e:any){setError(e?.message||"Channel access operation failed")}
  finally{setBusy("")}
 }

 const channels:Channel[]=(data.channels||[]);
 const channel=creating?null:(channels.find(c=>c.channel===selected)||channels[0]||null);
 const usage:ChannelUsage=channel?(data.releaseUsage?.[channel.channel]||{}):{};
 const channelAccess=((data.access||[]) as Access[]).filter(a=>String(a.channel||"")===String(channel?.channel||""));
 const channelRequests=channel?(data.requests||[]).filter((r:any)=>String(r.channel||"")===String(channel.channel)):[];
 const releaseCount=Number(usage?.base?.total||0)+Number(usage?.update?.total||0);
 const publishedCount=Number(usage?.base?.published||0)+Number(usage?.update?.published||0);

 useEffect(()=>{
  if(!channel)return;
  setPolicy({
   label:channel.label||channel.channel,
   description:channel.description||"",
   enabled:channel.enabled!==false,
   customer_visible:channel.customer_visible!==false,
   access_mode:channel.access_mode==="open"?"open":"closed",
   access_request_enabled:channel.access_request_enabled===true,
   self_join_enabled:channel.self_join_enabled===true,
   sort_order:Number(channel.sort_order||100)
  });
 },[channel?.channel,channel?.label,channel?.description,channel?.enabled,channel?.customer_visible,channel?.access_mode,channel?.access_request_enabled,channel?.self_join_enabled,channel?.sort_order]);

 const customers:Customer[]=(data.customers||[]).filter((u:Customer)=>{
  const q=query.trim().toLowerCase();
  if(!q)return true;
  return [u.customer_name,u.display_name,u.company_name,u.email,u.customer_number].some(v=>String(v||"").toLowerCase().includes(q));
 });
 const accessFor=(userId:string)=>channelAccess.find(a=>String(a.user_id||"")===String(userId));
 const assignedCustomers=channel?(data.customers||[]).filter((u:Customer)=>Boolean(accessFor(u.id))):[];
 const assignableCustomers=channel?customers.filter(u=>!accessFor(u.id)):[];
 const requestCustomer=(r:any)=>(data.customers||[]).find((u:Customer)=>String(u.id)===String(r.user_id||r.external_reference||""));
 const normalizedNewChannel=String(newChannel.channel||"").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,32);
 const newChannelValid=/^[a-z0-9][a-z0-9_-]{0,31}$/.test(normalizedNewChannel)&&Boolean(newChannel.label.trim())&&!channels.some(c=>c.channel===normalizedNewChannel);
 async function createChannel(){
  if(!newChannelValid)return;
  const key=normalizedNewChannel;
  setSelected(key);
  setCreating(false);
  await mutate({
   action:"save",
   channel:key,
   label:newChannel.label.trim(),
   description:newChannel.description.trim(),
   enabled:true,
   customer_visible:true,
   access_mode:newChannel.access_mode==="open"?"open":"closed",
   access_request_enabled:false,
   self_join_enabled:false,
   sort_order:Math.max(100,...channels.map(c=>Number(c.sort_order||0)))+10
  },"Release channel created in License Manager.");
  setNewChannel({channel:"",label:"",description:"",access_mode:"closed"});
 }

 return <main className="orbitAdminPage orbitReferencePage orbitReleaseChannelsReference orbitPhaseOne">
  <header className="orbitReferenceHero orbitPhaseHero">
   <div>
    <p className="eyebrow">MY ORBITFS · RELEASE CHANNELS</p>
    <h1>Release Channels</h1>
    <p className="muted">One shared channel authority for Base and Update releases. Channel policy is saved directly to License Manager; Billing controls the customer-facing assignment workflow.</p>
   </div>
   <div className="orbitReferenceHeroActions">
    <button className="secondary" type="button" onClick={()=>void load()} disabled={busy==="load"}>{busy==="load"?"Refreshing…":"Refresh"}</button>
    <button type="button" onClick={()=>void mutate({action:"sync"},"Channel definitions refreshed from License Manager.")} disabled={!!busy}>Refresh authority</button>
   </div>
  </header>

  {error&&<div className="orbitReferenceNotice danger" role="alert"><b>Could not complete action</b><span>{error}</span></div>}
  {message&&<div className="orbitReferenceNotice" role="status">{message}</div>}

  <div className="orbitReferenceSplit orbitChannelWorkspace">
   <aside className="orbitReferenceRail">
    <div className="orbitReferenceRailHead">
     <div><b>Channels</b><span>{channels.length} defined</span></div>
     <small>Base and Update release dropdowns use this same list.</small>
     <button className="secondary" type="button" onClick={()=>{setCreating(true);setSelected("")}}>+ New channel</button>
    </div>
    <div className="orbitReferenceRailList">
     {channels.map(c=>{
      const count=((data.access||[]) as Access[]).filter(a=>a.channel===c.channel).length;
      const itemUsage:ChannelUsage=data.releaseUsage?.[c.channel]||{};
      return <button key={c.id||c.channel} type="button" className={"orbitReferenceRailCard "+(channel?.channel===c.channel?"active":"")} onClick={()=>{setCreating(false);setSelected(c.channel)}}>
       <div className="orbitReferenceRailCardTop"><b>{c.label||c.channel}</b><span className={"orbitMiniState "+(c.enabled?"live":"")}>{c.enabled?"Enabled":"Disabled"}</span></div>
       <small className="orbitChannelSlug">{c.channel}</small>
       <div className="orbitReferenceRailMeta">
        <span>{channelPolicy(c)}</span>
        <span>{usageLabel(itemUsage)}</span>
        <span>{c.channel==="stable"||c.access_mode==="open"?"Automatic":count+" assigned"}</span>
       </div>
      </button>
     })}
     {!channels.length&&<div className="orbitReferenceEmpty">No release channels are currently defined.</div>}
    </div>
   </aside>

   <section className="orbitReferenceWorkspace">
    {creating?<section className="orbitChannelCreate">
     <div className="orbitReferenceWorkspaceHead">
      <div><div className="orbitReferenceTitleLine"><h2>Create release channel</h2><span className="orbitMiniState">Shared</span></div><p>Create one authoritative channel for both Base and Update releases. Customer access can be assigned after creation.</p></div>
      <button className="secondary" type="button" onClick={()=>setCreating(false)}>Cancel</button>
     </div>
     <div className="orbitChannelPolicyGrid">
      <label><span>Channel key</span><input value={newChannel.channel} onChange={e=>setNewChannel(v=>({...v,channel:e.target.value}))} placeholder="customer-acme"/><small>Lowercase letters, numbers, underscore or hyphen. Max 32 characters.</small></label>
      <label><span>Access mode</span><select value={newChannel.access_mode} onChange={e=>setNewChannel(v=>({...v,access_mode:e.target.value}))}><option value="closed">Closed / assigned</option><option value="open">Open</option></select></label>
      <label className="wide"><span>Label</span><input value={newChannel.label} onChange={e=>setNewChannel(v=>({...v,label:e.target.value}))} placeholder="Customer Acme"/></label>
      <label className="wide"><span>Description</span><textarea rows={3} value={newChannel.description} onChange={e=>setNewChannel(v=>({...v,description:e.target.value}))} placeholder="What this channel is for and who should receive it."/></label>
     </div>
     {normalizedNewChannel&&channels.some(c=>c.channel===normalizedNewChannel)&&<div className="orbitReferenceNotice danger"><span>A channel with key <code>{normalizedNewChannel}</code> already exists.</span></div>}
     <div className="orbitReferenceActions orbitPolicyActions"><button type="button" disabled={!newChannelValid||!!busy} onClick={()=>void createChannel()}>{busy==="save"?"Creating…":"Create channel"}</button></div>
    </section>:channel?<>
     <div className="orbitReferenceWorkspaceHead">
      <div>
       <div className="orbitReferenceTitleLine"><h2>{channel.label||channel.channel}</h2><span className={"orbitMiniState "+(channel.enabled?"live":"")}>{channelPolicy(channel)}</span></div>
       <p>{channel.description||"Customer release channel managed by License Manager."}</p>
       <small className="orbitChannelAuthority">Authority: License Manager · key <code>{channel.channel}</code></small>
      </div>
      <div className="orbitReferenceActions">
       <button className="secondary" type="button" onClick={()=>void load()} disabled={busy==="load"}>{busy==="load"?"Refreshing…":"Refresh access"}</button>
      </div>
     </div>

     <div className="orbitReferenceFacts orbitChannelFacts">
      <div><span>Channel state</span><b>{channel.enabled?"Enabled":"Disabled"}</b><small>{channel.customer_visible?"Customer visible":"Internal only"}</small></div>
      <div><span>Customer access</span><b>{channelPolicy(channel)}</b><small>{channel.channel==="stable"||channel.access_mode==="open"?"No explicit grant required":channelAccess.length+" explicit grants"}</small></div>
      <div><span>Base releases</span><b>{Number(usage?.base?.published||0)} published</b><small>{Number(usage?.base?.total||0)} total in channel</small></div>
      <div><span>Update releases</span><b>{Number(usage?.update?.published||0)} published</b><small>{Number(usage?.update?.total||0)} total in channel</small></div>
      <div><span>Combined usage</span><b>{publishedCount} published</b><small>{releaseCount} Base + Update records</small></div>
      <div><span>Pending requests</span><b>{channelRequests.length}</b><small>{channelRequests.length?"Require review":"No requests waiting"}</small></div>
     </div>

     <section className="orbitReferenceSection orbitChannelPolicyEditor">
      <div className="orbitReferenceSectionHead">
       <div><b>Channel policy</b><small>Changes here update the authoritative License Manager definition immediately.</small></div>
       <span>{channel.channel}</span>
      </div>
      <div className="orbitChannelPolicyGrid">
       <label><span>Label</span><input value={policy.label} onChange={e=>setPolicy({...policy,label:e.target.value})}/></label>
       <label><span>Sort order</span><input type="number" min="0" value={policy.sort_order} onChange={e=>setPolicy({...policy,sort_order:Number(e.target.value||0)})}/></label>
       <label className="wide"><span>Description</span><textarea rows={3} value={policy.description} onChange={e=>setPolicy({...policy,description:e.target.value})}/></label>
       <label><span>Access mode</span><select value={policy.access_mode} onChange={e=>setPolicy({...policy,access_mode:e.target.value})}><option value="open">Open</option><option value="closed">Closed</option></select></label>
       <div className="orbitChannelToggleGrid">
        <label className="orbitChannelToggle"><input type="checkbox" checked={policy.enabled} onChange={e=>setPolicy({...policy,enabled:e.target.checked})}/><span><b>Channel enabled</b><small>Allows release use and access checks.</small></span></label>
        <label className="orbitChannelToggle"><input type="checkbox" checked={policy.customer_visible} onChange={e=>setPolicy({...policy,customer_visible:e.target.checked})}/><span><b>Customer visible</b><small>Allows customer-facing publication and discovery.</small></span></label>
        <label className="orbitChannelToggle"><input type="checkbox" checked={policy.self_join_enabled} disabled={policy.access_mode==="open"} onChange={e=>setPolicy({...policy,self_join_enabled:e.target.checked})}/><span><b>Allow self-join</b><small>Closed channel customers may join without review.</small></span></label>
        <label className="orbitChannelToggle"><input type="checkbox" checked={policy.access_request_enabled} disabled={policy.access_mode==="open"||policy.self_join_enabled} onChange={e=>setPolicy({...policy,access_request_enabled:e.target.checked})}/><span><b>Allow access requests</b><small>Customers can request staff approval.</small></span></label>
       </div>
      </div>
      <div className="orbitReferenceActions orbitPolicyActions">
       <button disabled={!!busy||!policy.label.trim()} onClick={()=>void mutate({
        action:"save",
        channel:channel.channel,
        ...policy,
        access_request_enabled:policy.access_mode==="open"||policy.self_join_enabled?false:policy.access_request_enabled,
        self_join_enabled:policy.access_mode==="open"?false:policy.self_join_enabled
       },"Channel policy saved to License Manager.")}>{busy==="save"?"Saving…":"Save channel policy"}</button>
      </div>
     </section>

     <section className="orbitReferenceSection">
      <div className="orbitReferenceSectionHead">
       <div><b>Assigned customers</b><small>Explicit grants are enforced by License Manager against the customer's Base licence.</small></div>
       <span>{channel.channel==="stable"||channel.access_mode==="open"?"automatic":assignedCustomers.length+" assigned"}</span>
      </div>
      {channel.channel==="stable"||channel.access_mode==="open"
       ?<div className="orbitReferenceEmpty compact">{channel.channel==="stable"?"Stable is included for every eligible active customer.":"This channel is open; explicit customer grants are not required."}</div>
       :assignedCustomers.length
        ?<div className="orbitReferenceTable">
          <div className="orbitReferenceTableHead"><span>Customer</span><span>Status</span><span>Base licence</span><span>Action</span></div>
          {assignedCustomers.map((u:Customer)=>{const grant=accessFor(u.id)!;return <div className="orbitReferenceTableRow" key={u.id}>
           <div><b>{customerName(u)}</b><small>{u.email||u.customer_number||u.id}</small></div>
           <span className="orbitMiniState live">Granted</span>
           <span className="orbitMono">{grant.license_id||"Linked Base licence"}</span>
           <button className="danger" disabled={!!busy||!grant.license_id} onClick={()=>setConfirmAction({title:"Revoke release-channel access?",description:"Remove "+customerName(u)+" from "+(channel.label||channel.channel)+". Future Base and Update release discovery through this restricted channel will stop for this licence.",confirmLabel:"Revoke access",danger:true,body:{action:"revoke",licenseId:grant.license_id,channel:channel.channel,userId:u.id},success:"Customer access revoked."})}>Revoke</button>
          </div>})}
         </div>
        :<div className="orbitReferenceEmpty compact">No customers are explicitly assigned to this channel.</div>}
     </section>

     {channel.channel!=="stable"&&channel.access_mode!=="open"&&<section className="orbitReferenceSection">
      <div className="orbitReferenceSectionHead">
       <div><b>Grant customer access</b><small>Only customers with a linked authoritative OrbitFS Base licence can receive a closed-channel grant.</small></div>
       <span>{assignableCustomers.length} available</span>
      </div>
      <div className="orbitReferenceSearch"><input placeholder="Search customer, email or customer number…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
      <div className="orbitReferenceGrantList">
       {assignableCustomers.slice(0,40).map((u:Customer)=><div className="orbitReferenceGrantRow" key={u.id}><div><b>{customerName(u)}</b><small>{u.email||u.customer_number||u.id}</small></div><button disabled={!!busy} onClick={()=>setConfirmAction({title:"Grant release-channel access?",description:"Grant "+customerName(u)+" access to "+(channel.label||channel.channel)+". The authoritative grant will be written to License Manager and will apply to shared Base + Update discovery.",confirmLabel:"Grant access",body:{action:"grant",channel:channel.channel,userId:u.id},success:"Customer access granted."})}>Grant access</button></div>)}
       {!assignableCustomers.length&&<div className="orbitReferenceEmpty compact">No customers match this search, or every matching customer already has access.</div>}
      </div>
     </section>}

     <section className="orbitReferenceSection">
      <div className="orbitReferenceSectionHead"><div><b>Pending access requests</b><small>Requests remain non-authoritative until approved and granted by License Manager.</small></div><span>{channelRequests.length} pending</span></div>
      {channelRequests.length?<div className="orbitReferenceTable requests">
       <div className="orbitReferenceTableHead"><span>Customer / use case</span><span>Requested</span><span>Environment</span><span>Decision</span></div>
       {channelRequests.map((r:any)=>{
        const u=requestCustomer(r),details=r.request_details&&typeof r.request_details==="object"?r.request_details:{};
        return <div className="orbitReferenceTableRow" key={r.id||r.license_id+":"+r.channel}>
         <div><b>{u?customerName(u):r.external_reference||"Customer"}</b><small>{u?.email||r.license_id||""}</small>{details.use_case&&<small className="orbitRequestDetail">{details.use_case}</small>}{details.notes&&<small className="orbitRequestNote">{details.notes}</small>}</div>
         <span>{r.requested_at?new Date(r.requested_at).toLocaleDateString():"Pending"}</span>
         <span>{details.environment||"Not supplied"}</span>
         <div className="orbitReferenceDecision"><button disabled={!!busy} onClick={()=>setConfirmAction({title:"Approve channel request?",description:"Approve this customer request for "+(channel.label||channel.channel)+". License Manager will create the authoritative restricted-channel grant.",confirmLabel:"Approve request",body:{action:"approve",licenseId:r.license_id,channel:r.channel,customerReference:r.external_reference,userId:r.user_id},success:"Channel request approved."})}>Approve</button><button className="danger" disabled={!!busy} onClick={()=>setConfirmAction({title:"Reject channel request?",description:"Reject this customer request for "+(channel.label||channel.channel)+". No release-channel grant will be created.",confirmLabel:"Reject request",danger:true,body:{action:"reject",licenseId:r.license_id,channel:r.channel,customerReference:r.external_reference,userId:r.user_id},success:"Channel request rejected."})}>Reject</button></div>
        </div>
       })}
      </div>:<div className="orbitReferenceEmpty compact">No requests are waiting for review on this channel.</div>}
     </section>
    </>:<div className="orbitReferenceEmpty">Select a release channel to inspect its policy, release usage and customer access.</div>}
   </section>
  </div>
  <V6ConfirmDialog
   open={Boolean(confirmAction)}
   title={confirmAction?.title||""}
   description={confirmAction?.description||""}
   confirmLabel={confirmAction?.confirmLabel||"Confirm"}
   danger={confirmAction?.danger===true}
   busy={Boolean(busy)}
   onCancel={()=>setConfirmAction(null)}
   onConfirm={()=>{
    if(!confirmAction)return;
    const pending=confirmAction;
    setConfirmAction(null);
    void mutate(pending.body,pending.success);
   }}
  />
 </main>
}
