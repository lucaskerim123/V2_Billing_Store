"use client";

import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import {RemoteStaffAdmin} from "@/modules/mail-configuration/remote-staff-admin";
import type {RemoteStaffState,RemoteStaffSyncResult} from "@/modules/mail-configuration/remote-staff-types";

export default function RemoteStaffSyncPanel(){
  const sb=useMemo(()=>createClient(),[]);
  const [staff,setStaff]=useState<RemoteStaffState[]>([]);
  const [message,setMessage]=useState("");
  const [loading,setLoading]=useState(true);
  async function headers(){
    const {data:{session}}=await sb.auth.getSession();
    if(!session?.access_token)throw new Error("Administrator session expired. Sign in again.");
    return {authorization:`Bearer ${session.access_token}`};
  }
  async function load(){
    setLoading(true);
    try{
      const response=await fetch("/api/admin/mail/remote-staff",{headers:await headers(),cache:"no-store"});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"Could not load Remote Staff.");
      setStaff(data.staff||[]);
    }catch(error){setMessage(error instanceof Error?error.message:"Could not load Remote Staff.");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load()},[]);
  async function action(actionName:"sync"|"terminate",person:RemoteStaffState){
    const response=await fetch("/api/admin/mail/remote-staff",{
      method:"POST",headers:{"content-type":"application/json",...await headers()},
      body:JSON.stringify({action:actionName,external_user_id:person.external_user_id})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"Remote Staff operation failed.");
    if(actionName==="sync"){if(data.result?.skipped)throw new Error(data.result.reason||"Remote Staff sync is not configured.");return data.result as RemoteStaffSyncResult;}
    await load();
  }
  if(loading)return <section className="panel"><h2>Remote Staff</h2><p className="muted">Loading Billing employee records…</p></section>;
  return <section className="panel">
    <div className="panelTitle"><div><p className="eyebrow">DELEGATED ACCESS</p><h2>Remote Staff synchronisation</h2><p className="muted">Billing remains the source of truth for employees, roles, groups and departments. Mail System applies only the mappings and capability ceilings approved for this External System.</p></div><button type="button" className="secondary" onClick={()=>void load()}>Refresh</button></div>
    <RemoteStaffAdmin staff={staff} canManage onSync={person=>action("sync",person) as Promise<RemoteStaffSyncResult>} onTerminate={person=>action("terminate",person).then(()=>undefined)}/>
    {message&&<p role="status" className="muted">{message}</p>}
  </section>;
}
