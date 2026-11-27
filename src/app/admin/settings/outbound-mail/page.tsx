"use client";

import {useMemo} from "react";
import {createClient} from "@/lib/supabase";
import {usePermissions} from "@/lib/usePermissions";
import {createSupabaseMailModuleStore} from "@/modules/mail-configuration/supabase-store";
import {MailModuleConsole} from "@/modules/mail-configuration/console";

export default function OutboundMailSettings(){
  const sb=useMemo(()=>createClient(),[]);
  const {can,ready}=usePermissions();
  const store=useMemo(()=>createSupabaseMailModuleStore(sb as any),[sb]);

  async function testConnection(){
    const {data:{session}}=await sb.auth.getSession();
    if(!session?.access_token)throw new Error("Administrator session expired. Sign in again.");
    const response=await fetch("/api/admin/mail/connection",{
      headers:{authorization:`Bearer ${session.access_token}`},
      cache:"no-store"
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Mail System connection check failed.");
    return result;
  }

  if(!ready)return <main className="adminShell"><p className="muted">Loading mail permissions…</p></main>;
  if(!can("communications.mail.manage"))return <main className="adminShell"><section className="panel"><h1>Outbound Mail</h1><p className="muted">You do not have permission to manage the Billing mail configuration module.</p></section></main>;

  return <main className="adminShell">
    <header className="adminTop"><div><p className="eyebrow">BILLING · INTEGRATIONS</p><h1>Outbound Mail</h1><p className="muted">Application-owned templates, sender routing, event triggers and automation, delivered through the central Mail System.</p></div></header>
    <MailModuleConsole store={store} onTestConnection={testConnection} canManage={can("communications.mail.manage")}/>
  </main>;
}
