"use client";
import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

const workType=(value:string)=>({casual:"Casual",part_time:"Part-time",full_time:"Full-time",contractor:"Contractor",temporary:"Temporary"} as Record<string,string>)[value]||"Not set";
export default function StaffMembers(){
 const sb=createClient();
 const [data,setData]=useState<any>({members:[],groups:[],can:{}}),[q,setQ]=useState(""),[status,setStatus]=useState("all"),[msg,setMsg]=useState(""),[loading,setLoading]=useState(true);
 async function load(){
  setLoading(true);const {data:{session}}=await sb.auth.getSession();
  const headers=session?.access_token?{Authorization:`Bearer ${session.access_token}`}:{};
  const r=await fetch("/api/admin/staff",{headers,cache:"no-store"});const j=await r.json().catch(()=>({}));setLoading(false);
  if(!r.ok){setMsg(j.error||"Unable to load employee list.");return}setData(j);
 }
 useEffect(()=>{void load()},[]);
 const members=data.members||[];
 const filtered=useMemo(()=>members.filter((m:any)=>{
  const text=`${m.display_name||""} ${m.email||""} ${m.title||""} ${(m.group_names||[]).join(" ")} ${m.customer_number||""}`.toLowerCase();
  return (!q.trim()||text.includes(q.toLowerCase()))&&(status==="all"||m.status===status);
 }),[members,q,status]);
 if(loading)return <main className="adminShell"><div className="adminGate">Loading employees…</div></main>;
 return <main className="adminShell staffSystemV2">
  <header className="staffSystemHeader"><div><p className="eyebrow">STAFF SYSTEM</p><h1>Employees</h1><p className="muted">Employee records are managed from each customer's profile. This page is the current employee directory.</p></div><div className="staffSystemHeaderActions"><Link href="/admin/settings/staff">Overview</Link>{data.can?.groupsView&&<Link href="/admin/settings/staff/groups">Staff groups & permissions</Link>}</div></header>
  <section className="staffSystemStats"><article><small>Current employees</small><strong>{members.filter((m:any)=>m.status==="active").length}</strong></article><article><small>Disabled employee access</small><strong>{members.filter((m:any)=>m.status==="disabled").length}</strong></article><article><small>Staff groups</small><strong>{data.groups?.length||0}</strong></article></section>
  <section className="panel staffMemberPanel"><div className="staffCardHead"><div><h2>Employee directory</h2><p className="muted">{members.length} employee record{members.length===1?"":"s"}. Open a customer to change employment details or staff group.</p></div></div>
   <div className="staffToolbar"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search name, email, customer ID or group…"/><select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All employees</option><option value="active">Current employees</option><option value="disabled">Disabled access</option></select></div>
   <div className="staffMemberRows">{filtered.length?filtered.map((m:any)=><article className="staffMemberRow" key={m.user_id}>
    <div className="staffIdentity"><b>{m.display_name||m.email||m.user_id}</b><span>{m.email||"No email"}</span><small>{m.customer_number||"Customer account"}</small></div>
    <div className="staffRoleSummary"><b>{(m.group_names||[]).join(" · ")||"No staff group"}</b><span>{(m.effective_permissions||[]).filter((x:string)=>x!=="all").length} permissions</span></div>
    <div className="staffMetaSummary"><b>{m.title||"Employee"}</b><span>{workType(m.employment_type)}</span><span className={`staffStatusPill ${m.status}`}>{m.status==="active"?"Current employee":"Disabled"}</span></div>
    <div className="staffMemberActions"><Link className="secondary" href={`/admin/customers/${m.user_id}`}>Open customer</Link></div>
   </article>):<div className="staffEmpty">No employees match this filter.</div>}</div>
  </section>
  {msg&&<div className="staffSystemMessage">{msg}</div>}
 </main>
}
