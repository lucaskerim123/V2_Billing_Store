"use client";
import {useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";
import styles from "./CustomerStaffAccess.module.css";

const POSITION_TITLES:Record<number,string>={1:"Customer Service Representative",2:"Customer Service Officer",3:"Senior Customer Service Officer",4:"Customer Service Supervisor",5:"Customer Service Manager"};
const routingRank=(rank:number)=>rank>=4?3:rank===3?2:1;
const WORK_TYPES=[["casual","Casual"],["part_time","Part-time"],["full_time","Full-time"],["contractor","Contractor"],["temporary","Temporary"]];
export default function CustomerStaffAccess({userId}:{userId:string}){
 const [sb]=useState(()=>createClient()),[snapshot,setSnapshot]=useState<any>(null),[draft,setDraft]=useState<any>({group_ids:[],department_ids:[],department_positions:{},employment_type:"full_time",title:"",staff_notes:"",status:"active"}),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const load=useCallback(async()=>{
  const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)return;
  const r=await fetch("/api/admin/staff",{headers:{Authorization:`Bearer ${session.access_token}`},cache:"no-store"});
  const j=await r.json().catch(()=>({}));if(!r.ok){setMessage(j.error||"Staff information unavailable.");return}
  setSnapshot(j);const member=(j.members||[]).find((m:any)=>m.user_id===userId);
  setDraft(member?{...member,group_ids:member.group_ids||[],department_ids:member.department_ids||[],department_positions:member.department_positions||{},employment_type:member.employment_type||"full_time"}:{group_ids:[],department_ids:[],department_positions:{},employment_type:"full_time",title:"",staff_notes:"",status:"active"});
 },[sb,userId]);
 useEffect(()=>{void load()},[load]);
 const groups:any[]=snapshot?.groups||[],member=(snapshot?.members||[]).find((m:any)=>m.user_id===userId),canManage=Boolean(snapshot?.can?.manage||snapshot?.can?.permissionAdmin),canAdd=Boolean(snapshot?.can?.invite||snapshot?.can?.permissionAdmin);
 const selectedRanks=groups.filter(g=>(draft.group_ids||[]).includes(g.id)).map(g=>Number(g.rank||0));
 const scopedRanks=selectedRanks.filter(rank=>rank>=1&&rank<=5).sort((a,b)=>a-b);
 const globalAccess=selectedRanks.some(rank=>[6,7,9].includes(rank));
 const departments:any[]=snapshot?.departments||[];
 function setDepartmentPosition(id:string,rank:number){setDraft((v:any)=>{const positions={...(v.department_positions||{})};const ids=new Set<string>(v.department_ids||[]);if(rank){positions[id]=rank;ids.add(id)}else{delete positions[id];ids.delete(id)}return {...v,department_ids:[...ids],department_positions:positions}})}
 async function save(remove=false){
  if(busy)return;const groupIds=draft.group_ids||[];
  if(!remove&&!groupIds.length){setMessage("Select at least one staff group.");return}
  const departmentIds:string[]=draft.department_ids||[];
  const departmentPositions:Record<string,number>={};
  for(const id of departmentIds){const rank=Number(draft.department_positions?.[id]||0);if(rank&&scopedRanks.includes(rank))departmentPositions[id]=rank;}
  if(!remove&&!globalAccess&&scopedRanks.length&&(!departmentIds.length||departmentIds.some(id=>!departmentPositions[id]))){setMessage("Choose an eligible position for every assigned department.");return}
  setBusy(true);const {data:{session}}=await sb.auth.getSession();
  if(!session?.access_token){setMessage("Session expired.");setBusy(false);return}
  const body=remove?{action:"member.remove",user_id:userId}:{action:"member.save",existing_user_id:userId,title:draft.title||"",staff_notes:draft.staff_notes||"",status:draft.status||"active",employment_type:draft.employment_type||"full_time",group_ids:groupIds,department_ids:departmentIds,department_positions:departmentPositions,primary_group_id:groupIds.includes(draft.primary_group_id)?draft.primary_group_id:groupIds[0],primary_department_id:departmentIds.includes(draft.primary_department_id)?draft.primary_department_id:departmentIds[0]};
  const r=await fetch("/api/admin/staff",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));setBusy(false);setMessage(r.ok?(remove?"Staff status removed. Customer account retained.":j.pending?(j.message||"Invitation sent; staff access activates after acceptance."):"Customer employment and staff access updated."):(j.error||"Unable to update staff details."));
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
    <label>Job title<input value={draft.title||""} onChange={e=>setDraft((v:any)=>({...v,title:e.target.value}))} placeholder="e.g. Customer Service Officer"/></label>
    <div className={styles.groups}><strong>Staff user group</strong>{groups.map(g=><label key={g.id}><input type="checkbox" disabled={g.slug==="superadmin"&&!snapshot?.can?.permissionAdmin} checked={(draft.group_ids||[]).includes(g.id)} onChange={()=>toggleGroup(g.id)}/><span>{g.name}</span></label>)}</div>
    <div className={styles.groups}><strong>Department positions</strong>
      {globalAccess&&<p>Operations Manager, Senior Customer Service Manager and Chief Executive Officer have cross-department authority. Department-specific positions can also be recorded.</p>}
      {!scopedRanks.length&&!globalAccess&&<p>Select a departmental staff group to assign a department position.</p>}
      {departments.map(d=>{const eligible=scopedRanks.filter(rank=>routingRank(rank)>=Number(d.min_support_rank||1));const assigned=(draft.department_ids||[]).includes(d.id);const rank=Number(draft.department_positions?.[d.id]||0);return <label key={d.id}><span>{d.name}</span><select aria-label={"Position in "+d.name} value={rank|| (assigned?"legacy":"0")} onChange={e=>setDepartmentPosition(d.id,Number(e.target.value))} disabled={busy}><option value="0">Not assigned</option>{assigned&&!rank&&<option value="legacy" disabled>Existing assignment — choose position</option>}{rank&&!eligible.includes(rank)&&<option value={rank} disabled>Position no longer eligible — change</option>}{eligible.map(n=><option key={n} value={n}>{POSITION_TITLES[n]}{n>=4?" of "+d.name:""}</option>)}</select></label>})}
      {scopedRanks.length>0&&!globalAccess&&<small>Tier 3 or higher is required for advanced departments. Assign different positions to individual departments as needed.</small>}
    </div>
    <label>Private employee notes<textarea rows={3} value={draft.staff_notes||""} onChange={e=>setDraft((v:any)=>({...v,staff_notes:e.target.value}))}/></label>
    <div className={styles.actions}><button type="button" disabled={busy||!(draft.group_ids||[]).length} onClick={()=>void save()}>{busy?"Saving…":member?"Save employment details":"Set as employee"}</button>{member&&<button type="button" className={styles.remove} disabled={busy} onClick={()=>{if(window.confirm("Remove this customer's employee access? Their customer account remains active."))void save(true)}}>Remove employee status</button>}</div>
   </div>:<p className={styles.message}>You do not have permission to change employment or staff access.</p>}
  </>}
  {message&&<p role="status" className={styles.message}>{message}</p>}
 </section>
}
