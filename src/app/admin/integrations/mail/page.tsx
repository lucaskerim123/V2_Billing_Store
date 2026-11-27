"use client";

import Link from "next/link";
import {useCallback,useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import {createSupabaseMailModuleStore} from "@/integrations/mail/supabase-store";
import {MailModuleConsole} from "@/integrations/mail/console";
import {RemoteStaffAdmin} from "@/integrations/mail/remote-staff-admin";
import type {RemoteStaffState,RemoteStaffSyncResult} from "@/integrations/mail/remote-staff-types";

export default function BillingMailIntegrationPage(){
  const sb=useMemo(()=>createClient(),[]);
  const store=useMemo(()=>createSupabaseMailModuleStore(sb),[sb]);
  const [canManage,setCanManage]=useState(false);
  const [installed,setInstalled]=useState(false);
  const [enabled,setEnabled]=useState(false);
  const [staff,setStaff]=useState<RemoteStaffState[]>([]);
  const [staffError,setStaffError]=useState("");
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState("");

  const headers=useCallback(async()=>{
    const {data:{session}}=await sb.auth.getSession();
    if(!session?.access_token)throw new Error("Administrator session expired.");
    return {authorization:`Bearer ${session.access_token}`,"content-type":"application/json"};
  },[sb]);

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const response=await fetch("/api/admin/integrations",{headers:await headers(),cache:"no-store"});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Could not load Integration Manager.");
      const item=(data.integrations||[]).find((x:any)=>x.id==="mail");
      setCanManage(data.permissions?.canManage===true);
      setInstalled(item?.state?.installed===true);
      setEnabled(item?.state?.enabled===true);
      if(item?.state?.installed){
        try{
          const staffResponse=await fetch("/api/admin/integrations/mail/remote-staff",{headers:await headers(),cache:"no-store"});
          const staffData=await staffResponse.json();
          if(!staffResponse.ok)throw new Error(staffData.error||"Remote Staff access unavailable.");
          setStaff(staffData.staff||[]);
          setStaffError("");
        }catch(error:any){setStaff([]);setStaffError(error?.message||"Remote Staff access unavailable.");}
      }
    }catch(error:any){setMessage(error?.message||"Could not load Mail integration.");}
    finally{setLoading(false);}
  },[headers]);

  useEffect(()=>{void load()},[load]);

  const testConnection=useCallback(async()=>{
    const response=await fetch("/api/admin/integrations/mail/test",{method:"POST",headers:await headers()});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"Mail connection test failed.");
    return data;
  },[headers]);

  async function remoteAction(action:"sync"|"terminate",person:RemoteStaffState){
    const response=await fetch("/api/admin/integrations/mail/remote-staff",{method:"POST",headers:await headers(),body:JSON.stringify({action,external_user_id:person.external_user_id})});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"Remote Staff operation failed.");
    await load();
    return data.result as RemoteStaffSyncResult;
  }

  if(loading)return <main style={{maxWidth:1120,margin:"0 auto",padding:24}}>Loading Mail integration…</main>;
  if(!installed)return <main style={{maxWidth:1120,margin:"0 auto",padding:24}}>
    <p><Link href="/admin/integrations">← Integration Manager</Link></p>
    <h1>Mail System</h1>
    <p>The Mail integration is not installed. Install it from Integration Manager before configuring it.</p>
  </main>;

  return <main style={{maxWidth:1180,margin:"0 auto",padding:"24px 18px 48px"}}>
    <header style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-start",flexWrap:"wrap",marginBottom:20}}>
      <div><p style={{fontSize:12,letterSpacing:1.1,opacity:.65,margin:0}}>INTEGRATIONS / MAIL SYSTEM</p><h1 style={{margin:"6px 0"}}>Mail System</h1><p style={{margin:0,opacity:.75}}>Billing-owned templates, routing, triggers and delegated Remote Staff access.</p></div>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:12,border:"1px solid var(--admin-border,#d5dbe5)",borderRadius:20,padding:"5px 9px"}}>{enabled?"Enabled":"Disabled"}</span>
        <Link href="/admin/integrations">Integration Manager</Link>
      </div>
    </header>
    {message&&<p role="alert">{message}</p>}
    <section style={{border:"1px solid var(--admin-border,#d5dbe5)",borderRadius:10,padding:16,marginBottom:18}}>
      <h2 style={{fontSize:16,marginTop:0}}>Connection credentials</h2>
      <p style={{marginBottom:0,opacity:.75}}>MAIL_SYSTEM_URL and MAIL_SYSTEM_API_KEY are read only by the Billing Store server. The API key is never sent to this page or stored in browser storage. Configure both in the Billing Store server environment, then test the connection below.</p>
    </section>
    <MailModuleConsole store={store} onTestConnection={testConnection} canManage={canManage} manageModuleState={false}/>
    <section style={{marginTop:24,border:"1px solid var(--admin-border,#d5dbe5)",borderRadius:10,padding:18}}>
      <h2 style={{marginTop:0}}>Remote Staff</h2>
      <p style={{opacity:.75}}>Billing Store remains the source of truth for staff employment status, roles, departments and groups. Mail System receives authorised staff snapshots and enforces its own mailbox capabilities.</p>
      {staffError?<p role="status">{staffError}</p>:<RemoteStaffAdmin staff={staff} canManage={canManage} onSync={person=>remoteAction("sync",person)} onTerminate={async person=>{await remoteAction("terminate",person)}}/>}
    </section>
  </main>;
}
