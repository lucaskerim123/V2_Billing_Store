"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";

type IntegrationRow = {
  id: string; name: string; description: string; version: string; route: string; installable: boolean;
  requiredEnvironment: string[]; features: string[];
  state: { installed: boolean; enabled: boolean; version: string; updated_at: string | null };
  configured: boolean; connectionConfigured?: boolean;
};
type Connection = { configured: boolean; baseUrl: string; apiKeyConfigured: boolean; remoteIdentityConfigured?: boolean };

export default function IntegrationManagerPage() {
  const sb = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [counts, setCounts] = useState({ installed: 0, installable: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [connection, setConnection] = useState<Connection>({ configured: false, baseUrl: "", apiKeyConfigured: false });
  const [connected, setConnected] = useState(false);

  const headers = useCallback(async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.access_token) throw new Error("Administrator session expired.");
    return { authorization: `Bearer ${session.access_token}`, "content-type": "application/json" };
  }, [sb]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/integrations", { headers: await headers(), cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load Integration Manager.");
      setRows(data.integrations || []);
      setCounts({ installed: Number(data.summary?.installedCount || 0), installable: Number(data.summary?.installableCount || 0) });
      setCanManage(data.permissions?.canManage === true);
    } catch (error: any) { setMessage(error?.message || "Could not load Integration Manager."); }
    finally { setLoading(false); }
  }, [headers]);

  const loadConnection = useCallback(async () => {
    const response = await fetch("/api/admin/integrations/mailsystem/mail-connection", { headers: await headers(), cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load Mail System connection.");
    setConnection(data);
    setBaseUrl(data.baseUrl || "");
    setConnected(data.configured === true);
  }, [headers]);

  useEffect(() => { void load(); }, [load]);
  const mail = rows.find((row) => row.id === "mailsystem");
  useEffect(() => {
    if (mail?.state.installed) void loadConnection().catch((error) => setMessage(error.message));
  }, [mail?.state.installed, loadConnection]);

  async function change(id: string, action: string) {
    setBusy(id); setMessage("");
    try {
      const response = await fetch("/api/admin/integrations", {
        method: "PATCH", headers: await headers(), body: JSON.stringify({ integration_id: id, action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Integration update failed.");
      await load();
      if (id === "mailsystem" && action === "install") await loadConnection();
      setMessage(action === "uninstall" ? "Integration uninstalled and its saved connection removed." : `Integration ${action} completed.`);
    } catch (error: any) { setMessage(error?.message || "Integration update failed."); }
    finally { setBusy(""); }
  }

  async function connectionAction(action: "test" | "save") {
    setBusy("mailsystem-connection"); setMessage("");
    try {
      const response = await fetch("/api/admin/integrations/mailsystem/mail-connection", {
        method: "POST", headers: await headers(), body: JSON.stringify({ action, baseUrl, apiKey }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || "Mail System connection failed.");
      if (action === "test") {
        setConnected(data.connected === true);
        setMessage(data.message || (data.connected ? "Connection verified." : "Connection failed."));
      } else {
        setApiKey("");
        setConnection({ configured: true, baseUrl: data.baseUrl, apiKeyConfigured: true, remoteIdentityConfigured: data.remoteIdentityConfigured });
        setConnected(true);
        setMessage(data.message || "Connection saved and trust registered.");
        await load();
      }
    } catch (error: any) { setConnected(false); setMessage(error?.message || "Mail System connection failed."); }
    finally { setBusy(""); }
  }

  async function syncDirectory() {
    setBusy("mailsystem-directory"); setMessage("");
    try {
      const response = await fetch("/api/admin/integrations/mailsystem/mail-directory", { method: "POST", headers: await headers() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Directory synchronisation failed.");
      setMessage(`Directory detected: ${data.directory?.groups || 0} groups, ${data.directory?.departments || 0} departments, ${data.directory?.roles || 0} roles. Users: ${data.users?.synced || 0}/${data.users?.total || 0} synced; ${data.users?.failed || 0} failed.`);
    } catch (error: any) { setMessage(error?.message || "Directory synchronisation failed."); }
    finally { setBusy(""); }
  }

  const card = { border: "1px solid var(--admin-border,#d5dbe5)", borderRadius: 12, padding: 18, marginBottom: 14, background: "var(--admin-surface,transparent)" } as const;
  const field = { display: "block", width: "100%", boxSizing: "border-box" as const, marginTop: 6, padding: 10, borderRadius: 7, border: "1px solid var(--admin-border,#cbd5e1)", background: "var(--admin-input,transparent)", color: "inherit" };
  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: "24px 18px 48px", color: "var(--admin-text,inherit)" }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 22 }}>
      <div><p style={{ fontSize: 12, letterSpacing: 1.2, opacity: .65, margin: 0 }}>SYSTEM / EXTENSIONS</p><h1 style={{ margin: "6px 0" }}>Integration Manager</h1><p style={{ margin: 0, opacity: .75 }}>Install, connect, configure and control integrations from one place.</p></div>
      <span style={{ fontSize: 12, opacity: .7 }}>Installed: {counts.installed} · Available: {counts.installable}</span>
    </header>
    {message && <p role="status" style={{ padding: 12, border: "1px solid var(--admin-border,#d5dbe5)", borderRadius: 8 }}>{message}</p>}
    {loading ? <p>Loading integrations…</p> : rows.length === 0 ? <p>No installable integrations are registered.</p> : rows.map((item) => {
      const ready = item.id === "mailsystem" ? item.connectionConfigured === true : item.configured;
      return <section key={item.id} style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 18, flexWrap: "wrap" }}>
          <div style={{ minWidth: 220, flex: "1 1 400px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h2 style={{ fontSize: 19, margin: 0 }}>{item.name}</h2>
              <span style={{ fontSize: 12, padding: "3px 8px", borderRadius: 20, border: "1px solid var(--admin-border,#d5dbe5)" }}>{item.state.installed ? (item.state.enabled ? "Enabled" : "Installed · Disabled") : "Not installed"}</span>
              <span style={{ fontSize: 12, opacity: .65 }}>v{item.state.version || item.version}</span>
            </div>
            <p style={{ margin: "8px 0", opacity: .8 }}>{item.description}</p>
            <p style={{ fontSize: 12, opacity: .65, margin: "8px 0 0" }}>Features: {item.features.join(" · ")}</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {item.state.installed && item.route && <Link href={item.route} style={{ padding: "8px 12px", border: "1px solid var(--admin-border,#d5dbe5)", borderRadius: 8, textDecoration: "none" }}>Open Mail Settings</Link>}
            {canManage && !item.state.installed && <button disabled={!!busy} onClick={() => void change(item.id, "install")}>Install</button>}
            {canManage && item.state.installed && !item.state.enabled && <button disabled={!!busy || !ready} title={!ready ? "Configure and verify the connection below first." : undefined} onClick={() => void change(item.id, "enable")}>Enable</button>}
            {canManage && item.state.enabled && <button disabled={!!busy} onClick={() => void change(item.id, "disable")}>Disable</button>}
            {canManage && item.state.installed && <button disabled={!!busy} onClick={() => { if (window.confirm("Uninstall this integration and clear its saved configuration?")) void change(item.id, "uninstall"); }}>Uninstall</button>}
          </div>
        </div>
        {item.id === "mailsystem" && item.state.installed && <section style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--admin-border,#d5dbe5)" }}>
          <h3 style={{ margin: "0 0 8px" }}>Mail System Core connection</h3>
          <p style={{ fontSize: 13, opacity: .75 }}>Enter the Core URL and External System API key once. Billing Store generates and registers the remote-login signing key automatically; the private key stays encrypted in Billing Store.</p>
          <label style={{ display: "block", marginBottom: 12 }}>Mail System Core URL<input style={field} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://incendiamail.vercel.app" autoComplete="url" /></label>
          <label style={{ display: "block", marginBottom: 12 }}>External System API key<input style={field} type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={connection.apiKeyConfigured ? "Saved securely — enter a replacement only to rotate" : "Paste the API key created for this Billing Store External System"} autoComplete="new-password" /></label>
          <p style={{ fontSize: 13 }}>Connection: {connected ? "Verified" : connection.configured ? "Saved, not currently verified" : "Not configured"} · Remote login trust: {connection.remoteIdentityConfigured ? "Configured" : "Will be registered when saved"}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button disabled={!!busy || !baseUrl.trim() || (!apiKey.trim() && !connection.apiKeyConfigured)} onClick={() => void connectionAction("test")}>Test connection</button>
            <button disabled={!canManage || !!busy || !baseUrl.trim() || (!apiKey.trim() && !connection.apiKeyConfigured)} onClick={() => void connectionAction("save")}>Save connection & set up trust</button>
            {item.state.enabled && <button disabled={!canManage || !!busy} onClick={() => void syncDirectory()}>Sync Billing Store users & permissions</button>}
          </div>
        </section>}
      </section>;
    })}
    {!canManage && !loading && <p style={{ fontSize: 13, opacity: .7 }}>Integration changes require the integrations.manage permission.</p>}
    <p style={{ fontSize: 12, opacity: .65, marginTop: 20 }}>Mail Settings is the integration-contributed page for templates, sender routing, triggers and mail behaviour. Core connection and trust configuration remain here.</p>
  </main>;
}
