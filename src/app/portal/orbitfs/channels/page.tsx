"use client";

import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import V6ConfirmDialog from "@/components/V6ConfirmDialog";

type RequestDetails={use_case:string;environment:string;notes:string};
const emptyRequest:RequestDetails={use_case:"",environment:"test",notes:""};

function policyLabel(channel:any){
  if(channel?.channel==="stable")return "Included";
  if(channel?.access_mode==="open")return "Open";
  if(channel?.self_join_enabled===true)return "Self-join";
  if(channel?.access_request_enabled===true)return "Approval";
  return "Invite only";
}

export default function CustomerReleaseChannelsPage(){
 const sb=useMemo(()=>createClient(),[]);
 const [data,setData]=useState<any>({channels:[],requests:[],access:[]});
 const [orbitStatus,setOrbitStatus]=useState<any>(null);
 const [selected,setSelected]=useState("");
 const [busy,setBusy]=useState("");
 const [message,setMessage]=useState("");
 const [error,setError]=useState("");
 const [requestOpen,setRequestOpen]=useState(false);
 const [form,setForm]=useState<RequestDetails>(emptyRequest);
 const [loading,setLoading]=useState(true);
 const [leaveChannel,setLeaveChannel]=useState("");

 async function authHeaders():Promise<Record<string,string>>{
  const {data:{session}}=await sb.auth.getSession();
  if(!session?.access_token)throw new Error("Your session has expired. Sign in again.");
  return {Authorization:"Bearer "+session.access_token};
 }

 async function load(options?:{preserveFeedback?:boolean}){
  setLoading(true);
  if(!options?.preserveFeedback){setMessage("");setError("")}
  try{
   const headers=await authHeaders();
   const [channelResult,statusResult]=await Promise.all([
    fetch("/api/orbitfs/release-channels",{headers,cache:"no-store"}),
    fetch("/api/orbitfs/status?view=bootstrap",{headers,cache:"no-store"}).catch(()=>null)
   ]);
   const channels=await channelResult.json().catch(()=>({}));
   if(!channelResult.ok)throw Error(channels.error||"Could not load release channels.");
   setData(channels);
   const status=statusResult?await statusResult.json().catch(()=>({})):null;
   setOrbitStatus(statusResult?.ok?status:null);
   const rows=Array.isArray(channels.channels)?channels.channels:[];
   setSelected(current=>rows.some((row:any)=>String(row.channel)===current)?current:String(rows.find((row:any)=>row.channel==="stable")?.channel||rows[0]?.channel||""));
  }catch(e:any){setError(e?.message||"Could not load release channels.")}
  finally{setLoading(false)}
 }

 useEffect(()=>{void load()},[]);

 const channels=Array.isArray(data.channels)?data.channels:[];
 const requests=Array.isArray(data.requests)?data.requests:[];
 const access=Array.isArray(data.access)?data.access:[];
 const explicitAccess=new Set(access.map((row:any)=>String(row.channel||"").toLowerCase()));
 const selectedChannel=channels.find((row:any)=>String(row.channel)===selected)||channels[0]||null;
 const baseInstall=(Array.isArray(orbitStatus?.installations)?orbitStatus.installations:[]).find((row:any)=>String(row.component_key||"")==="orbitfs_base")||(Array.isArray(orbitStatus?.installations)?orbitStatus.installations[0]:null);
 const currentChannel=String(baseInstall?.release_channel||"stable");
 const hasActiveBase=Boolean((Array.isArray(orbitStatus?.bindings)?orbitStatus.bindings:[]).some((row:any)=>String(row.license_product_key||"")==="orbitfs_base"&&["active","locked"].includes(String(row.authoritative_status||row.status||"").toLowerCase())));
 const pendingCount=requests.filter((row:any)=>String(row.status||"").toLowerCase()==="pending").length;
 const availableCount=channels.filter((row:any)=>row.channel==="stable"||row.access_mode==="open"||explicitAccess.has(String(row.channel||"").toLowerCase())).length;

 function latestRequest(channel:string){
  return requests
   .filter((row:any)=>String(row.channel||"")===channel)
   .sort((a:any,b:any)=>String(b.requested_at||"").localeCompare(String(a.requested_at||"")))[0]||null;
 }

 async function act(action:"join"|"leave"|"request",channel:string){
  setBusy(action+":"+channel);setMessage("");setError("");
  try{
   const body:any={action,channel};
   if(action==="request")body.requestDetails=form;
   const response=await fetch("/api/orbitfs/release-channels",{
    method:"POST",
    headers:{...(await authHeaders()),"content-type":"application/json"},
    body:JSON.stringify(body)
   });
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(result.error||"Channel access action failed.");
   setMessage(action==="request"?"Access request submitted for review.":action==="join"?"Release-channel access added.":"Release-channel access removed.");
   setRequestOpen(false);setForm(emptyRequest);setLeaveChannel("");
   await load({preserveFeedback:true});
  }catch(e:any){setError(e?.message||"Channel access action failed.")}
  finally{setBusy("")}
 }

 if(loading&&!channels.length){
  return <main className="orbitCustomerChannels"><section className="orbitCustomerLoading"><span className="orbitCustomerSpinner" aria-hidden="true"/><div><b>Loading Release Channels</b><p>Checking your shared Base + Update access with License Manager.</p></div></section></main>;
 }

 if(error&&!channels.length){
  return <main className="orbitCustomerChannels"><section className="orbitCustomerEmpty"><b>Release Channels unavailable</b><p>{error}</p><button type="button" onClick={()=>void load()}>Retry</button></section></main>;
 }

 const channel=selectedChannel;
 const channelKey=String(channel?.channel||"");
 const request=channel?latestRequest(channelKey):null;
 const hasExplicit=explicitAccess.has(channelKey.toLowerCase());
 const isStable=channelKey==="stable";
 const isOpen=channel?.access_mode==="open";
 const canSelfJoin=!isOpen&&!isStable&&channel?.self_join_enabled===true;
 const canRequest=!isOpen&&!isStable&&!channel?.self_join_enabled&&channel?.access_request_enabled===true;
 const requestStatus=String(request?.status||"").toLowerCase();
 const pending=!hasExplicit&&requestStatus==="pending";
 const approved=!hasExplicit&&requestStatus==="approved";
 const rejected=!hasExplicit&&requestStatus==="rejected";
 const hasAccess=isStable||isOpen||hasExplicit;
 const isCurrent=channelKey===currentChannel;
 const lifecycleState=isStable?"Included":isOpen?"Available":hasExplicit?"Granted":pending?"Pending":approved?"Approved · syncing":rejected?"Denied":"Restricted";
 const requestDetails=request?.request_details&&typeof request.request_details==="object"?request.request_details:{};

 return <main className="orbitCustomerChannels">
  <section className="orbitCustomerCommandbar">
   <div>
    <span>ONE SHARED RELEASE CHANNEL SYSTEM</span>
    <b>Base and Update use the same channel access</b>
    <small>License Manager is authoritative for channel definitions and grants. Billing Store only provides this customer workflow.</small>
   </div>
   <div>
    <Link className="buttonlink secondary" href="/portal/orbitfs/license">License Controller</Link>
    <Link className="buttonlink secondary" href="/portal/orbitfs/base">Base Deployment</Link>
    <button type="button" onClick={()=>void load()} disabled={loading}>{loading?"Refreshing…":"Refresh"}</button>
   </div>
  </section>

  {error&&<div className="orbitCustomerNotice danger" role="alert"><b>Channel action failed</b><span>{error}</span></div>}
  {message&&<div className="orbitCustomerNotice" role="status"><b>Updated</b><span>{message}</span></div>}

  <section className="orbitCustomerChannelStats" aria-label="Release-channel summary">
   <article><span>Base installation channel</span><b>{baseInstall?currentChannel:"Not installed"}</b><small>{baseInstall?"Current Base release discovery channel":"Base Deployment will choose a channel when installed"}</small></article>
   <article><span>Available channels</span><b>{availableCount}</b><small>{channels.length} customer-visible channel{channels.length===1?"":"s"} defined</small></article>
   <article><span>Explicit grants</span><b>{access.length}</b><small>Restricted-channel access recorded by License Manager</small></article>
   <article><span>Pending requests</span><b>{pendingCount}</b><small>{pendingCount?"Waiting for staff review":"Nothing waiting for review"}</small></article>
  </section>

  <div className="orbitCustomerChannelWorkspace">
   <aside className="orbitCustomerChannelRail">
    <header><div><b>Release channels</b><span>Select a channel to review access and policy.</span></div><strong>{channels.length}</strong></header>
    <div className="orbitCustomerChannelList">
     {channels.map((row:any)=>{
      const key=String(row.channel||"");
      const latest=latestRequest(key);
      const explicit=explicitAccess.has(key.toLowerCase());
      const automatic=key==="stable"||row.access_mode==="open";
      const pendingRow=!explicit&&String(latest?.status||"").toLowerCase()==="pending";
      const accessible=automatic||explicit;
      const current=key===currentChannel;
      return <button type="button" key={key} className={"orbitCustomerChannelChoice "+(key===channelKey?"active ":"")+(accessible?"available ":"")+(current?"current":"")} onClick={()=>{setSelected(key);setRequestOpen(false);setForm(emptyRequest);setError("")}}>
       <div><b>{row.label||key}</b><span>{policyLabel(row)}</span></div>
       <small>{row.description||"OrbitFS release channel"}</small>
       <footer><span>{current?"Current Base channel":accessible?"Available":pendingRow?"Request pending":"Restricted"}</span><em>{key}</em></footer>
      </button>
     })}
    </div>
   </aside>

   <section className="orbitCustomerChannelDetail">
    {channel?<><header className="orbitCustomerChannelHead">
     <div>
      <span className="orbitCustomerKicker">SHARED BASE + UPDATE ACCESS</span>
      <div className="orbitCustomerChannelTitle"><h2>{channel.label||channelKey}</h2><span className={"orbitCustomerState "+(hasAccess?"ready":pending||approved?"current":"")}>{lifecycleState}</span></div>
      <p>{channel.description||"OrbitFS release channel managed by License Manager."}</p>
     </div>
     <div className="orbitCustomerChannelKey"><span>CHANNEL KEY</span><code>{channelKey}</code></div>
    </header>

    {isCurrent&&<section className="orbitCustomerCallout info">
     <div><span>CURRENT BASE CHANNEL</span><b>This installation currently follows {channel.label||channelKey}</b><p>Base Deployment and the Update Release System use the same authorised channel model. Changing access here does not silently rewrite the installed Base channel.</p></div>
     <Link className="buttonlink secondary" href="/portal/orbitfs/base">Open Base Deployment</Link>
    </section>}

    {!hasActiveBase&&<section className="orbitCustomerCallout warning">
     <div><span>ACTIVE BASE LICENCE REQUIRED</span><b>Channel access depends on an eligible Base licence</b><p>You can review channel policy here, but restricted access and release deployment remain unavailable until an active OrbitFS Base licence is linked.</p></div>
     <Link className="buttonlink secondary" href="/portal/orbitfs/license">Check licence</Link>
    </section>}

    <section className="orbitCustomerDetailGrid orbitChannelPolicyFacts">
     <article><span>Access policy</span><b>{policyLabel(channel)}</b><small>{isStable?"Included with every eligible Base licence":isOpen?"Available without an explicit grant":canSelfJoin?"Join or leave without staff approval":canRequest?"Request staff approval":"Staff assignment only"}</small></article>
     <article><span>Your access</span><b>{lifecycleState}</b><small>{hasAccess?"Authoritative access is available":pending?"Request is waiting for review":approved?"Approval exists but grant has not appeared yet":rejected?"Your latest request was denied":"No grant is currently recorded"}</small></article>
     <article><span>Used by</span><b>Base + Update</b><small>One channel entitlement, not separate release systems</small></article>
     <article><span>Customer visibility</span><b>{channel.customer_visible===false?"Hidden":"Visible"}</b><small>{channel.enabled===false?"Channel disabled":"Channel enabled by License Manager"}</small></article>
    </section>

    {(approved||rejected)&&<section className={"orbitCustomerRequestResult "+(rejected?"denied":"approved")}>
     <div><span>{rejected?"REQUEST DENIED":"REQUEST APPROVED"}</span><b>{rejected?"Access was not approved":"Waiting for authoritative grant"}</b><p>{rejected?(request?.reason||"Your access request was not approved."):"License Manager reports the request as approved, but the access grant has not appeared yet. Refresh before attempting deployment."}</p></div>
     {approved&&<button type="button" className="secondary" onClick={()=>void load()} disabled={loading}>Refresh access</button>}
    </section>}

    {pending&&<section className="orbitCustomerRequestResult pending">
     <div><span>REQUEST PENDING</span><b>Staff review is in progress</b><p>{requestDetails.use_case||"Your request has been submitted."}{request?.requested_at?" Requested "+new Date(request.requested_at).toLocaleDateString()+".":""}</p></div>
    </section>}

    <section className="orbitCustomerChannelActionPanel">
     <div>
      <span>ACCESS CONTROL</span>
      <h3>{hasAccess?"This channel is available to you":"This channel is restricted"}</h3>
      <p>{isStable?"Stable is the default production channel and does not need a separate grant.":isOpen?"Open channels are immediately available to eligible customers.":canSelfJoin?"You can add or remove this channel yourself.":canRequest?"Send a short access request for staff review.":"This channel can only be assigned by OrbitFS staff."}</p>
     </div>
     <div>
      {isStable&&<span className="orbitCustomerState ready">Included with licence</span>}
      {isOpen&&<span className="orbitCustomerState ready">No request required</span>}
      {canSelfJoin&&!hasExplicit&&<button type="button" disabled={!!busy||!hasActiveBase} onClick={()=>void act("join",channelKey)}>{busy==="join:"+channelKey?"Joining…":"Join channel"}</button>}
      {canSelfJoin&&hasExplicit&&<button type="button" className="secondary" disabled={!!busy} onClick={()=>setLeaveChannel(channelKey)}>Leave channel</button>}
      {canRequest&&!hasExplicit&&!approved&&!pending&&<button type="button" disabled={!!busy||!hasActiveBase} onClick={()=>{setRequestOpen(true);setForm(emptyRequest)}}>{rejected?"Request again":"Request access"}</button>}
      {canRequest&&pending&&<span className="orbitCustomerState current">Request pending</span>}
      {canRequest&&hasExplicit&&<span className="orbitCustomerState ready">Access granted</span>}
      {!isStable&&!isOpen&&!canSelfJoin&&!canRequest&&hasExplicit&&<span className="orbitCustomerState ready">Assigned by staff</span>}
      {!isStable&&!isOpen&&!canSelfJoin&&!canRequest&&!hasExplicit&&<span className="orbitCustomerState">Invite only</span>}
      {!isStable&&!isOpen&&hasExplicit&&!canSelfJoin&&<button type="button" className="secondary" disabled={!!busy} onClick={()=>setLeaveChannel(channelKey)}>Leave channel</button>}
     </div>
    </section>

    {requestOpen&&canRequest&&!hasExplicit&&!approved&&!pending&&<section className="orbitCustomerChannelRequest">
     <header><div><span>REQUEST ACCESS</span><h3>{channel.label||channelKey}</h3><p>Tell staff what you need this channel for. Submitting a request does not grant access automatically.</p></div><button type="button" className="secondary" onClick={()=>setRequestOpen(false)}>Cancel</button></header>
     <div className="orbitCustomerRequestFields">
      <label className="wide"><span>What do you want to test?</span><textarea maxLength={500} value={form.use_case} onChange={e=>setForm(value=>({...value,use_case:e.target.value}))} placeholder="Briefly describe what you want to test or validate."/></label>
      <label><span>Testing environment</span><select value={form.environment} onChange={e=>setForm(value=>({...value,environment:e.target.value}))}><option value="test">Test / sandbox</option><option value="staging">Staging</option><option value="production">Production</option><option value="other">Other</option></select></label>
      <label><span>Additional context <small>Optional</small></span><textarea maxLength={500} value={form.notes} onChange={e=>setForm(value=>({...value,notes:e.target.value}))} placeholder="Anything the reviewer should know."/></label>
     </div>
     <footer><small>{form.use_case.length}/500 characters · License Manager decides the authoritative result.</small><button type="button" disabled={!!busy||!form.use_case.trim()||!form.environment} onClick={()=>void act("request",channelKey)}>{busy==="request:"+channelKey?"Submitting…":"Submit request"}</button></footer>
    </section>}
    </>:<div className="orbitCustomerEmpty"><b>No release channels available</b><p>License Manager did not return any customer-visible release channels.</p></div>}
   </section>
  </div>

  <V6ConfirmDialog
   open={Boolean(leaveChannel)}
   title="Leave release channel?"
   description="Removing this explicit grant stops future Base and Update release discovery from this restricted channel. It does not automatically change an already deployed Base installation."
   confirmLabel="Leave channel"
   danger
   busy={Boolean(busy)}
   onCancel={()=>setLeaveChannel("")}
   onConfirm={()=>{if(leaveChannel)void act("leave",leaveChannel)}}
  />
 </main>;
}
