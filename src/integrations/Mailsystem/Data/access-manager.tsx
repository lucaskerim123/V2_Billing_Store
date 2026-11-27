"use client";
import { useEffect, useState } from "react";
type Row = Record<string, any>;

export function MailAccessManager({ onLoad }: {
  onLoad: () => Promise<any>;
  onSave: (body: any) => Promise<any>;
  canManage?: boolean;
}) {
  const [data,setData]=useState<any>(null);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState("");
  async function load(){
    setBusy(true);setStatus("");
    try{const result=await onLoad();setData(result);if(result.sync?.ok===false)setStatus("Some users could not sync. Check Integration Manager.");}
    catch(e){setStatus(e instanceof Error?e.message:"Could not load directory.");}
    finally{setBusy(false);}
  }
  useEffect(()=>{void load();},[]);
  const directory=data?.directory||{},core=data?.core||{};
  const users:Row[]=directory.users||[];
  return <section className="panel mail-admin-card">
    <h3>Mail System connection and users</h3>
    <p>Manage mailbox access and administrator permissions in Mail System. Billing Store only supplies the staff directory.</p>
    <button type="button" disabled={busy} onClick={()=>void load()}>Refresh directory</button>
    {status&&<p role="status">{status}</p>}
    <p>{users.length} staff · {(directory.groups||[]).length} groups · {(directory.departments||[]).length} departments</p>
    <div className="mail-admin-list">{users.map(user=>{
      const remote=(core.remoteUsers||[]).find((r:Row)=>r.external_user_id===user.id);
      return <div className="mail-admin-row" key={user.id}><span><strong>{user.display_name}</strong><small>{user.email}</small></span><span>{remote?.status||"Not synced"}</span></div>;
    })}</div>
  </section>;
}
