"use client";

import {FormEvent,use,useEffect,useState} from "react";
import Link from "next/link";
import ui from "./customer-detail-v6a.module.css";
import {createClient} from "@/lib/supabase";
import {usePermissions} from "@/lib/usePermissions";
import AdminNotesPanel from "@/components/AdminNotesPanel";
import CustomerStaffAccess from "@/components/CustomerStaffAccess";
import {SuperadminCustomerPasswordControl} from "@/components/SuperadminDeleteBar";
import {canonicalAccountStatus,canonicalStatusLabel} from "@/lib/license-status";
import CustomerMailPanel from "@/components/CustomerMailPanel";

const money=(cents:any,currency="AUD")=>new Intl.NumberFormat("en-AU",{style:"currency",currency}).format(Number(cents||0)/100);

export default function Customer({params}:{params:Promise<{id:string}>}){
 const {id}=use(params),sb=createClient();
 const {can,role}=usePermissions();
 const [tab,setTab]=useState("general"),[p,setP]=useState<any>(),[b,setB]=useState<any>();
 const [orders,setOrders]=useState<any[]>([]),[invoices,setInvoices]=useState<any[]>([]),[tickets,setTickets]=useState<any[]>([]),[ledger,setLedger]=useState<any[]>([]),[activity,setActivity]=useState<any[]>([]),[ipSummary,setIpSummary]=useState<any[]>([]),[audit,setAudit]=useState<any[]>([]),[installedProducts,setInstalledProducts]=useState<any[]>([]);
 const [amount,setAmount]=useState(""),[msg,setMsg]=useState("");
 const [enforcementEdit,setEnforcementEdit]=useState<any>(null),[enforcementBusy,setEnforcementBusy]=useState(false);

 async function load(){
  const {data:{session}}=await sb.auth.getSession();
  if(!session?.access_token){setMsg("Administrator session expired. Sign in again.");return false;}
  const [response,c,o,i,t,l,ac,au]=await Promise.all([
   fetch(`/api/admin/customers/${id}/profile`,{headers:{authorization:`Bearer ${session.access_token}`},cache:"no-store"}),
   sb.from("account_balances").select("*").eq("user_id",id).single(),
   sb.from("orders").select("*").eq("auth_user_id",id).order("created_at",{ascending:false}),
   sb.from("invoices").select("*").eq("auth_user_id",id).order("created_at",{ascending:false}),
   sb.from("support_tickets").select("*").eq("user_id",id).order("updated_at",{ascending:false}),
   sb.from("credit_ledger").select("*").eq("user_id",id).order("created_at",{ascending:false}).limit(50),
   sb.rpc("admin_customer_activity_snapshot",{p_user_id:id}),
   sb.from("admin_audit_log").select("*").or(`target_id.eq.${id},actor_id.eq.${id}`).order("created_at",{ascending:false}).limit(100)
  ]);
  const detail=await response.json().catch(()=>({}));
  if(!response.ok){setMsg(detail.error||"Could not load customer profile.");return false;}
  const profile=detail.profile,customer=detail.customer;
  setP({...customer,...profile,id,customer_id:customer.id,name:customer.name,email:customer.email,username:customer.username,customer_number:customer.customer_number||profile.customer_number,status:customer.status||profile.status,email_verified_at:customer.email_verified_at||profile.email_verified_at});setB(c.data);setOrders(o.data||[]);setInvoices(i.data||[]);setTickets(t.data||[]);setLedger(l.data||[]);setActivity(ac.data?.events||[]);setIpSummary(ac.data?.ips||[]);setAudit(au.data||[]);setInstalledProducts(detail.installations||[]);
  return true;
 }

 useEffect(()=>{load()},[id]);

 async function credit(sign:number){const x=Math.round(Number(amount||0)*100)*sign;if(!x)return;const {error}=await sb.rpc("adjust_credit",{target_user:id,amount_cents:x,reason:sign>0?"OrbitFS Master Admin Center credit":"OrbitFS Master Admin Center debit",reference_type:"admin",reference_id:null});setMsg(error?.message||"Balance updated.");setAmount("");if(!error)load()}
 async function save(e:FormEvent){
  e.preventDefault();setMsg("Saving customer…");
  const {data:{session}}=await sb.auth.getSession();
  if(!session?.access_token){setMsg("Administrator session expired. Sign in again.");return;}
  const changes={display_name:p.display_name,first_name:p.first_name,last_name:p.last_name,company_name:p.company_name,phone:p.phone,address_line1:p.address_line1,address_line2:p.address_line2,city:p.city,state_region:p.state_region,postal_code:p.postal_code,country_code:p.country_code,timezone:p.timezone,currency:p.currency,language:p.language,admin_notes:p.admin_notes,enforcement_notes:p.enforcement_notes};
  try{
   const response=await fetch(`/api/admin/customers/${id}/profile`,{method:"PATCH",headers:{"content-type":"application/json",authorization:`Bearer ${session.access_token}`},body:JSON.stringify(changes)});
   const result=await response.json().catch(()=>({}));
   if(!response.ok||!result.ok){setMsg(result.error||"Customer update failed.");return;}
   const reloaded=await load();
   if(reloaded)setMsg("Customer updated and verified.");
  }catch(e:any){setMsg(e?.message||"Customer update failed.");}
 }
 async function sendReset(){const {data:{session}}=await sb.auth.getSession();if(!session?.access_token){setMsg("Authentication required.");return}const r=await fetch("/api/admin/customers/password-reset",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${session.access_token}`},body:JSON.stringify({userId:id})});const j=await r.json().catch(()=>({}));setMsg(r.ok?(j.message||"Password reset sent."):(j.error||"Could not send password reset."))}
 async function submitEnforcement(state:string,reason="",expires_at:string|null=null){
  const {data:{session}}=await sb.auth.getSession();
  if(!session?.access_token)throw Error("Administrator session expired.");
  const response=await fetch(`/api/admin/customers/${id}/enforcement`,{
   method:"POST",
   headers:{"content-type":"application/json",authorization:`Bearer ${session.access_token}`},
   body:JSON.stringify({state,reason,expires_at})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||"Account enforcement failed.");
  return result;
 }
 async function enforce(state:string){
  if(state==="active"){
   if(!confirm("Reactivate this account and restore licences suspended by account enforcement?"))return;
   setEnforcementBusy(true);setMsg("");
   try{const result=await submitEnforcement("active");setMsg(result.message||"Account reactivated.");setEnforcementEdit(null);await load()}
   catch(e:any){setMsg(e?.message||"Account reactivation failed.")}
   finally{setEnforcementBusy(false)}
   return;
  }
  setEnforcementEdit({state,reason:"",expires_at:""});
 }
 async function applyEnforcement(){
  if(!enforcementEdit?.reason?.trim())return setMsg("Enforcement reason is required.");
  setEnforcementBusy(true);setMsg("");
  const expires=enforcementEdit.expires_at?new Date(enforcementEdit.expires_at).toISOString():null;
  try{
   const result=await submitEnforcement(enforcementEdit.state,enforcementEdit.reason.trim(),expires);
   setMsg(result.message||("Account "+enforcementEdit.state+" applied."));
   setEnforcementEdit(null);
   await load();
  }catch(e:any){setMsg(e?.message||"Account enforcement failed.")}
  finally{setEnforcementBusy(false)}
 }

 if(!p)return <main className="adminShell">Loading customer…</main>;
 const accountStatus=canonicalAccountStatus(p),tabs=[["general","General info / settings"],["installed","Installed product"],["orders","Orders"],["invoices","Invoices"],["support","Support tickets"],["notes","Notes"],...(can("communications.mail.send")||can("communications.mail.manage")?[["emails","Emails"]]:[]),["history","History / IP details"]];

 return <main className="adminShell">
  <header className="adminTop"><div><p className="eyebrow">CUSTOMER CONTROL</p><h1>{[p.first_name,p.last_name].map((name:string|undefined)=>String(name||"").trim()).filter(Boolean).join(" ")||p.display_name||p.name||p.username||"Customer"}</h1><p className="muted">{p.customer_number||"Customer"} · {p.email||"No email"}{p.username?` · @${p.username}`:""} · {p.email_verified_at?"verified":"unverified"} · {canonicalStatusLabel(accountStatus)}</p></div></header>
  <nav className={`recordTabs ${ui.tabs}`} aria-label="Customer sections">{tabs.map(([k,l])=><button type="button" aria-current={tab===k?"page":undefined} className={tab===k?"active":""} onClick={()=>setTab(k)} key={k}>{l}</button>)}</nav>

  {tab==="general"&&<div className={ui.workspace}>
   <section className={ui.overview} aria-label="Customer account summary">
    <div><span>Balance</span><strong>${((b?.available_cents||0)/100).toFixed(2)}</strong></div>
    <div><span>Orders</span><strong>{orders.length}</strong></div>
    <div><span>Account</span><strong>{canonicalStatusLabel(accountStatus)}</strong></div>
   </section>
   <div className={ui.columns}>
    <section className={`panel ${ui.profile}`}>
     <div className={ui.sectionHead}><div><h2>Customer profile</h2><p className="muted">Contact, address and account preferences</p></div></div>
     <form className={ui.compactForm} onSubmit={save}>
      <div className={ui.fieldGrid}>
       {([
        ["first_name","First name"],["last_name","Last name"],["display_name","Display name"],["company_name","Company"],
        ["phone","Phone"],["address_line1","Address line 1"],["address_line2","Address line 2"],
        ["city","City"],["state_region","State / region"],["postal_code","Postcode"],
        ["country_code","Country"],["timezone","Timezone"],["currency","Currency"]
       ] as const).map(([key,label])=><label key={key} className={key==="address_line1"||key==="address_line2"?ui.wide:""}><span>{label}</span><input value={p[key]||""} onChange={e=>setP({...p,[key]:key==="country_code"||key==="currency"?e.target.value.toUpperCase():e.target.value})} autoComplete="off"/></label>)}
      </div>
      <div className={ui.accountType}><span>Account type</span><strong>Customer</strong></div>
      <div className={ui.notesGrid}>
       <label><span>Private admin notes</span><textarea rows={3} value={p.admin_notes||""} onChange={e=>setP({...p,admin_notes:e.target.value})}/></label>
       <label><span>Enforcement notes</span><textarea rows={3} value={p.enforcement_notes||""} onChange={e=>setP({...p,enforcement_notes:e.target.value})}/></label>
      </div>
      {can("customers.edit")&&<div className={ui.formFooter}><button type="submit">Save customer</button></div>}
     </form>
    </section>
    <div className={ui.sidePanels}>
     <section className={`panel ${ui.compactPanel}`}><h2>Account enforcement</h2>
      <p className="muted">Suspension blocks purchases and licences but keeps Support available. Termination blocks portal access and licences.</p>
      {(accountStatus==="suspended"||accountStatus==="terminated")&&<div className="notice"><b>{canonicalStatusLabel(accountStatus)}</b><span>{accountStatus==="terminated"?(p.ban_reason||"No reason provided."):(p.suspension_reason||"No reason provided.")}</span></div>}
      {can("customers.enforce")?<div className={ui.actions}>{accountStatus==="suspended"&&<button onClick={()=>enforce("active")} disabled={enforcementBusy}>Reactivate</button>}<button className="secondary" onClick={()=>enforce("suspended")} disabled={enforcementBusy||accountStatus==="terminated"}>Suspend account + licences</button><button className="danger" onClick={()=>enforce("terminated")} disabled={enforcementBusy||accountStatus==="terminated"}>Terminate account + licences</button></div>:<p className="muted">View-only enforcement access.</p>}
     </section>
     <section className={`panel ${ui.compactPanel}`}><h2>Account security</h2><p className="muted">Manage customer password access.</p>
      <div className={ui.actions}>{can("customers.password_reset")&&<button className="secondary" onClick={sendReset}>Send password reset link</button>}</div>
      <SuperadminCustomerPasswordControl userId={id} role={role}/>
     </section>
     <section className={`panel ${ui.compactPanel}`}><h2>Balance control</h2>
      {can("credit.manage")?<div className={ui.balanceForm}><label><span>Amount (AUD)</span><input type="number" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00"/></label><div className={ui.actions}><button onClick={()=>credit(1)}>Add credit</button><button className="secondary" onClick={()=>credit(-1)}>Deduct credit</button></div></div>:<p className="muted">Credit management permission required.</p>}
     </section>
    </div>
   </div>
  </div>}
  {tab==="general"&&<CustomerStaffAccess userId={id}/>}

  {tab==="installed"&&<section className="panel">
   <div className="panelTitle"><div><p className="eyebrow">INSTALLED PRODUCT</p><h2>Customer installation</h2><p className="muted">Read-only deployment identity and runtime details. Release and deployment state are sourced from License Manager; provider project details are shown from the customer deployment record.</p></div><span>{installedProducts.length} installation{installedProducts.length===1?"":"s"}</span></div>
   {installedProducts.length?installedProducts.map((install:any)=>{
    const authority=install.authority||{},base=authority.current_base||{},update=authority.current_update||{};
    const siteUrl=install.production_url||base.deployment_url||install.deployment_url||authority.last_deployment_url||"";
    const version=base.release_version||base.product_version||authority.product_version||install.release_version||"—";
    const channel=base.release_channel||"—";
    const state=authority.last_deployment_status||install.state||"unknown";
    return <article className="panel" key={install.id} style={{marginTop:12}}>
     <div className="panelTitle"><div><h3>OrbitFS Base</h3><p className="muted">{siteUrl||"No production URL recorded"}</p></div><span className={"state "+(String(state).toLowerCase()==="completed"||String(state).toLowerCase()==="ready"?"ok":"waiting")}>{String(state).replaceAll("_"," ")}</span></div>
     <div className="stats four">
      <article><small>Installed version</small><strong>{version==="—"?"—":String(version).startsWith("v")?version:"v"+version}</strong></article>
      <article><small>Release channel</small><strong>{channel}</strong></article>
      <article><small>Health</small><strong>{install.health_status||"unknown"}</strong></article>
      <article><small>Deployments</small><strong>{authority.deployment_count??"—"}</strong></article>
     </div>
     <div className="adminGrid">
      <div>
       <div className="listrow"><b>Installation ID</b><span>{install.installation_id||"—"}</span></div>
       <div className="listrow"><b>Licence ID</b><span>{install.master_license_id||authority.license_id||"—"}</span></div>
       <div className="listrow"><b>Release ID</b><span>{base.release_id||install.release_id||"—"}</span></div>
       <div className="listrow"><b>Deployment ID</b><span>{base.deployment_id||authority.last_deployment_id||install.vercel_deployment_id||"—"}</span></div>
       <div className="listrow"><b>Vercel project</b><span>{install.vercel_project_name||base.project_name||install.vercel_project_id||base.project_id||"—"}</span></div>
       <div className="listrow"><b>Supabase project</b><span>{install.supabase_project_name||install.supabase_project_ref||"—"}</span></div>
      </div>
      <div>
       <div className="listrow"><b>Production URL</b><span>{siteUrl?<a href={siteUrl.startsWith("http")?siteUrl:`https://${siteUrl}`} target="_blank" rel="noreferrer">{siteUrl}</a>:"—"}</span></div>
       <div className="listrow"><b>Custom / production domain</b><span>{install.production_url||"—"}</span></div>
       <div className="listrow"><b>Last update</b><span>{update.release_version||update.product_version?(String(update.release_version||update.product_version).startsWith("v")?String(update.release_version||update.product_version):"v"+String(update.release_version||update.product_version)):"No update recorded"}</span></div>
       <div className="listrow"><b>Last seen</b><span>{authority.last_seen_at?new Date(authority.last_seen_at).toLocaleString():"—"}</span></div>
       <div className="listrow"><b>Region</b><span>{install.supabase_region||authority.last_region||base.region||"—"}</span></div>
       <div className="listrow"><b>Authority</b><span>{install.authority_source||"orbitfs-license-master-v2"}</span></div>
      </div>
     </div>
     {install.authority_error&&<div className="notice" style={{marginTop:12}}><b>License Manager details unavailable</b><span>{install.authority_error}</span></div>}
     {install.last_error&&<div className="notice" style={{marginTop:12}}><b>Latest deployment error</b><span>{install.last_error}</span></div>}
    </article>
   }):<p className="muted">No OrbitFS installation has been created for this customer yet.</p>}
  </section>}

  {tab==="orders"&&<section className="panel"><h2>Orders</h2>{orders.length?orders.map(o=><Link className="adminItem" href={`/admin/orders/${o.id}`} key={o.id}><div><b>#{o.order_number}</b><span>{o.status} · {o.payment_status} · {o.fulfillment_status}</span></div><span>${(o.total_cents/100).toFixed(2)} →</span></Link>):<p className="muted">No orders.</p>}</section>}
  {tab==="invoices"&&<section className="panel"><h2>Invoices</h2>{invoices.length?invoices.map(i=><Link className="adminItem" href={`/admin/invoices/${i.id}`} key={i.id}><div><b>{i.invoice_number}</b><span>{i.status} · due {i.due_at?new Date(i.due_at).toLocaleDateString():"—"}</span></div><span>${(i.total_cents/100).toFixed(2)} →</span></Link>):<p className="muted">No invoices.</p>}</section>}
  {tab==="support"&&<section className="panel"><h2>Support tickets</h2>{tickets.length?tickets.map(t=><Link className="adminItem" href={`/admin/support/${t.id}`} key={t.id}><div><b>#{t.ticket_number} {t.subject}</b><span>{t.status} · {t.priority}</span></div><span>Open →</span></Link>):<p className="muted">No tickets.</p>}</section>}
  {tab==="notes"&&<AdminNotesPanel entityType="customer" entityId={id} title="Customer notes"/>}
  {tab==="emails"&&(can("communications.mail.send")||can("communications.mail.manage"))&&<CustomerMailPanel customerId={id}/>}

  

  {tab==="history"&&<div className="adminGrid customerHistoryGrid"><section className="panel"><div className="panelTitle"><div><h2>Identity & IP history</h2><p className="muted">Network and device history recorded from authenticated customer activity.</p></div><span>{ipSummary.length} unique IP{ipSummary.length===1?"":"s"}</span></div><div className="stats four"><article><small>Last login</small><strong>{p.last_login_at?new Date(p.last_login_at).toLocaleDateString():"—"}</strong></article><article><small>Last login IP</small><strong>{p.last_login_ip||"—"}</strong></article><article><small>Activity events</small><strong>{activity.length}</strong></article><article><small>Account created</small><strong>{new Date(p.created_at).toLocaleDateString()}</strong></article></div><h3>Known IP addresses</h3>{ipSummary.length?ipSummary.map((x:any)=><div className="customerIpRow" key={x.ip_address}><div><b>{x.ip_address}</b><span>First seen {new Date(x.first_seen).toLocaleString()} · Last seen {new Date(x.last_seen).toLocaleString()}</span></div><div><strong>{x.events} events</strong><small>{x.last_user_agent||"No device information"}</small></div></div>):<p className="muted">No IP activity recorded yet.</p>}<h3>Customer activity timeline</h3>{activity.length?activity.map((a:any)=><div className="customerActivityRow" key={a.id}><div><b>{String(a.event_type||"activity").replaceAll("_"," ").replaceAll("."," › ")}</b><span>{new Date(a.created_at).toLocaleString()} · {a.ip_address||"No IP"} · {a.source||"web"}</span><small>{a.route||""}{a.entity_type?` · ${a.entity_type}${a.entity_id?` ${a.entity_id}`:""}`:""}</small></div><div><strong className={`mailTemplateState ${a.success?"on":"off"}`}>{a.success?"Success":"Failed"}</strong><span>{[a.detail?.device,a.detail?.os,a.detail?.browser].filter(Boolean).join(" · ")}</span><small>{a.detail?.client?.timezone||""}</small></div></div>):<p className="muted">No detailed activity captured yet.</p>}</section><section className="panel"><h2>Admin / account history</h2>{audit.length?audit.map(a=><div className="listrow" key={a.id}><div><b>{a.action}</b><span>{a.target_type} · {new Date(a.created_at).toLocaleString()}</span></div><span>{a.actor_email||""}</span></div>):<p className="muted">No audit entries.</p>}<h3>Credit history</h3>{ledger.map(x=><div className="listrow" key={x.id}><b>{x.reason}</b><span>{x.direction} ${(x.amount_cents/100).toFixed(2)} · balance ${(x.balance_after_cents/100).toFixed(2)}</span></div>)}</section></div>}
  {enforcementEdit&&<div className="orderModalBackdrop" onMouseDown={()=>!enforcementBusy&&setEnforcementEdit(null)}><section className="orderModal" onMouseDown={e=>e.stopPropagation()}><div className="panelTitle"><div><h2>{enforcementEdit.state==="terminated"?"Terminate customer":"Suspend customer"}</h2><p className="muted">{enforcementEdit.state==="terminated"?"Permanently terminates portal access and all OrbitFS licence use. Licence recovery must be handled explicitly because termination burns the old keys.":"Keeps Support available but blocks licences, purchases, billing, downloads and Store access."}</p></div><button className="small secondary" onClick={()=>setEnforcementEdit(null)} disabled={enforcementBusy}>Close</button></div><div className="form"><label>Reason<textarea rows={4} value={enforcementEdit.reason} onChange={e=>setEnforcementEdit({...enforcementEdit,reason:e.target.value})} placeholder="Required reason shown to the customer"/></label>{enforcementEdit.state!=="terminated"&&<label>Expiry date / time <span className="muted">(leave blank for no automatic expiry)</span><input type="datetime-local" value={enforcementEdit.expires_at} onChange={e=>setEnforcementEdit({...enforcementEdit,expires_at:e.target.value})}/></label>}<div className="notice"><b>Customer notice</b><span>The customer will be told to contact support via ticket or support@orbitfs.cc.</span></div><button className={enforcementEdit.state==="terminated"?"danger":""} onClick={applyEnforcement} disabled={enforcementBusy||!enforcementEdit.reason.trim()}>{enforcementBusy?"Applying…":enforcementEdit.state==="terminated"?"Apply termination":"Apply suspension"}</button></div></section></div>}
  <p>{msg}</p>
 </main>;
}
