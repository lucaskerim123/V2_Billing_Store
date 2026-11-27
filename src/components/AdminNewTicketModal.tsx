"use client";

import {useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {createClient} from "@/lib/supabase";
import "@/app/admin/support-system-v2.css";

type Props={open:boolean;onClose:()=>void};

export default function AdminNewTicketModal({open,onClose}:Props){
 const sb=useMemo(()=>createClient(),[]);
 const router=useRouter();
 const [customers,setCustomers]=useState<any[]>([]);
 const [departments,setDepartments]=useState<any[]>([]);
 const [orders,setOrders]=useState<any[]>([]);
 const [customerId,setCustomerId]=useState("");
 const [departmentId,setDepartmentId]=useState("");
 const [orderId,setOrderId]=useState("");
 const [priority,setPriority]=useState("normal");
 const [subject,setSubject]=useState("");
 const [body,setBody]=useState("");
 const [q,setQ]=useState("");
 const [busy,setBusy]=useState(false);
 const [msg,setMsg]=useState("");

 useEffect(()=>{
  if(!open)return;
  let active=true;
  (async()=>{
   const [p,c,d]=await Promise.all([
    sb.from("user_profiles").select("id,display_name,first_name,last_name,company_name,status").order("display_name"),
    sb.from("customers").select("auth_user_id,customer_number,email"),
    sb.rpc("support_staff_departments")
   ]);
   if(!active)return;
   const cm=new Map((c.data||[]).map((x:any)=>[x.auth_user_id,x]));
   setCustomers((p.data||[]).map((x:any)=>({...x,...(cm.get(x.id)||{})})).filter((x:any)=>x.status!=="deleted"));
   if(d.error)setMsg(d.error.message);
   const allowed=(d.data||[]).filter((x:any)=>x.allow_direct_create!==false);
   setDepartments(allowed);
   if(allowed[0])setDepartmentId((current:string)=>current||allowed[0].id);
  })();
  return()=>{active=false};
 },[open,sb]);

 useEffect(()=>{
  setOrderId("");
  if(!open||!customerId){setOrders([]);return}
  let active=true;
  (async()=>{
   const {data}=await sb.from("orders").select("id,order_number,status,total_cents,currency,created_at").eq("auth_user_id",customerId).order("created_at",{ascending:false}).limit(50);
   if(active)setOrders(data||[]);
  })();
  return()=>{active=false};
 },[customerId,open,sb]);

 useEffect(()=>{
  if(!open)return;
  const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape"&&!busy)onClose()};
  document.addEventListener("keydown",onKey);
  return()=>document.removeEventListener("keydown",onKey);
 },[open,busy,onClose]);

 const visible=useMemo(()=>{
  const search=q.trim().toLowerCase();
  if(!search)return customers.slice(0,30);
  return customers.filter((x:any)=>`${x.display_name||""} ${x.first_name||""} ${x.last_name||""} ${x.email||""} ${x.customer_number||""} ${x.company_name||""}`.toLowerCase().includes(search)).slice(0,50);
 },[customers,q]);
 const selected=customers.find(x=>x.id===customerId);

 async function create(){
  if(!customerId||!departmentId||!subject.trim()||!body.trim()){
   setMsg("Customer, department, subject and opening message are required.");
   return;
  }
  setBusy(true);setMsg("Creating support ticket…");
  const {data,error}=await sb.rpc("admin_create_support_ticket",{
   p_user_id:customerId,
   p_department_id:departmentId,
   p_subject:subject.trim(),
   p_priority:priority,
   p_body:body.trim(),
   p_related_order_id:orderId||null
  });
  if(error){setBusy(false);setMsg(error.message);return}
  const {data:{session}}=await sb.auth.getSession();
  if(session?.access_token){
   await fetch("/api/mail/support-event",{
    method:"POST",
    headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"},
    body:JSON.stringify({ticketId:data.id,eventKey:"support.ticket.created"})
   }).catch(()=>null);
  }
  onClose();
  router.push(`/admin/support/${data.id}`);
 }

 if(!open)return null;
 return <div className="adminTicketModalBackdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose()}}>
  <section className="adminTicketModal" role="dialog" aria-modal="true" aria-labelledby="adminTicketModalTitle">
   <header className="adminTicketModalHeader">
    <div><p className="eyebrow">SUPPORT DESK</p><h2 id="adminTicketModalTitle">New Ticket</h2><p className="muted">Create a customer support case without leaving the ticket queue.</p></div>
    <button type="button" className="secondary" onClick={onClose} disabled={busy} aria-label="Close new ticket">✕</button>
   </header>
   <div className="supportCreateGrid">
    <section className="panel">
     <div className="panelTitle"><div><h3>1. Customer</h3><p className="muted">Search by customer name, email, company or OrbitFS customer ID.</p></div>{selected&&<span>{selected.customer_number||"Customer"}</span>}</div>
     <input className="searchInput" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search customers…"/>
     <div className="supportCustomerPicker">{visible.map((x:any)=>{
      const name=x.display_name||[x.first_name,x.last_name].filter(Boolean).join(" ")||x.email||"Customer";
      return <button type="button" className={customerId===x.id?"active":""} key={x.id} onClick={()=>setCustomerId(x.id)}><span><b>{name}</b><small>{x.email||"No email"}{x.company_name?` · ${x.company_name}`:""}</small></span><em>{x.customer_number||"—"}</em></button>;
     })}</div>
    </section>
    <section className="panel">
     <div className="panelTitle"><div><h3>2. Ticket details</h3><p className="muted">Choose an intake department and link an order when relevant.</p></div></div>
     {!departments.length?<div className="notice"><b>No intake departments available</b><span>Support workers must be assigned to at least one direct-start department. Advanced departments cannot be selected when opening a ticket.</span></div>:<div className="form compactForm">
      <div className="two">
       <label>Department<select value={departmentId} onChange={e=>setDepartmentId(e.target.value)}>{departments.map((d:any)=><option value={d.id} key={d.id}>{d.name}</option>)}</select><small>{departments.find((d:any)=>d.id===departmentId)?.description||"Support queue"}</small></label>
       <label>Priority<select value={priority} onChange={e=>setPriority(e.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
      </div>
      <label>Associated order <span className="muted">(optional)</span><select value={orderId} onChange={e=>setOrderId(e.target.value)} disabled={!customerId}><option value="">No order selected</option>{orders.map((o:any)=><option value={o.id} key={o.id}>#{o.order_number} · {o.status} · {(Number(o.total_cents||0)/100).toLocaleString("en-AU",{style:"currency",currency:o.currency||"AUD"})}</option>)}</select></label>
      <label>Subject<input value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Short description of the issue"/></label>
      <label>Opening message<textarea rows={7} value={body} onChange={e=>setBody(e.target.value)} placeholder="Write the first customer-visible support message…"/></label>
      <div className="notice"><b>Created by staff</b><span>The customer will see this as a normal support ticket in their portal. Source, creator and ticket history remain audit logged.</span></div>
      <button type="button" onClick={()=>void create()} disabled={busy||!customerId||!departmentId||!subject.trim()||!body.trim()}>{busy?"Creating…":"Create support ticket"}</button>
      {msg&&<p className="inlineStatus" role="status">{msg}</p>}
     </div>}
    </section>
   </div>
  </section>
 </div>;
}
