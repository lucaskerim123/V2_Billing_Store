"use client";

import React, { useEffect, useState } from "react";
import type { MailAppearance, MailModuleSettings, MailSender } from "./types";

export type MailModuleAdminProps = {
  settings: MailModuleSettings;
  onSave: (settings: MailModuleSettings) => Promise<void>;
  onTestConnection: () => Promise<{ connected: boolean; senders: MailSender[]; error?: string }>;
  canManage?: boolean;
  className?: string;
};

export function MailModuleAdmin({
  settings,
  onSave,
  onTestConnection,
  canManage = false,
  className,
}: MailModuleAdminProps) {
  const [value, setValue] = useState(settings);
  const [senders, setSenders] = useState<MailSender[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => setValue(settings), [settings]);

  const patch = (changes: Partial<MailModuleSettings>) =>
    setValue((current) => ({ ...current, ...changes }));
  const patchAppearance = (changes: Partial<MailAppearance>) =>
    patch({ appearance: { ...value.appearance, ...changes } });

  const style: React.CSSProperties = {
    fontFamily: value.appearance.fontFamily,
    color: value.appearance.textColor,
    background: value.appearance.surfaceColor,
    border: "1px solid " + value.appearance.borderColor,
    borderRadius: value.appearance.borderRadius,
    padding: 20,
  };

  async function testConnection() {
    setBusy(true);
    setStatus("");
    try {
      const result = await onTestConnection();
      setSenders(result.senders || []);
      setStatus(result.connected
        ? "Connected · " + result.senders.length + " permitted sender(s)"
        : result.error || "Connection failed");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setStatus("");
    try {
      await onSave(value);
      setStatus("Settings saved");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={className} style={style}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          {value.appearance.logoUrl && <img src={value.appearance.logoUrl} alt="" style={{ maxHeight: 36, maxWidth: 140, objectFit: "contain" }} />}
          <h2 style={{ color: value.appearance.primaryColor }}>{value.appearance.title}</h2>
          <p>{value.appearance.subtitle}</p>
        </div>
        <label>
          <input type="checkbox" checked={value.enabled} disabled={!canManage || busy}
            onChange={(event) => patch({ enabled: event.target.checked })} />
          Enabled
        </label>
      </header>

      <fieldset disabled={!canManage || busy} style={{ border: 0, padding: 0, display: "grid", gap: 12 }}>
        <label>Default sender
          <select value={value.defaultSender || ""} onChange={(event) => patch({ defaultSender: event.target.value || null })}>
            <option value="">No default sender</option>
            {value.defaultSender && !senders.some((sender) => sender.address === value.defaultSender) &&
              <option value={value.defaultSender}>{value.defaultSender} · saved selection</option>}
            {senders.map((sender) => <option key={sender.id} value={sender.address}>{sender.address}</option>)}
          </select>
        </label>
        <h3>Appearance</h3>
        <label>Title<input value={value.appearance.title} onChange={(event) => patchAppearance({ title: event.target.value })} /></label>
        <label>Subtitle<input value={value.appearance.subtitle} onChange={(event) => patchAppearance({ subtitle: event.target.value })} /></label>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {([["Primary", "primaryColor"], ["Accent", "accentColor"], ["Surface", "surfaceColor"], ["Text", "textColor"], ["Border", "borderColor"]] as const)
            .map(([label, key]) => <label key={key}>{label}
              <input type="color" value={value.appearance[key]} onChange={(event) => patchAppearance({ [key]: event.target.value })} />
            </label>)}
        </div>
        <label>Font<input value={value.appearance.fontFamily} onChange={(event) => patchAppearance({ fontFamily: event.target.value })} /></label>
        <label>Corner radius<input value={value.appearance.borderRadius} onChange={(event) => patchAppearance({ borderRadius: event.target.value })} /></label>
        <label>Logo URL<input value={value.appearance.logoUrl || ""} onChange={(event) => patchAppearance({ logoUrl: event.target.value || undefined })} /></label>
      </fieldset>

      <footer style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button type="button" disabled={busy} onClick={testConnection}>Test connection</button>
        <button type="button" disabled={!canManage || busy} onClick={save}>Save settings</button>
      </footer>
      {status && <p role="status">{status}</p>}
    </section>
  );
}
