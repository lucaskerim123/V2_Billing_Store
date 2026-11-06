"use client";
import {useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";
import styles from "./CustomerStaffAccess.module.css";

const WORK_TYPES=[["casual","Casual"],["part_time","Part-time"],["full_time","Full-time"],["contractor","Contractor"],["temporary","Temporary"]];
export default function CustomerStaffAccess({userId}:{userId:string}){
 const [sb]=useState(()=>createClient()),[snapshot,setSnapshot]=useState<any>(null),[draft,setDraft]=useState<any>({group_ids:[],employment_type:"full_time",title:"",staff_notes:"",status:"active"}),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const load=useCallback(async()=>{
  const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)return;
  const r=await fetch("/api/admin/staff",{headers:{Authorization:`Bearer ${session.access_token}`},cache:"no-store"});
  const j=await r.json().catch(()=>({}));if(!r.ok){setMessage(j.error||"Staff information unavailable.");return}
  setSnapshot(j);const member=(j.members||[]).find((m:any)=>m.user_id===userId);
  setDraft(member?{...member,group_ids:member.group_ids||[],employment_type:member.employment_type||"full_time"}:{group_ids:[],employment_type:"full_time",title:"",staff_notes:"",status:"active"});
 },[sb,userId]);
 useEffect(()=>{void load()},[load]);
 const groups:any[]=snapshot?.groups||[],member=(snapshot?.members||[]).find((m:any)=>m.user_id===userId),canManage=Boolean(snapshot?.can?.manage||snapshot?.can?.permissionAdmin),canAdd=Boolean(snapshot?.can?.invite||snapshot?.can?.permissionAdmin);
 async function save(remove=false){
  if(busy)return;const groupIds=draft.group_ids||[];
  if(!remove&&!groupIds.length){setMessage("Select at least one staff group.");return}
  setBusy(true);const {data:{session}}=await sb.auth.getSession();
  if(!session?.access_token){setMessage("Session expired.");setBusy(false);return}
  const body=remove?{action:"member.remove",user_id:userId}:{action:"member.save",existing_user_id:userId,title:draft.title||"",staff_notes:draft.staff_notes||"",status:draft.status||"active",employment_type:draft.employment_type||"full_time",group_ids:groupIds};
  const r=await fetch("/api/admin/staff",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));setBusy(false);setMessage(r.ok?(remove?"Staff status removed. Customer account retained.":"Customer employment and staff access updated."):(j.error||"Unable to update staff details."));
  if(r.ok)await load();
 }
 function toggleGroup(id:string){setDraft((v:any)=>({...v,group_ids:(v.group_ids||[]).includes(id)?v.group_ids.filter((x:string)=>x!==id):[...(v.group_ids||[]),id]}))}
 return <section className={styles.card}>
  <div className={styles.heading}><div><h2>Employment & staff access</h2><p>Manage this customer's employee status, work type and staff permissions here.</p></div><Link href="/admin/settings/staff/members">Employee list ↗</Link></div>
  {!snapshot?<p>{message||"Loading staff groups…"}</p>:<>
   <div className={styles.status}><strong>{member?(member.status==="active"?"Current employee":"Employee access disabled"):"Customer only"}</strong><span>{member?((member.group_names||[]).join(" · ")||"No staff group"):"Not currently an employee"}</span></div>
   {(member?canManage:canAdd)?<div className={styles.form}>
    <label>Employment status<select value={member?(draft.status||"active"):"not_employee"} onChange={e=>setDraft((v:any)=>({...v,status:e.target.value}))}><option value="not_employee" disabled>Not an employee</option><option value="active">Employee</option><option value="disabled">Employee access disabled</option></select></label>
    <label>Work type<select value={draft.employment_type||"full_time"} onChange={e=>setDraft((v:any)=>({...v,employment_type:e.target.value}))}>{WORK_TYPES.map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label>
    <label>Job title<input value={draft.title||""} onChange={e=>setDraft((v:any)=>({...v,title:e.target.value}))} placeholder="e.g. Support Agent"/></label>
    <div className={styles.groups}><strong>Staff user group</strong>{groups.map(g=><label key={g.id}><input type="checkbox" disabled={g.slug==="superadmin"&&!snapshot?.can?.permissionAdmin} checked={(draft.group_ids||[]).includes(g.id)} onChange={()=>toggleGroup(g.id)}/><span>{g.name}</span></label>)}</div>
    <label>Private employee notes<textarea rows={3} value={draft.staff_notes||""} onChange={e=>setDraft((v:any)=>({...v,staff_notes:e.target.value}))}/></label>
    <div className={styles.actions}><button type="button" disabled={busy||!(draft.group_ids||[]).length} onClick={()=>void save()}>{busy?"Saving…":member?"Save employment details":"Set as employee"}</button>{member&&<button type="button" className={styles.remove} disabled={busy} onClick={()=>{if(window.confirm("Remove this customer's employee access? Their customer account remains active."))void save(true)}}>Remove employee status</button>}</div>
   </div>:<p className={styles.message}>You do not have permission to change employment or staff access.</p>}
  </>}
  {message&&<p role="status" className={styles.message}>{message}</p>}
 </section>
}
