"use client";

import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";

type RequestDetails={use_case:string;environment:string;notes:string};
const emptyRequest:RequestDetails={use_case:"",environment:"test",notes:""};

export default function CustomerReleaseChannelsPage(){
 const sb=useMemo(()=>createClient(),[]);
 const [data,setData]=useState<any>({channels:[],requests:[],access:[]});
 const [busy,setBusy]=useState("");
 const [message,setMessage]=useState("");
 const [formChannel,setFormChannel]=useState("");
 const [form,setForm]=useState<RequestDetails>(emptyRequest);
 const [loading,setLoading]=useState(true);

 async function headers():Promise<Record<string,string>>{
  const {data:{session}}=await sb.auth.getSession();
  return session?.access_token?{Authorization:"Bearer "+session.access_token}:{};
 }

 async function load(){
  setLoading(true);
  try{
   const r=await fetch("/api/orbitfs/release-channels",{headers:await headers(),cache:"no-store"});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not load release channels.");
   setData(j);
  }catch(e:any){setMessage(e?.message||"Could not load release channels.")}
  finally{setLoading(false)}
 }

 useEffect(()=>{void load()},[]);

 const explicitAccess=new Set((data.access||[]).map((x:any)=>String(x.channel||"").toLowerCase()));

 function latestRequest(channel:string){
  return (data.requests||[])
   .filter((x:any)=>String(x.channel||"")===channel)
   .sort((a:any,b:any)=>String(b.requested_at||"").localeCompare(String(a.requested_at||"")))[0]||null;
 }

 async function act(action:"join"|"leave"|"request",channel:string){
  setBusy(action+":"+channel);setMessage("");
  try{
   const body:any={action,channel};
   if(action==="request")body.requestDetails=form;
   const r=await fetch("/api/orbitfs/release-channels",{
    method:"POST",
    headers:{...(await headers()),"content-type":"application/json"},
    body:JSON.stringify(body),
   });
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Channel access action failed.");
   setMessage(action==="request"?"Access request submitted for review.":action==="join"?"Channel joined.":"Channel access removed.");
   setFormChannel("");setForm(emptyRequest);
   await load();
  }catch(e:any){setMessage(e?.message||"Channel access action failed.")}
  finally{setBusy("")}
 }

 if(loading)return <main className="portalReleasePage orbitfsChannelsPage"><section className="portalCompactPanel"><h2>Loading release channels…</h2><p className="muted">Checking your channel access with License Manager.</p></section></main>;

 return <main className="portalReleasePage orbitfsChannelsPage">
  <header className="portalReleaseHeader">
   <div>
    <p className="eyebrow">MY ORBITFS · RELEASE CHANNELS</p>
    <h1>Release Channels</h1>
    <p className="muted">Choose how early you want access to OrbitFS releases. Stable is included, open channels are available immediately, and restricted channels can require approval.</p>
   </div>
   <div className="portalHeaderActions">
    <Link className="buttonlink secondary" href="/portal/orbitfs">Base Deployment</Link>
    <Link className="buttonlink secondary" href="/portal/orbitfs/releases">Updates</Link>
   </div>
  </header>

  {message&&<div className="orbitInlineNotice">{message}</div>}

  <section className="portalCompactPanel channelIntroPanel">
   <div className="channelIntroCopy">
    <div><span className="channelLegendDot stable"/><b>Stable</b><small>Default production releases.</small></div>
    <div><span className="channelLegendDot open"/><b>Open channel</b><small>Available immediately to eligible customers.</small></div>
    <div><span className="channelLegendDot request"/><b>Approval channel</b><small>Send a short request for staff review.</small></div>
   </div>
  </section>

  <section className="customerChannelGrid">
   {(data.channels||[]).map((c:any)=>{
    const channel=String(c.channel||"");
    const request=latestRequest(channel);
    const hasExplicit=explicitAccess.has(channel.toLowerCase());
    const isStable=channel==="stable";
    const isOpen=c.access_mode==="open";
    const canSelfJoin=!isOpen&&!isStable&&c.self_join_enabled===true;
    const canRequest=!isOpen&&!isStable&&!c.self_join_enabled&&c.access_request_enabled===true;
    const requestStatus=String(request?.status||"").toLowerCase();
    // Authoritative access always wins over request history. A rejected/approved
    // request is historical once License Manager says this licence has access.
    const pending=!hasExplicit&&requestStatus==="pending";
    const approved=!hasExplicit&&requestStatus==="approved";
    const rejected=!hasExplicit&&requestStatus==="rejected";
    const hasAccess=isStable||isOpen||hasExplicit;
    const policy=isStable?"Stable":isOpen?"Open":canSelfJoin?"Self-join":canRequest?"Approval required":"Invite only";
    const lifecycleState=isStable?"Included":isOpen?"Available":hasExplicit?"Approved":pending?"Request pending":rejected?"Denied":approved?"Approved · syncing":"Restricted";

    return <article className={"customerChannelCard "+(hasAccess?"active":"")} key={channel}>
     <div className="customerChannelCardHead">
      <div>
       <div className="customerChannelTitle"><h2>{c.label||channel}</h2><span className={"channelPolicyBadge "+(hasAccess?"available":"")}>{policy}</span></div>
       <p>{c.description||"OrbitFS release channel"}</p>
      </div>
      <span className={"state "+((hasExplicit||isStable||isOpen)?"ready":pending||approved?"current":"")}>{lifecycleState}</span>
     </div>

     <div className="customerChannelPolicy">
      <div><span>Access</span><b>{isStable?"Included":isOpen?"Open to customers":canSelfJoin?"Join instantly":canRequest?"Staff approval":"Assigned only"}</b></div>
      <div><span>Status</span><b>{isStable?"Included":isOpen?"Available now":hasExplicit?"Approved":pending?"Request pending":rejected?"Denied":approved?"Approved · access syncing":"Not requested"}</b></div>
     </div>

     {approved&&<div className="channelRequestFeedback"><b>Approved</b><span>Your request is approved, but the access grant has not appeared yet. Refresh this page; deployment remains blocked until the grant is authoritative.</span></div>}
     {rejected&&<div className="channelRequestFeedback"><b>Denied</b><span>{request?.reason||"Your access request was not approved."}</span></div>}

     <div className="customerChannelActions">
      {isStable&&<span className="state ready">Included with your licence</span>}
      {isOpen&&<span className="state ready">No request required</span>}
      {canSelfJoin&&!hasExplicit&&<button disabled={!!busy} onClick={()=>void act("join",channel)}>{busy==="join:"+channel?"Joining…":"Join channel"}</button>}
      {canSelfJoin&&hasExplicit&&<button className="secondary" disabled={!!busy} onClick={()=>void act("leave",channel)}>{busy==="leave:"+channel?"Leaving…":"Leave channel"}</button>}
      {canRequest&&!hasExplicit&&!approved&&!pending&&<button disabled={!!busy} onClick={()=>{setFormChannel(channel);setForm(emptyRequest)}}>{rejected?"Request again":"Request access"}</button>}
      {canRequest&&pending&&<span className="state current">Request pending</span>}
      {canRequest&&hasExplicit&&<span className="state ready">Approved</span>}
      {canRequest&&approved&&!hasExplicit&&<button className="secondary" disabled={!!busy} onClick={()=>void load()}>Refresh approved access</button>}
      {canRequest&&rejected&&!pending&&!approved&&<span className="state">Denied</span>}
      {!isStable&&!isOpen&&!canSelfJoin&&!canRequest&&hasExplicit&&<span className="state ready">Assigned by staff</span>}
      {!isStable&&!isOpen&&!canSelfJoin&&!canRequest&&!hasExplicit&&<span className="state">Invite only</span>}
      {!isStable&&!isOpen&&hasExplicit&&!canSelfJoin&&<button className="secondary" disabled={!!busy} onClick={()=>void act("leave",channel)}>{busy==="leave:"+channel?"Leaving…":"Leave channel"}</button>}
     </div>

     {formChannel===channel&&canRequest&&!hasExplicit&&!approved&&!pending&&<div className="channelRequestForm">
      <div className="channelRequestFormHead"><div><b>Request {c.label||channel} access</b><span>Three quick fields. Your request is reviewed by OrbitFS staff.</span></div><button className="secondary" type="button" onClick={()=>setFormChannel("")}>Cancel</button></div>
      <label>
       <span>What do you want to test?</span>
       <textarea maxLength={500} value={form.use_case} onChange={e=>setForm(v=>({...v,use_case:e.target.value}))} placeholder="Briefly describe what you want to test or validate."/>
      </label>
      <label>
       <span>Testing environment</span>
       <select value={form.environment} onChange={e=>setForm(v=>({...v,environment:e.target.value}))}>
        <option value="test">Test / sandbox</option>
        <option value="staging">Staging</option>
        <option value="production">Production</option>
        <option value="other">Other</option>
       </select>
      </label>
      <label>
       <span>Anything else? <small>Optional</small></span>
       <textarea maxLength={500} value={form.notes} onChange={e=>setForm(v=>({...v,notes:e.target.value}))} placeholder="Extra context for the reviewer."/>
      </label>
      <div className="channelRequestSubmit">
       <small>Submitting does not grant access automatically.</small>
       <button disabled={!!busy||!form.use_case.trim()||!form.environment} onClick={()=>void act("request",channel)}>{busy==="request:"+channel?"Submitting…":"Submit request"}</button>
      </div>
     </div>}
    </article>
   })}
   {!(data.channels||[]).length&&<div className="portalCompactPanel"><p className="muted">No customer-visible release channels are currently available.</p></div>}
  </section>
 </main>;
}
