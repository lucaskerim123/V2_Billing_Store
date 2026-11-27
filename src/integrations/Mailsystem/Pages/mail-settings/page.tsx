"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { createSupabaseMailModuleStore } from "../../Data/supabase-store";
import { MailModuleConsole } from "../../Data/console";

type Props = { integration?: { id: string; name: string; version: string } };

export default function MailSettingsPage({ integration }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const store = useMemo(() => createSupabaseMailModuleStore(supabase as any), [supabase]);

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
    return result;
  }, [supabase]);

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
    <MailModuleConsole store={store} onTestConnection={onTestConnection} canManage />
  </main>;
}
