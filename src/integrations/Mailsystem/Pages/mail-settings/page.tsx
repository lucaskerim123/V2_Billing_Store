"use client";

import { useCallback, useEffect, useState } from "react";

type Props = { integration?: { id: string; name: string; version: string } };
type ConnectionStatus = { configured: boolean; baseUrl: string; apiKeyConfigured: boolean };

export default function MailSettingsPage({ integration }: Props) {
  const [status, setStatus] = useState<ConnectionStatus>({ configured: false, baseUrl: "", apiKeyConfigured: false });
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [connected, setConnected] = useState(false);

  const request = useCallback(async (action: "load" | "test" | "save") => {
    setBusy(true); setMessage("");
    try {
      const { createClient } = await import("@/lib/supabase");
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Administrator session expired. Sign in again.");
      const headers = { authorization: "Bearer " + session.access_token, "content-type": "application/json" };
      if (action === "load") {
        const response = await fetch("/api/admin/integrations/mailsystem/mail-connection", { headers, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load connection.");
        setStatus(data); setBaseUrl(data.baseUrl || ""); setConnected(data.configured);
        return;
      }
      const response = await fetch("/api/admin/integrations/mailsystem/mail-connection", {
        method: "POST", headers, body: JSON.stringify({ action, baseUrl, apiKey })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || "Mail System request failed.");
      if (action === "test") {
        setConnected(data.connected === true);
        setMessage(data.message || (data.connected ? "Connection verified." : "Connection failed."));
      } else {
        setStatus({ configured: true, baseUrl: data.baseUrl, apiKeyConfigured: true });
        setApiKey(""); setConnected(true); setMessage(data.message);
      }
    } catch (error) {
      setConnected(false);
      setMessage(error instanceof Error ? error.message : "Mail System request failed.");
    } finally { setBusy(false); }
  }, [baseUrl, apiKey]);

  useEffect(() => { void request("load"); }, [request]);

  return <main style={{ maxWidth: 920, margin: "0 auto", padding: 24, color: "var(--admin-text,inherit)" }}>
    <header style={{ marginBottom: 24 }}>
      <p style={{ fontSize: 12, letterSpacing: 1.1, opacity: .65 }}>SYSTEM / INTEGRATIONS / MAIL SYSTEM</p>
      <h1 style={{ margin: "6px 0" }}>Mail System Connection</h1>
      <p style={{ opacity: .75 }}>Configure the connection here. Credentials are encrypted by Billing Store and are never returned to the browser.</p>
      {integration && <small>{integration.name} · v{integration.version}</small>}
    </header>
    {message && <p role="status" style={{ padding: 12, border: "1px solid var(--admin-border,#d5dbe5)", borderRadius: 8 }}>{message}</p>}
    <section style={{ border: "1px solid var(--admin-border,#d5dbe5)", borderRadius: 12, padding: 20 }}>
      <h2 style={{ fontSize: 18, marginTop: 0 }}>Connection details</h2>
      <label style={{ display: "block", marginBottom: 14 }}>Mail System URL
        <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://mail.example.com" autoComplete="url" style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 6, padding: 11, borderRadius: 7, border: "1px solid var(--admin-border,#cbd5e1)", background: "var(--admin-input,transparent)", color: "inherit" }} />
      </label>
      <label style={{ display: "block", marginBottom: 14 }}>Mail System API key
        <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={status.apiKeyConfigured ? "Saved securely — enter a new key to rotate it" : "Paste the External System API key"} autoComplete="new-password" style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 6, padding: 11, borderRadius: 7, border: "1px solid var(--admin-border,#cbd5e1)", background: "var(--admin-input,transparent)", color: "inherit" }} />
      </label>
      <p style={{ fontSize: 13, opacity: .7 }}>Status: {connected ? "Connected" : status.configured ? "Saved — connection not currently verified" : "Not configured"}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button disabled={busy || !baseUrl.trim() || (!apiKey.trim() && !status.apiKeyConfigured)} onClick={() => void request("test")}>Test connection</button>
        <button disabled={busy || !baseUrl.trim() || (!apiKey.trim() && !status.apiKeyConfigured)} onClick={() => void request("save")}>Save connection</button>
      </div>
    </section>
    <p style={{ fontSize: 12, opacity: .65, marginTop: 18 }}>The API key is stored encrypted in Billing Store’s integration registry. It is only decrypted on the server when the integration needs to communicate with Mail System.</p>
  </main>;
}
