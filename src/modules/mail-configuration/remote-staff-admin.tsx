"use client";

import { useState } from "react";
import type { RemoteStaffState, RemoteStaffSyncResult } from "./remote-staff-types";

export type RemoteStaffAdminProps = {
  staff: RemoteStaffState[];
  onSync: (staff: RemoteStaffState) => Promise<RemoteStaffSyncResult>;
  onTerminate: (staff: RemoteStaffState) => Promise<void>;
  canManage: boolean;
};

export function RemoteStaffAdmin({ staff, onSync, onTerminate, canManage }: RemoteStaffAdminProps) {
  const [busy,setBusy] = useState("");
  const [message,setMessage] = useState("");
  async function run(id:string, action:()=>Promise<unknown>, success:string) {
    setBusy(id);setMessage("");
    try { await action();setMessage(success); }
    catch(error) { setMessage(error instanceof Error?error.message:"Remote Staff operation failed."); }
    finally { setBusy(""); }
  }
  return <section aria-label="Remote Staff synchronization">
    <header><h2>Remote Staff</h2><p>Synchronize employment status and role assignments with Mail System.</p></header>
    {message&&<p role="status">{message}</p>}
    <div style={{display:"grid",gap:10}}>
      {staff.map(person=><article key={person.external_user_id} style={{border:"1px solid #d9e0ea",borderRadius:10,padding:14}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
          <div><strong>{person.display_name||person.external_user_id}</strong><div>{person.email||"No email"} · {person.external_user_id}</div><small>{person.status}</small></div>
          <div style={{display:"flex",gap:8}}>
            <button type="button" disabled={!canManage||!!busy} onClick={()=>void run(person.external_user_id,()=>onSync(person),"Staff access recalculated.")}>Sync access</button>
            <button type="button" disabled={!canManage||!!busy||person.status==="terminated"||person.status==="active"} onClick={()=>{if(window.confirm("Terminate this Remote User and revoke Mail System access?"))void run(person.external_user_id,()=>onTerminate(person),"Remote User terminated and sessions revoked.");}}>Terminate</button>
          </div>
        </div>
      </article>)}
      {!staff.length&&<p>No Remote Staff records were supplied by the host application.</p>}
    </div>
  </section>;
}
