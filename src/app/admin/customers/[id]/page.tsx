"use client";

import {FormEvent,use,useEffect,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";
import {usePermissions} from "@/lib/usePermissions";
import AdminNotesPanel from "@/components/AdminNotesPanel";
import {SuperadminCustomerPasswordControl} from "@/components/SuperadminDeleteBar";

const AUTO_MAIL_VARS=new Set(["customer_name","email_reference_id","email_refrence_id","staff_name","staff_email","staff_user_id"]);
const LONG_MAIL_VARS=new Set(["message","reason","staff_note","reply_preview","refund_timing"]);
const normalize=(v:any)=>String(v||"").replace(/\\n/g,"\n");
const money=(cents:any,currency="AUD")=>new Intl.NumberFormat("en-AU",{style:"currency",currency}).format(Number(cents||0)/100);
const mailVarLabel=(v:string)=>v.replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());
function templateVariables(t:any){
 const all=`${t?.subject||""}\n${t?.text_body||""}\n${t?.html||""}`;
 return [...new Set([...all.matchAll(/{{\s*([\w.]+)\s*}}/g)].map(x=>String(x[1]).toLowerCase()))].filter(v=>!AUTO_MAIL_VARS.has(v));
}

export default function Customer({params}:{params:Promise<{id:string}>}){
 const {id}=use(params),sb=createClient();
 const {can,role}=usePermissions();
 const [tab,setTab]=useState("general"),[p,setP]=useState<any>(),[b,setB]=useState<any>();
 const [orders,setOrders]=useState<any[]>([]),[invoices,setInvoices]=useState<any[]>([]),[tickets,setTickets]=useState<any[]>([]),[ledger,setLedger]=useState<any[]>([]),[activity,setActivity]=useState<any[]>([]),[ipSummary,setIpSummary]=useState<any[]>([]),[audit,setAudit]=useState<any[]>([]);
 const [mail,setMail]=useState<any>({email:"",templates:[],logs:[]}),[mailMode,setMailMode]=useState("custom"),[mailTemplate,setMailTemplate]=useState(""),[mailSubject,setMailSubject]=useState(""),[mailBody,setMailBody]=useState(""),[mailVars,setMailVars]=useState<Record<string,string>>({}),[mailBusy,setMailBusy]=useState(false);
 const [amount,setAmount]=useState(""),[msg,setMsg]=useState("");
 const [enforcementEdit,setEnforcementEdit]=useState<any>(null),[enforcementBusy,setEnforcementBusy]=useState(false);

 async function load(){
  const [a,customer,c,o,i,t,l,ac,au]=await Promise.all([
   sb.from("user_profiles").select("*").eq("id",id).single(),
   sb.from("customers").select("*").eq("auth_user_id",id).maybeSingle(),
   sb.from("account_balances").select("*").eq("user_id",id).single(),
   sb.from("orders").select("*").eq("auth_user_id",id).order("created_at",{ascending:false}),
   sb.from("invoices").select("*").eq("auth_user_id",id).order("created_at",{ascending:false}),
   sb.from("support_tickets").select("*").eq("user_id",id).order("updated_at",{ascending:false}),
   sb.from("credit_ledger").select("*").eq("user_id",id).order("created_at",{ascending:false}).limit(50),
   sb.rpc("admin_customer_activity_snapshot",{p_user_id:id}),
   sb.from("admin_audit_log").select("*").or(`target_id.eq.${id},actor_id.eq.${id}`).order("created_at",{ascending:false}).limit(100)
  ]);
  setP({...a.data,...(customer.data||{}),id,customer_id:customer.data?.id,email:customer.data?.email,username:customer.data?.username,customer_number:customer.data?.customer_number||a.data?.customer_number,status:customer.data?.status||a.data?.status,email_verified_at:customer.data?.email_verified_at||a.data?.email_verified_at});setB(c.data);setOrders(o.data||[]);setInvoices(i.data||[]);setTickets(t.data||[]);setLedger(l.data||[]);setActivity(ac.data?.events||[]);setIpSummary(ac.data?.ips||[]);setAudit(au.data||[]);
 }

 useEffect(()=>{load();loadMail()},[id]);

 async function loadMail(){
  const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)return;
  const r=await fetch(`/api/admin/customer-email?userId=${id}`,{headers:{Authorization:`Bearer ${session.access_token}`},cache:"no-store"});
  const j=await r.json().catch(()=>({}));if(r.ok)setMail(j);
 }

 const selectedTemplate=(mail.templates||[]).find((x:any)=>x.template_key===mailTemplate);
 const selectedTemplateVars=selectedTemplate?templateVariables(selectedTemplate):[];

 function renderTemplatePart(value:string,vars:Record<string,string>){
  const previewVars:Record<string,string>={
   ...vars,
   customer_name:p?.display_name||p?.first_name||"Customer",
   email_reference_id:"Generated when sent",
   email_refrence_id:"Generated when sent",
   staff_name:"Current staff member",
   staff_email:"Current staff email",
   staff_user_id:"Current staff ID"
  };
  return normalize(value).replace(/{{\s*([\w.]+)\s*}}/g,(_,k)=>previewVars[String(k).toLowerCase()]||`{{${k}}}`);
 }

 function refreshTemplatePreview(t:any,vars:Record<string,string>){
  setMailSubject(renderTemplatePart(String(t?.subject||""),vars));
  setMailBody(renderTemplatePart(String(t?.text_body||t?.subject||""),vars));
 }

 function selectQuickTemplate(key:string){
  setMailTemplate(key);setMailVars({});setMsg("");
  if(!key){setMailMode("custom");setMailSubject("");setMailBody("");return;}
  const t=(mail.templates||[]).find((x:any)=>x.template_key===key);if(!t)return;
  setMailMode("template");refreshTemplatePreview(t,{});
 }

 function updateMailVar(key:string,value:string){
  const next={...mailVars,[key]:value};
  if(key==="invoice_number"){
   const x=invoices.find((v:any)=>String(v.invoice_number)===value);
   if(x){next.invoice_url=`${location.origin}/portal/invoices/${x.id}`;next.due_date=x.due_at?new Date(x.due_at).toLocaleDateString("en-AU"):"No due date";next.invoice_total=money(x.total_cents,x.currency||p?.currency||"AUD");next.invoice_due=money(Math.max(0,Number(x.total_cents||0)-Number(x.paid_cents||0)),x.currency||p?.currency||"AUD");}
  }
  if(key==="order_number"){
   const x=orders.find((v:any)=>String(v.order_number)===value);
   if(x)next.order_total=money(x.total_cents,x.currency||p?.currency||"AUD");
  }
  if(key==="ticket_number"){
   const x=tickets.find((v:any)=>String(v.ticket_number)===value);
   if(x)next.ticket_subject=String(x.subject||"");
  }
  setMailVars(next);if(selectedTemplate)refreshTemplatePreview(selectedTemplate,next);
 }

 function mailVariableField(key:string){
  const label=mailVarLabel(key),value=mailVars[key]||"";
  if(key==="invoice_number")return <label key={key}>{label}<select value={value} onChange={e=>updateMailVar(key,e.target.value)}><option value="">Choose invoice…</option>{invoices.map((x:any)=><option key={x.id} value={x.invoice_number}>{x.invoice_number} · {x.status} · {money(x.total_cents,x.currency||p?.currency||"AUD")}</option>)}</select></label>;
  if(key==="order_number")return <label key={key}>{label}<select value={value} onChange={e=>updateMailVar(key,e.target.value)}><option value="">Choose order…</option>{orders.map((x:any)=><option key={x.id} value={x.order_number}>#{x.order_number} · {x.status} · {money(x.total_cents,x.currency||p?.currency||"AUD")}</option>)}</select></label>;
  if(key==="ticket_number")return <label key={key}>{label}<select value={value} onChange={e=>updateMailVar(key,e.target.value)}><option value="">Choose support ticket…</option>{tickets.map((x:any)=><option key={x.id} value={x.ticket_number}>#{x.ticket_number} · {x.subject}</option>)}</select></label>;
  if(key==="refund_method")return <label key={key}>{label}<select value={value} onChange={e=>updateMailVar(key,e.target.value)}><option value="">Choose refund destination…</option><option>OrbitFS Wallet</option><option>Original payment method</option><option>Stripe / card</option><option>PayPal</option></select></label>;
  if(key==="refund_status")return <label key={key}>{label}<select value={value} onChange={e=>updateMailVar(key,e.target.value)}><option value="">Choose status…</option><option>Completed</option><option>Processing</option><option>Pending</option><option>Failed</option></select></label>;
  if(LONG_MAIL_VARS.has(key))return <label key={key}>{label}<textarea rows={key==="message"?5:3} value={value} onChange={e=>updateMailVar(key,e.target.value)} placeholder={`Enter ${label.toLowerCase()}…`}/></label>;
  return <label key={key}>{label}<input type={key.endsWith("_url")?"url":"text"} value={value} onChange={e=>updateMailVar(key,e.target.value)} placeholder={`Enter ${label.toLowerCase()}…`}/></label>;
 }

 async function sendCustomerMail(){
  if(mailMode==="custom"&&(!mailSubject.trim()||!mailBody.trim()))return setMsg("Subject and message are required.");
  if(mailMode==="template"&&!mailTemplate)return setMsg("Choose an email template.");
  if(mailMode==="template"){
   const missing=selectedTemplateVars.filter(k=>!String(mailVars[k]||"").trim());
   if(missing.length)return setMsg(`Complete the template fields: ${missing.map(mailVarLabel).join(", ")}.`);
  }
  setMailBusy(true);setMsg("Sending email…");
  const {data:{session}}=await sb.auth.getSession();if(!session?.access_token){setMailBusy(false);return;}
  const r=await fetch("/api/admin/customer-email",{method:"POST",headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({userId:id,customerName:p?.display_name||p?.first_name||"Customer",templateKey:mailTemplate||null,subject:mailSubject,body:mailMode==="custom"?mailBody:"",variables:mailVars,edited:mailMode==="custom"})});
  const j=await r.json().catch(()=>({}));setMailBusy(false);setMsg(r.ok?`Email sent to ${mail.email}.`:j.error||"Email failed.");
  if(r.ok){setMailTemplate("");setMailMode("custom");setMailSubject("");setMailBody("");setMailVars({});await loadMail();}
 }

 async function credit(sign:number){const x=Math.round(Number(amount||0)*100)*sign;if(!x)return;const {error}=await sb.rpc("adjust_credit",{target_user:id,amount_cents:x,reason:sign>0?"OrbitFS Master Admin Center credit":"OrbitFS Master Admin Center debit",reference_type:"admin",reference_id:null});setMsg(error?.message||"Balance updated.");setAmount("");if(!error)load()}
 async function save(e:FormEvent){e.preventDefault();const {error}=await sb.from("user_profiles").update({display_name:p.display_name,first_name:p.first_name,last_name:p.last_name,company_name:p.company_name,phone:p.phone,address_line1:p.address_line1,address_line2:p.address_line2,city:p.city,state_region:p.state_region,postal_code:p.postal_code,country_code:p.country_code,timezone:p.timezone,currency:p.currency,language:p.language,admin_notes:p.admin_notes,enforcement_notes:p.enforcement_notes}).eq("id",id);setMsg(error?.message||"Customer updated.");if(!error)load()}
 async function sendReset(){const {data:{session}}=await sb.auth.getSession();if(!session?.access_token){setMsg("Authentication required.");return}const r=await fetch("/api/admin/customers/password-reset",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${session.access_token}`},body:JSON.stringify({userId:id})});const j=await r.json().catch(()=>({}));setMsg(r.ok?(j.message||"Password reset sent."):(j.error||"Could not send password reset."))}
 async function enforce(state:string){
  if(state==="active"){if(!confirm("Reactivate this account and restore licences suspended by account enforcement?"))return;setEnforcementBusy(true);const {error}=await sb.rpc("admin_set_account_enforcement_v2",{target_user:id,new_state:"active",why:null,expires_at:null});setEnforcementBusy(false);setMsg(error?.message||"Account reactivated.");if(!error){setEnforcementEdit(null);load()}return}
  setEnforcementEdit({state,reason:"",expires_at:""});
 }
 async function applyEnforcement(){
  if(!enforcementEdit?.reason?.trim())return setMsg("Enforcement reason is required.");
  setEnforcementBusy(true);setMsg("");
  const expires=enforcementEdit.expires_at?new Date(enforcementEdit.expires_at).toISOString():null;
  const {error}=await sb.rpc("admin_set_account_enforcement_v2",{target_user:id,new_state:enforcementEdit.state,why:enforcementEdit.reason.trim(),expires_at:expires});
  setEnforcementBusy(false);setMsg(error?.message||(enforcementEdit.state+" applied."));
  if(!error){setEnforcementEdit(null);load()}
 }

 if(!p)return <main className="adminShell">Loading customer…</main>;
 const banned=!!p.banned_at,tabs=[["general","General info / settings"],["orders","Orders"],["invoices","Invoices"],["support","Support tickets"],["notes","Notes"],["emails","Emails"],["history","History / IP details"]];

 return <main className="adminShell">
  <header className="adminTop"><div><p className="eyebrow">CUSTOMER CONTROL</p><h1>{p.name||p.display_name||"Customer"}</h1><p className="muted">{p.customer_number||"Customer"} · {p.email||"No email"}{p.username?` · @${p.username}`:""} · {p.email_verified_at?"verified":"unverified"} · {banned?"banned":p.status}</p></div></header>
  <nav className="recordTabs">{tabs.map(([k,l])=><button className={tab===k?"active":""} onClick={()=>setTab(k)} key={k}>{l}</button>)}</nav>

  {tab==="general"&&<><section className="stats four"><article><small>Balance</small><strong>${((b?.available_cents||0)/100).toFixed(2)}</strong></article><article><small>Orders</small><strong>{orders.length}</strong></article><article><small>Account</small><strong>{banned?"Banned":p.status}</strong></article></section><div className="adminGrid"><section className="panel"><h2>Customer profile</h2><form className="form" onSubmit={save}><div className="two"><input value={p.first_name||""} onChange={e=>setP({...p,first_name:e.target.value})} placeholder="First name"/><input value={p.last_name||""} onChange={e=>setP({...p,last_name:e.target.value})} placeholder="Last name"/></div><input value={p.display_name||""} onChange={e=>setP({...p,display_name:e.target.value})} placeholder="Display name"/><input value={p.company_name||""} onChange={e=>setP({...p,company_name:e.target.value})} placeholder="Company"/><input value={p.phone||""} onChange={e=>setP({...p,phone:e.target.value})} placeholder="Phone"/><input value={p.address_line1||""} onChange={e=>setP({...p,address_line1:e.target.value})} placeholder="Address line 1"/><input value={p.address_line2||""} onChange={e=>setP({...p,address_line2:e.target.value})} placeholder="Address line 2"/><div className="two"><input value={p.city||""} onChange={e=>setP({...p,city:e.target.value})} placeholder="City"/><input value={p.state_region||""} onChange={e=>setP({...p,state_region:e.target.value})} placeholder="State / region"/></div><div className="two"><input value={p.postal_code||""} onChange={e=>setP({...p,postal_code:e.target.value})} placeholder="Postcode"/><input value={p.country_code||""} onChange={e=>setP({...p,country_code:e.target.value.toUpperCase()})} placeholder="Country"/></div><div className="two"><input value={p.timezone||""} onChange={e=>setP({...p,timezone:e.target.value})} placeholder="Timezone"/><input value={p.currency||""} onChange={e=>setP({...p,currency:e.target.value.toUpperCase()})} placeholder="Currency"/></div><div className="listrow"><b>Account type</b><span>Customer</span></div><textarea rows={4} value={p.admin_notes||""} onChange={e=>setP({...p,admin_notes:e.target.value})} placeholder="Private admin notes"/><textarea rows={3} value={p.enforcement_notes||""} onChange={e=>setP({...p,enforcement_notes:e.target.value})} placeholder="Enforcement notes"/>{can("customers.edit")&&<button>Save customer</button>}</form></section><section className="panel"><h2>Account enforcement</h2><p className="muted">Suspension keeps Support available but blocks purchases and licences. A ban blocks portal access and licences completely.</p>{(p.status==="suspended"||p.banned_at)&&<div className="notice"><b>{p.banned_at?"Banned":"Suspended"}</b><span>{p.banned_at?(p.ban_reason||"No reason provided."):(p.suspension_reason||"No reason provided.")}</span><span>{p.banned_at?(p.ban_expires_at?("Until "+new Date(p.ban_expires_at).toLocaleString()):"Permanent ban"):(p.suspension_expires_at?("Until "+new Date(p.suspension_expires_at).toLocaleString()):"No automatic expiry")}</span></div>}{can("customers.enforce")?<div className="actionStack"><button onClick={()=>enforce("active")} disabled={enforcementBusy}>Reactivate</button><button className="secondary" onClick={()=>enforce("suspended")} disabled={enforcementBusy}>Suspend account + licences</button><button className="danger" onClick={()=>enforce("banned")} disabled={enforcementBusy}>Ban account + licences</button></div>:<p className="muted">Your role has view-only enforcement access.</p>}<h3>Account security</h3><p className="muted">Send a secure password recovery link to the customer&apos;s registered email. Requires the customer password-reset permission.</p>{can("customers.password_reset")&&<button className="secondary" onClick={sendReset}>Send password reset link</button>}<SuperadminCustomerPasswordControl userId={id} role={role}/><h3>Balance control</h3>{can("credit.manage")?<div className="form"><input type="number" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Amount AUD"/><div className="two"><button onClick={()=>credit(1)}>Add credit</button><button className="secondary" onClick={()=>credit(-1)}>Deduct credit</button></div></div>:<p className="muted">Credit management permission required.</p>}</section></div></>}

  {tab==="orders"&&<section className="panel"><h2>Orders</h2>{orders.length?orders.map(o=><Link className="adminItem" href={`/admin/orders/${o.id}`} key={o.id}><div><b>#{o.order_number}</b><span>{o.status} · {o.payment_status} · {o.fulfillment_status}</span></div><span>${(o.total_cents/100).toFixed(2)} →</span></Link>):<p className="muted">No orders.</p>}</section>}
  {tab==="invoices"&&<section className="panel"><h2>Invoices</h2>{invoices.length?invoices.map(i=><Link className="adminItem" href={`/admin/invoices/${i.id}`} key={i.id}><div><b>{i.invoice_number}</b><span>{i.status} · due {i.due_at?new Date(i.due_at).toLocaleDateString():"—"}</span></div><span>${(i.total_cents/100).toFixed(2)} →</span></Link>):<p className="muted">No invoices.</p>}</section>}
  {tab==="support"&&<section className="panel"><h2>Support tickets</h2>{tickets.length?tickets.map(t=><Link className="adminItem" href={`/admin/support/${t.id}`} key={t.id}><div><b>#{t.ticket_number} {t.subject}</b><span>{t.status} · {t.priority}</span></div><span>Open →</span></Link>):<p className="muted">No tickets.</p>}</section>}
  {tab==="notes"&&<AdminNotesPanel entityType="customer" entityId={id} title="Customer notes"/>}

  {tab==="emails"&&<>
   <section className="panel customerQuickMail">
    <div className="panelTitle"><div><p className="eyebrow">CUSTOMER COMMUNICATIONS</p><h2>Quick Send Email</h2><p className="muted">Every enabled OrbitFS Mail template is available here. Fields only appear when the selected template needs them; choosing a customer invoice, order or ticket automatically fills related values where possible.</p></div><span>{mail.email||"Email unavailable"}</span></div>
    <div className="form">
     <label>Template<select value={mailTemplate} onChange={e=>selectQuickTemplate(e.target.value)}><option value="">Custom / blank message</option>{(mail.templates||[]).map((t:any)=><option value={t.template_key} key={t.template_key}>{t.category} · {t.name}</option>)}</select></label>
     {mailTemplate&&<div className="listrow"><div><b>{selectedTemplate?.name}</b><span>{selectedTemplate?.category} · {selectedTemplateVars.length} required field{selectedTemplateVars.length===1?"":"s"}</span></div><small>Fields disappear/change when you choose another template.</small></div>}
     {mailMode==="template"&&selectedTemplateVars.length>0&&<><h3>Template fields</h3><div className="two">{selectedTemplateVars.map(mailVariableField)}</div></>}
     <label>{mailMode==="template"?"Subject preview":"Subject"}<input value={mailSubject} readOnly={mailMode==="template"} onChange={e=>setMailSubject(e.target.value)} placeholder="Email subject"/></label>
     <label>{mailMode==="template"?"Email preview":"Message"}<textarea rows={10} value={mailBody} readOnly={mailMode==="template"} onChange={e=>setMailBody(e.target.value)} placeholder={mailMode==="template"?"Fill the template fields above to complete the preview":"Write the customer message..."}/></label>
     <div className="listrow"><span>From</span><b>{selectedTemplate?.from_account||"support@orbitfs.cc"}</b></div>
     <button onClick={sendCustomerMail} disabled={mailBusy||!mail.email}>{mailBusy?"Sending…":"Send email"}</button>
    </div>
   </section>
   <section className="panel"><div className="panelTitle"><div><h2>Recent sent emails</h2><p className="muted">Automated lifecycle messages and manual support emails sent to {mail.email||"this customer"}.</p></div><button className="small secondary" onClick={loadMail}>Refresh</button></div>{(mail.logs||[]).length?(mail.logs||[]).map((x:any)=><div className="customerEmailRow" key={x.id}><div><b>{x.subject||"Untitled email"}</b><span>{x.sender} · {x.template_key||x.event_type||"manual"}</span><small>{x.related_type?`${x.related_type}${x.related_id?` · ${x.related_id}`:""}`:""}</small></div><div><strong className={`mailTemplateState ${x.status==="sent"?"on":"off"}`}>{x.status}</strong><span>{new Date(x.sent_at||x.created_at).toLocaleString()}</span>{x.error&&<small>{x.error}</small>}</div></div>):<p className="muted">No sent emails recorded for this customer yet.</p>}</section>
  </>}

  {tab==="history"&&<div className="adminGrid customerHistoryGrid"><section className="panel"><div className="panelTitle"><div><h2>Identity & IP history</h2><p className="muted">Network and device history recorded from authenticated customer activity.</p></div><span>{ipSummary.length} unique IP{ipSummary.length===1?"":"s"}</span></div><div className="stats four"><article><small>Last login</small><strong>{p.last_login_at?new Date(p.last_login_at).toLocaleDateString():"—"}</strong></article><article><small>Last login IP</small><strong>{p.last_login_ip||"—"}</strong></article><article><small>Activity events</small><strong>{activity.length}</strong></article><article><small>Account created</small><strong>{new Date(p.created_at).toLocaleDateString()}</strong></article></div><h3>Known IP addresses</h3>{ipSummary.length?ipSummary.map((x:any)=><div className="customerIpRow" key={x.ip_address}><div><b>{x.ip_address}</b><span>First seen {new Date(x.first_seen).toLocaleString()} · Last seen {new Date(x.last_seen).toLocaleString()}</span></div><div><strong>{x.events} events</strong><small>{x.last_user_agent||"No device information"}</small></div></div>):<p className="muted">No IP activity recorded yet.</p>}<h3>Customer activity timeline</h3>{activity.length?activity.map((a:any)=><div className="customerActivityRow" key={a.id}><div><b>{String(a.event_type||"activity").replaceAll("_"," ").replaceAll("."," › ")}</b><span>{new Date(a.created_at).toLocaleString()} · {a.ip_address||"No IP"} · {a.source||"web"}</span><small>{a.route||""}{a.entity_type?` · ${a.entity_type}${a.entity_id?` ${a.entity_id}`:""}`:""}</small></div><div><strong className={`mailTemplateState ${a.success?"on":"off"}`}>{a.success?"Success":"Failed"}</strong><span>{[a.detail?.device,a.detail?.os,a.detail?.browser].filter(Boolean).join(" · ")}</span><small>{a.detail?.client?.timezone||""}</small></div></div>):<p className="muted">No detailed activity captured yet.</p>}</section><section className="panel"><h2>Admin / account history</h2>{audit.length?audit.map(a=><div className="listrow" key={a.id}><div><b>{a.action}</b><span>{a.target_type} · {new Date(a.created_at).toLocaleString()}</span></div><span>{a.actor_email||""}</span></div>):<p className="muted">No audit entries.</p>}<h3>Credit history</h3>{ledger.map(x=><div className="listrow" key={x.id}><b>{x.reason}</b><span>{x.direction} ${(x.amount_cents/100).toFixed(2)} · balance ${(x.balance_after_cents/100).toFixed(2)}</span></div>)}</section></div>}
  {enforcementEdit&&<div className="orderModalBackdrop" onMouseDown={()=>!enforcementBusy&&setEnforcementEdit(null)}><section className="orderModal" onMouseDown={e=>e.stopPropagation()}><div className="panelTitle"><div><h2>{enforcementEdit.state==="banned"?"Ban customer":"Suspend customer"}</h2><p className="muted">{enforcementEdit.state==="banned"?"Blocks login and all OrbitFS licences.":"Keeps Support available but blocks licences, purchases, billing, downloads and Store access."}</p></div><button className="small secondary" onClick={()=>setEnforcementEdit(null)} disabled={enforcementBusy}>Close</button></div><div className="form"><label>Reason<textarea rows={4} value={enforcementEdit.reason} onChange={e=>setEnforcementEdit({...enforcementEdit,reason:e.target.value})} placeholder="Required reason shown to the customer"/></label><label>Expiry date / time <span className="muted">(leave blank for no automatic expiry)</span><input type="datetime-local" value={enforcementEdit.expires_at} onChange={e=>setEnforcementEdit({...enforcementEdit,expires_at:e.target.value})}/></label><div className="notice"><b>Customer notice</b><span>The customer will be told to contact support via ticket or support@orbitfs.cc.</span></div><button className={enforcementEdit.state==="banned"?"danger":""} onClick={applyEnforcement} disabled={enforcementBusy||!enforcementEdit.reason.trim()}>{enforcementBusy?"Applying…":enforcementEdit.state==="banned"?"Apply ban":"Apply suspension"}</button></div></section></div>}
  <p>{msg}</p>
 </main>;
}
