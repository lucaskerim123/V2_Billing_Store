"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { createSupabaseMailModuleStore } from "../../Data/supabase-store";
import { MailModuleConsole } from "../../Data/console";
import { MailAccessManager } from "../../Data/access-manager";

type Props = { integration?: { id: string; name: string; version: string } };

export default function MailSettingsPage({ integration }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const store = useMemo(() => createSupabaseMailModuleStore(supabase as any), [supabase]);

  const [discovered, setDiscovered] = useState<{key:string;name:string;category:string;sender:string|null;status:string;active:boolean}[]>([]);
  const [mailboxes,setMailboxes]=useState<{id:string;address:string;kind?:string}[]>([]);
  const [category,setCategory]=useState("");
  const [bulkSender,setBulkSender]=useState("");
  const [consoleRevision,setConsoleRevision]=useState(0);
  const [tab,setTab]=useState("events");
  const [directory, setDirectory] = useState<{available:boolean;users:number;groups:number;departments:number}|null>(null);
  const [discoveryMessage, setDiscoveryMessage] = useState("Detecting application email events…");
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const request = useCallback(async (path:string,method="GET",body?:unknown)=>{
    const {data:{session}}=await supabase.auth.getSession();
    if(!session?.access_token)throw new Error("Administrator session expired.");
    const response=await fetch("/api/admin/integrations/mailsystem/"+path,{method,headers:{Authorization:"Bearer "+session.access_token,"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:"no-store"});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(typeof result.error==="string"?result.error:result.error?.message||"Mail operation failed.");
    return result;
  },[supabase]);
  const refreshDiscovery = useCallback(async (apply = true) => {
    setDiscoveryBusy(true);
    try {
      const {data:{session}} = await supabase.auth.getSession();
      if(!session?.access_token) throw new Error("Administrator session expired.");
      const endpoint = "/api/admin/integrations/mailsystem/mail-discovery";
      const headers = {Authorization: "Bearer "+session.access_token};
      let response = await fetch(endpoint,{headers,cache:"no-store"});
      let result = await response.json();
      if(!response.ok) throw new Error(result.error || "Discovery failed.");
      if(apply && result.connection?.connected && result.events?.some((event:{status:string})=>event.status==="ready_to_configure")){
        response = await fetch(endpoint,{method:"POST",headers,cache:"no-store"});
        const applied = await response.json();
        if(!response.ok) throw new Error(applied.error || "Automatic configuration failed.");
        response = await fetch(endpoint,{headers,cache:"no-store"});
        result = await response.json();
        if(!response.ok) throw new Error(result.error || "Refresh failed.");
      }
      setDiscovered(result.events || []);
      setDirectory(result.directory || null);
      setMailboxes(result.connection?.senders||[]);
      setConsoleRevision(old=>old+1);
      setDiscoveryMessage(result.connection?.connected ? "Detected events and suggested routes. Imported mappings remain inactive until delivery is configured." : result.connection?.message || "Connect the Mail System first.");
    } catch(error) {
      setDiscoveryMessage(error instanceof Error ? error.message : "Mail discovery failed.");
    } finally {setDiscoveryBusy(false);}
  },[supabase]);
  useEffect(()=>{void refreshDiscovery();},[refreshDiscovery]);

  const syncAll=useCallback(async()=>{
    setDiscoveryBusy(true);
    try{
      const result=await request("mail-directory","POST",{});
      if(result.ok===false)throw new Error("Directory sync incomplete: "+JSON.stringify(result.failures||[]));
      await refreshDiscovery();
      setDiscoveryMessage("Staff directory and email configuration synchronized.");
      return result;
    }catch(error){setDiscoveryMessage(error instanceof Error?error.message:"Synchronization failed.");throw error;}
    finally{setDiscoveryBusy(false);}
  },[request,refreshDiscovery]);
  const configure=useCallback(async(body:unknown)=>{
    setDiscoveryBusy(true);
    try{
      const result=await request("mail-discovery","PUT",body);
      await refreshDiscovery(false);
      const needsReview=(result.results||[]).filter((row:{status:string})=>["needs_review","template_variables_need_review"].includes(row.status)).length;
      setDiscoveryMessage((result.results||[]).length+" events processed. "+needsReview+" require review.");
    }catch(error){setDiscoveryMessage(error instanceof Error?error.message:"Configuration failed.");}
    finally{setDiscoveryBusy(false);}
  },[request,refreshDiscovery]);
  const loadAccess=useCallback(()=>request("mail-access"),[request]);
  const saveAccess=useCallback((body:unknown)=>request("mail-access","PUT",body),[request]);

  const onTestConnection = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Administrator session expired. Sign in again.");
    const response = await fetch("/api/admin/integrations/mailsystem/mail-connection", {
      method: "POST",
      headers: { Authorization: "Bearer " + session.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "test" }),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || result.message || "Mail System connection test failed.");
    if(result.connected) await refreshDiscovery();
    return result;
  }, [supabase, refreshDiscovery]);

  return <main style={{ maxWidth: 1180, margin: "0 auto", padding: 24, color: "var(--admin-text,inherit)" }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 22 }}>
      <div>
        <p style={{ fontSize: 12, letterSpacing: 1.1, opacity: .65 }}>SYSTEM / INTEGRATIONS / MAIL SYSTEM</p>
        <h1 style={{ margin: "6px 0" }}>Mail Settings</h1>
        <p style={{ opacity: .75, margin: 0 }}>Manage templates, sender routing, event triggers and the Billing Store directory connection.</p>
        {integration && <small>{integration.name} · v{integration.version}</small>}
      </div>
      <Link href="/admin/integrations">Integration Manager · connection and lifecycle</Link>
    </header>
    <nav aria-label="Mail Settings sections" style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
      {[["events","Automated emails"],["mailboxes","Mailboxes"],["access","Users, groups & departments"],["templates","Templates & advanced settings"]].map(([id,label])=><button key={id} type="button" aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}
    </nav>
    <button type="button" disabled={discoveryBusy} onClick={()=>void syncAll().catch(()=>{})}>Sync now</button>
    {tab==="events"&&<section aria-label="Automatic configuration" style={{marginBottom:24}}>
      <h2>Automatic configuration</h2>
      <p role="status">{discoveryMessage}</p>
      {directory?.available ? <p>Detected {directory.users} staff members · {directory.groups} staff groups · {directory.departments} departments.</p> : directory && <p>Staff directory unavailable; no access changes have been made.</p>}
      <button type="button" disabled={discoveryBusy} onClick={()=>void refreshDiscovery()}> {discoveryBusy ? "Discovering…" : "Rescan and configure"} </button>
      {discovered.length>0 && <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"end"}}>
        <label>Event category<select value={category} onChange={e=>setCategory(e.target.value)}><option value="">All categories</option>{[...new Set(discovered.map(event=>event.category))].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
        <label>Sender mailbox<select value={bulkSender} onChange={e=>setBulkSender(e.target.value)}><option value="">Choose mailbox</option>{mailboxes.map(box=><option key={box.id} value={box.address}>{box.address}</option>)}</select></label>
        <button type="button" disabled={discoveryBusy||!bulkSender} onClick={()=>void configure({...(category?{category}:{all:true}),sender:bulkSender})}>Apply sender to category</button>
        <button type="button" disabled={discoveryBusy} onClick={()=>void configure({...(category?{category}:{all:true}),active:true,enableModule:true})}>Enable ready events</button>
        <button type="button" disabled={discoveryBusy} onClick={()=>void configure({...(category?{category}:{all:true}),active:false})}>Disable selected events</button>
      </div>}
      {discovered.length>0 && <details open>
        <summary>{discovered.length} detected events · {discovered.filter(event=>event.status!=="configured").length} require review</summary>
        <table style={{width:"100%",textAlign:"left",marginTop:12}}>
          <thead><tr><th>Event</th><th>Category</th><th>Sender</th><th>Configuration</th></tr></thead>
          <tbody>{discovered.filter(event=>!category||event.category===category).map(event=><tr key={event.key}><td>{event.name}</td><td>{event.category}</td><td><select aria-label={"Sender for "+event.name} value={event.sender||""} disabled={discoveryBusy} onChange={e=>{if(e.target.value)void configure({eventKey:event.key,sender:e.target.value})}}><option value="">Select mailbox</option>{mailboxes.map(box=><option key={box.id} value={box.address}>{box.address}</option>)}</select></td><td>{event.active?"Enabled":event.status==="configured"?"Configured · disabled":event.status==="needs_sender"?"Select mailbox":event.status==="needs_template"?"Template missing":"Ready to configure"}</td></tr>)}</tbody>
        </table>
      </details>}
    </section>}
    {tab==="mailboxes"&&<section><h2>Assigned mailboxes</h2><p>Mail System provisions and hosts these mailboxes. Configure access and sender routing here.</p>{["system","department","personal","shared"].map(kind=><details key={kind} open><summary>{kind[0].toUpperCase()+kind.slice(1)} · {mailboxes.filter(box=>box.kind===kind).length}</summary>{mailboxes.filter(box=>box.kind===kind).map(box=><p key={box.id}>{box.address}</p>)}</details>)}</section>}
    {tab==="access"&&<MailAccessManager onLoad={loadAccess} onSave={saveAccess} onSync={syncAll} canManage/>}
    {tab==="templates"&&<MailModuleConsole key={consoleRevision} store={store} onTestConnection={onTestConnection} canManage />}
  </main>;
}
