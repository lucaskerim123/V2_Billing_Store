"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { createSupabaseMailModuleStore } from "../../Data/supabase-store";
import { MailModuleConsole } from "../../Data/console";

type Props = { integration?: { id: string; name: string; version: string } };

export default function MailSettingsPage({ integration }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const store = useMemo(() => createSupabaseMailModuleStore(supabase as any), [supabase]);

  const [discovered, setDiscovered] = useState<{key:string;name:string;category:string;sender:string|null;status:string}[]>([]);
  const [discoveryMessage, setDiscoveryMessage] = useState("Detecting application email events…");
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
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
      setDiscoveryMessage(result.connection?.connected ? "Detected events and suggested routes. Imported mappings remain inactive until delivery is configured." : result.connection?.message || "Connect the Mail System first.");
    } catch(error) {
      setDiscoveryMessage(error instanceof Error ? error.message : "Mail discovery failed.");
    } finally {setDiscoveryBusy(false);}
  },[supabase]);
  useEffect(()=>{void refreshDiscovery();},[refreshDiscovery]);

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
    <section aria-label="Automatic configuration" style={{marginBottom:24}}>
      <h2>Automatic configuration</h2>
      <p role="status">{discoveryMessage}</p>
      <button type="button" disabled={discoveryBusy} onClick={()=>void refreshDiscovery()}> {discoveryBusy ? "Discovering…" : "Rescan and configure"} </button>
      {discovered.length>0 && <details open>
        <summary>{discovered.length} detected events · {discovered.filter(event=>event.status!=="configured").length} require review</summary>
        <table style={{width:"100%",textAlign:"left",marginTop:12}}>
          <thead><tr><th>Event</th><th>Category</th><th>Sender</th><th>Configuration</th></tr></thead>
          <tbody>{discovered.map(event=><tr key={event.key}><td>{event.name}</td><td>{event.category}</td><td>{event.sender || "No unambiguous mailbox"}</td><td>{event.status==="configured"?"Mapping saved":event.status==="needs_sender"?"Select mailbox":event.status==="needs_template"?"Template missing":"Ready to configure"}</td></tr>)}</tbody>
        </table>
      </details>}
    </section>
    <MailModuleConsole store={store} onTestConnection={onTestConnection} canManage />
  </main>;
}
