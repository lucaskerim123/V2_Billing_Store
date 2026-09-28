"use client";

import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";
import {usePermissions} from "@/lib/usePermissions";

const empty={first_name:"",last_name:"",email:"",company_name:"",phone:"",address_line1:"",address_line2:"",city:"",state_region:"",postal_code:"",country_code:"AU",timezone:"Australia/Sydney",currency:"AUD",language:"en"};
const label=(s:any)=>String(s||"").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());

export default function Customers(){
 const sb=createClient(),{can,role}=usePermissions();
 const [rows,setRows]=useState<any[]>([]),[balances,setBalances]=useState<any[]>([]),[q,setQ]=useState(""),[status,setStatus]=useState("all"),[sort,setSort]=useState("recent"),[msg,setMsg]=useState(""),[open,setOpen]=useState(false),[form,setForm]=useState<any>(empty),[saving,setSaving]=useState(false),[loading,setLoading]=useState(true);

 async function load(){
  setLoading(true);setMsg("");
  try{
   const {data:{session}}=await sb.auth.getSession();
   if(!session?.access_token)throw Error("Administrator session expired. Sign in again.");
   const r=await fetch("/api/admin/customers",{headers:{authorization:`Bearer ${session.access_token}`},cache:"no-store"});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not load customers.");
   setRows(Array.isArray(j.customers)?j.customers:[]);
   setBalances(Array.isArray(j.balances)?j.balances:[]);
  }catch(e:any){setMsg(e?.message||"Could not load customers.");setRows([]);setBalances([])}
  finally{setLoading(false)}
 }
 useEffect(()=>{load()},[]);

 const balanceFor=(id:string)=>Number(balances.find(x=>x.user_id===id)?.available_cents||0);
 const userIdFor=(row:any)=>String(row.auth_user_id||row.id);
 const totalCredit=balances.reduce((n,x)=>n+Number(x.available_cents||0),0);
 const active=rows.filter(x=>x.status==="active"&&!x.banned_at).length;
 const suspended=rows.filter(x=>x.status==="suspended"&&!x.banned_at).length;
 const banned=rows.filter(x=>!!x.banned_at||x.status==="banned").length;

 const filtered=useMemo(()=>{
  const needle=q.trim().toLowerCase();
  let out=rows.filter(x=>{
   const state=x.banned_at?"banned":String(x.status||"active");
   if(status!=="all"&&state!==status)return false;
   if(!needle)return true;
   return `${x.display_name||""} ${x.name||""} ${x.username||""} ${x.email||""} ${x.customer_number||""} ${x.first_name||""} ${x.last_name||""} ${x.company_name||""} ${x.phone||""} ${x.city||""} ${x.state_region||""} ${x.country_code||""} ${x.status||""}`.toLowerCase().includes(needle);
  });
  out=out.slice().sort((a,b)=>{
   if(sort==="name")return String(a.display_name||a.name||a.first_name||"").localeCompare(String(b.display_name||b.name||b.first_name||""));
   if(sort==="credit")return balanceFor(userIdFor(b))-balanceFor(userIdFor(a));
   return +new Date(b.created_at||0)-+new Date(a.created_at||0);
  });
  return out;
 },[rows,balances,q,status,sort]);

 async function create(){
  setSaving(true);setMsg("");
  const {data:{session}}=await sb.auth.getSession();
  const r=await fetch("/api/admin/customers",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${session?.access_token||""}`},body:JSON.stringify(form)});
  const x=await r.json().catch(()=>({}));setSaving(false);
  if(!r.ok){setMsg(x.error||"Could not create customer.");return}
  setOpen(false);setForm(empty);setMsg("Customer created and OrbitFS password setup email sent.");await load();
 }

 async function reset(u:any){
  const uid=userIdFor(u);if(!confirm(`Send an OrbitFS password reset email for ${u.display_name||u.name||u.email||uid}?`))return;
  setMsg("Sending password reset…");
  const {data:{session}}=await sb.auth.getSession();
  const r=await fetch("/api/admin/customers/password-reset",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${session?.access_token||""}`},body:JSON.stringify({userId:uid})});
  const x=await r.json().catch(()=>({}));setMsg(r.ok?(x.message||"Password reset sent."):(x.error||"Could not send reset."));
 }

 async function remove(u:any){
  const uid=userIdFor(u);if(!confirm(`Permanently delete customer ${u.display_name||u.name||u.email||uid} and their account data? This cannot be undone.`))return;
  const reason=prompt("Reason for deleting this customer?");if(reason===null)return;
  const {error}=await sb.rpc("superadmin_delete_customer",{p_user_id:uid,p_reason:reason||null});
  setMsg(error?.message||`${u.display_name||u.name||"Customer"} deleted.`);if(!error)load();
 }

 return <main className="adminShell">
  <header className="adminTop customerWorkspaceHead">
   <div><p className="eyebrow">CUSTOMER OPERATIONS</p><h1>Customers</h1><p className="muted">Accounts, contact details, credit, enforcement and the customer&apos;s complete OrbitFS history.</p></div>
   <div className="customerQuickActions">{can("customers.cancellations")&&<Link className="buttonlink secondary" href="/admin/customers/cancellations">Cancellation queue</Link>}{can("customers.edit")&&<button onClick={()=>setOpen(true)}>+ Create customer</button>}</div>
  </header>

  <section className="stats four">
   <article><small>Total customers</small><strong>{rows.length}</strong></article>
   <article><small>Active</small><strong>{active}</strong></article>
   <article><small>Needs review</small><strong>{suspended+banned}</strong></article>
   <article><small>Customer credit</small><strong>${(totalCredit/100).toFixed(2)}</strong></article>
  </section>

  <div className="customerControlBar">
   <input className="searchInput" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search customer, username, email, number, company, phone…"/>
   <select value={status} onChange={e=>setStatus(e.target.value)} aria-label="Customer status"><option value="all">All states</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="banned">Banned</option></select>
   <select value={sort} onChange={e=>setSort(e.target.value)} aria-label="Sort customers"><option value="recent">Newest first</option><option value="name">Name A–Z</option><option value="credit">Highest credit</option></select>
  </div>

  <section className="panel">
   <div className="panelTitle"><div><h2>Customer records</h2><p className="muted">{loading?"Loading customers…":`${filtered.length} of ${rows.length} customers shown. Open a record for billing, licences, support, mail, notes, security and history.`}</p></div></div>
   <div className="customerRecordList">
    {filtered.map(u=>{const cents=balanceFor(u.id),state=String(u.status||"active"),name=u.name||u.display_name||`${u.first_name||""} ${u.last_name||""}`.trim()||u.username||u.id;return <div className="customerRecord" key={u.customer_id||u.id}>
     <Link className="customerRecordMain" href={`/admin/customers/${u.id}`}><b>{name}</b><span>{u.email||"No email"}{u.username?` · @${u.username}`:""}{u.customer_number?` · ${u.customer_number}`:""}</span><span className="customerRecordSub">{u.company_name||"Personal account"} · Joined {u.created_at?new Date(u.created_at).toLocaleDateString():"—"} · {u.email_verified_at?"Verified":"Unverified"}</span></Link>
     <div className="customerRecordMetric"><small>Account</small><span className={`customerStatus ${state}`}>{label(state)}</span></div>
     <div className="customerRecordMetric"><small>Credit</small><strong>${(cents/100).toFixed(2)}</strong></div>
     <div className="inlineActions"><Link className="buttonlink small secondary" href={`/admin/customers/${u.id}`}>Open</Link>{(can("customers.password_reset")||can("customers.edit"))&&<button className="small secondary" onClick={()=>reset(u)}>Reset</button>}{role==="superadmin"&&<button className="small danger" onClick={()=>remove(u)}>Delete</button>}</div>
    </div>})}
    {!loading&&!filtered.length&&<div className="v3Empty">No customers match the current search and filters.</div>}
   </div>
  </section>

  {open&&<div className="orderModalBackdrop" onMouseDown={()=>!saving&&setOpen(false)}><section className="orderModal" onMouseDown={e=>e.stopPropagation()}><div className="panelTitle"><div><h2>Create customer</h2><p className="muted">Creates the OrbitFS customer account and emails a secure password setup link from noreply@orbitfs.cc.</p></div><button className="small secondary" onClick={()=>setOpen(false)}>Close</button></div><div className="form"><div className="two"><input value={form.first_name} onChange={e=>setForm({...form,first_name:e.target.value})} placeholder="First name *"/><input value={form.last_name} onChange={e=>setForm({...form,last_name:e.target.value})} placeholder="Last name *"/></div><input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="Email address *"/><div className="two"><input value={form.company_name} onChange={e=>setForm({...form,company_name:e.target.value})} placeholder="Company"/><input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="Phone"/></div><input value={form.address_line1} onChange={e=>setForm({...form,address_line1:e.target.value})} placeholder="Address line 1"/><input value={form.address_line2} onChange={e=>setForm({...form,address_line2:e.target.value})} placeholder="Address line 2"/><div className="two"><input value={form.city} onChange={e=>setForm({...form,city:e.target.value})} placeholder="City"/><input value={form.state_region} onChange={e=>setForm({...form,state_region:e.target.value})} placeholder="State / region"/></div><div className="two"><input value={form.postal_code} onChange={e=>setForm({...form,postal_code:e.target.value})} placeholder="Postcode"/><input value={form.country_code} onChange={e=>setForm({...form,country_code:e.target.value.toUpperCase()})} placeholder="Country code"/></div><div className="two"><input value={form.timezone} onChange={e=>setForm({...form,timezone:e.target.value})} placeholder="Timezone"/><input value={form.currency} onChange={e=>setForm({...form,currency:e.target.value.toUpperCase()})} placeholder="Currency"/></div><button disabled={saving||!form.first_name||!form.last_name||!form.email} onClick={create}>{saving?"Creating…":"Create customer & send password setup"}</button></div></section></div>}
  {msg&&<p className="inlineStatus">{msg}</p>}
 </main>;
}
