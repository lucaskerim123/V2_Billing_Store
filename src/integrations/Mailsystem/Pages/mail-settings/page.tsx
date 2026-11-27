"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

type Props = { integration?: { id: string; name: string; version: string } };
type ConnectionStatus = { configured: boolean; baseUrl: string; apiKeyConfigured: boolean; remoteIdentityConfigured?: boolean };

export default function MailSettingsPage({ integration }: Props) {
  const [status, setStatus] = useState<ConnectionStatus>({ configured: false, baseUrl: "", apiKeyConfigured: false });
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [issuer, setIssuer] = useState("billing-store");
  const [audience, setAudience] = useState("mail-system");
  const [keyId, setKeyId] = useState("billing-store-remote");
  const [privateKey, setPrivateKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const supabase = createClient(), { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Administrator session expired. Sign in again.");
        const response = await fetch("/api/admin/integrations/mailsystem/mail-connection", { headers: { authorization: "Bearer " + session.access_token }, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load connection.");
        if (active) { setStatus(data); setBaseUrl(data.baseUrl || ""); setConnected(data.configured); }
      } catch (error) { if (active) setMessage(error instanceof Error ? error.message : "Unable to load connection."); }
    })();
    return () => { active = false; };
  }, []);

  async function submit(action: "test" | "save") {
    setBusy(true); setMessage("");
    try {
      const supabase = createClient(), { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Administrator session expired. Sign in again.");
      const response = await fetch("/api/admin/integrations/mailsystem/mail-connection", {
        method: "POST", headers: { authorization: "Bearer " + session.access_token, "content-type": "application/json" },
        body: JSON.stringify({ action, baseUrl, apiKey, issuer, audience, keyId, privateKey })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || "Mail System request failed.");
      if (action === "test") { setConnected(data.connected === true); setMessage(data.message || (data.connected ? "Connection verified." : "Connection failed.")); }
      else {
        setStatus({ configured: true, baseUrl: data.baseUrl, apiKeyConfigured: true, remoteIdentityConfigured: data.remoteIdentityConfigured });
        setApiKey(""); setPrivateKey(""); setConnected(true); setMessage(data.message);
      }
    } catch (error) { setConnected(false); setMessage(error instanceof Error ? error.message : "Mail System request failed."); }
    finally { setBusy(false); }
  }

  return <main style={{ maxWidth: 920, margin: "0 auto", padding: 24, color: "var(--admin-text,inherit)" }}>
    <header style={{ marginBottom: 24 }}>
      <p style={{ fontSize: 12, letterSpacing: 1.1, opacity: .65 }}>SYSTEM / INTEGRATIONS / MAIL SYSTEM</p>
      <h1 style={{ margin: "6px 0" }}>Mail System Settings</h1>
      <p style={{ opacity: .75 }}>Configure the connection and remote login signing here. Secrets are encrypted by Billing Store and are never returned to the browser.</p>
      {integration && <small>{integration.name} · v{integration.version}</small>}
    </header>
    {message && <p role="status" style={{ padding: 12, border: "1px solid var(--admin-border,#d5dbe5)", borderRadius: 8 }}>{message}</p>}
    <section style={{ border: "1px solid var(--admin-border,#d5dbe5)", borderRadius: 12, padding: 20, marginBottom: 16 }}>
      <h2 style={{ fontSize: 18, marginTop: 0 }}>Mail System connection</h2>
      <label style={{ display: "block", marginBottom: 14 }}>Mail System URL
        <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://mail.example.com" autoComplete="url" style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 6, padding: 11, borderRadius: 7, border: "1px solid var(--admin-border,#cbd5e1)", background: "var(--admin-input,transparent)", color: "inherit" }} />
      </label>
      <label style={{ display: "block", marginBottom: 14 }}>Mail System API key
        <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={status.apiKeyConfigured ? "Saved securely — enter a new key to replace it" : "Paste the External System API key"} autoComplete="new-password" style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 6, padding: 11, borderRadius: 7, border: "1px solid var(--admin-border,#cbd5e1)", background: "var(--admin-input,transparent)", color: "inherit" }} />
      </label>
      <p style={{ fontSize: 13, opacity: .7 }}>Connection status: {connected ? "Connected" : status.configured ? "Saved — not verified in this session" : "Not configured"}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button disabled={busy || !baseUrl.trim() || (!apiKey.trim() && !status.apiKeyConfigured)} onClick={() => void submit("test")}>Test connection</button>
        <button disabled={busy || !baseUrl.trim() || (!apiKey.trim() && !status.apiKeyConfigured)} onClick={() => void submit("save")}>Save connection</button>
      </div>
    </section>
    <section style={{ border: "1px solid var(--admin-border,#d5dbe5)", borderRadius: 12, padding: 20 }}>
      <h2 style={{ fontSize: 18, marginTop: 0 }}>Remote user login signing</h2>
      <p style={{ fontSize: 13, opacity: .75 }}>These values let Billing Store create short-lived signed identity assertions for Mail System remote-user logins. Register the matching public key in Mail System.</p>
      <label style={{ display: "block", marginBottom: 12 }}>Issuer<input value={issuer} onChange={e => setIssuer(e.target.value)} style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 6, padding: 10 }} /></label>
      <label style={{ display: "block", marginBottom: 12 }}>Audience<input value={audience} onChange={e => setAudience(e.target.value)} style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 6, padding: 10 }} /></label>
      <label style={{ display: "block", marginBottom: 12 }}>Key ID<input value={keyId} onChange={e => setKeyId(e.target.value)} style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 6, padding: 10 }} /></label>
      <label style={{ display: "block", marginBottom: 12 }}>RS256 private key (PEM)<textarea value={privateKey} onChange={e => setPrivateKey(e.target.value)} placeholder={status.remoteIdentityConfigured ? "Signing key saved securely — paste a replacement to rotate it" : "-----BEGIN PRIVATE KEY-----"} rows={7} autoComplete="off" style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 6, padding: 10, fontFamily: "monospace" }} /></label>
      <p style={{ fontSize: 13, opacity: .7 }}>Signing credentials: {status.remoteIdentityConfigured ? "Configured" : "Not configured"}</p>
      <p style={{ fontSize: 12, opacity: .65 }}>The private key is encrypted at rest and never displayed after saving. Leave all four fields as-is to retain the saved signing key; enter a new PEM key to rotate it.</p>
    </section>
  </main>;
}
