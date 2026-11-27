"use client";

import React, { useEffect, useState } from "react";
import type {
  MailModuleStore,
  MailTemplate,
  MailTemplateRevision,
  MailRoute,
  MailTrigger,
  MailModuleSettings,
  MailSender,
} from "./types";
import { configureTemplate, configureRoute, configureTrigger, updateModuleSettings } from "./configuration";
import { renderTemplate } from "./renderer";

type ConnectionResult = { connected: boolean; canSend?: boolean; status?: string; message?: string; sender?: string | null; senders: MailSender[]; error?: string };

export function MailModuleConsole({
  store,
  onTestConnection,
  canManage = false,
}: {
  store: MailModuleStore;
  onTestConnection: () => Promise<ConnectionResult>;
  canManage?: boolean;
}) {
  const [tab, setTab] = useState("templates");
  const [templates, setTemplates] = useState<MailTemplate[]>([]);
  const [routes, setRoutes] = useState<MailRoute[]>([]);
  const [triggers, setTriggers] = useState<MailTrigger[]>([]);
  const [settings, setSettings] = useState<MailModuleSettings | null>(null);
  const [revisions, setRevisions] = useState<MailTemplateRevision[]>([]);
  const [senders, setSenders] = useState<MailSender[]>([]);
  const [connection, setConnection] = useState<ConnectionResult | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const [templateId, setTemplateId] = useState<string | undefined>();
  const [templateKey, setTemplateKey] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [subject, setSubject] = useState("");
  const [textBody, setTextBody] = useState("");
  const [htmlBody, setHtmlBody] = useState("");
  const [templateActive, setTemplateActive] = useState(false);
  const [eventKey, setEventKey] = useState("");
  const [routeKey, setRouteKey] = useState("");
  const [senderAddress, setSenderAddress] = useState("");
  const [routeActive, setRouteActive] = useState(true);
  const [priority, setPriority] = useState(0);
  const [conditions, setConditions] = useState("{}");
  const [triggerTemplate, setTriggerTemplate] = useState("");
  const [recipientMapping, setRecipientMapping] = useState("{}");
  const [triggerActive, setTriggerActive] = useState(false);
  const [preview, setPreview] = useState("");

  async function refresh() {
    const [templateRows, routeRows, triggerRows, moduleSettings] = await Promise.all([
      store.listTemplates(),
      store.listRoutes(),
      store.listTriggers(),
      store.getSettings(),
    ]);
    setTemplates(templateRows);
    setRoutes(routeRows);
    setTriggers(triggerRows);
    setSettings(moduleSettings);
  }

  useEffect(() => {
    refresh().catch((error) => setStatus(error instanceof Error ? error.message : "Could not load mail settings"));
  }, []);

  async function run(operation: () => Promise<unknown>, success: string) {
    setBusy(true);
    setStatus("");
    try {
      await operation();
      await refresh();
      setStatus(success);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }

  async function selectTemplate(template: MailTemplate) {
    setTemplateId(template.id);
    setTemplateKey(template.template_key);
    setTemplateName(template.display_name);
    setSubject(template.subject);
    setTextBody(template.body_text || "");
    setHtmlBody(template.body_html || "");
    setTemplateActive(template.active);
    try {
      setRevisions(await store.listTemplateRevisions(template.id));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load revision history");
    }
  }

  async function saveTemplate() {
    await run(async () => {
      const saved = await configureTemplate(store, {
        id: templateId,
        template_key: templateKey,
        display_name: templateName,
        subject,
        body_text: textBody,
        body_html: htmlBody,
        active: templateActive,
      });
      setTemplateId(saved.id);
      setRevisions(await store.listTemplateRevisions(saved.id));
    }, "Template saved and revision recorded");
  }

  async function testConnection() {
    setBusy(true);
    setStatus("");
    try {
      const result = await onTestConnection();
      setConnection(result);
      setSenders(result.senders || []);
      setStatus(result.message || result.error || (result.connected ? "Connected" : "Connection failed"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return <section aria-live="polite">Loading mail configuration… {status}</section>;

  const appearance = settings.appearance;
  const style: React.CSSProperties = {
    fontFamily: appearance.fontFamily,
    color: appearance.textColor,
    background: appearance.surfaceColor,
    border: "1px solid " + appearance.borderColor,
    borderRadius: appearance.borderRadius,
    padding: 20,
  };

  return (
    <section style={style}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          {appearance.logoUrl && <img src={appearance.logoUrl} alt="" style={{ maxHeight: 36, maxWidth: 140 }} />}
          <h2 style={{ color: appearance.primaryColor }}>{appearance.title}</h2>
          <p>{appearance.subtitle}</p>
        </div>
        <label>
          <input type="checkbox" checked={settings.enabled} disabled={!canManage || busy}
            onChange={(event) => run(() => updateModuleSettings(store, { ...settings, enabled: event.target.checked }), event.target.checked ? "Module enabled" : "Module disabled")} />
          Module enabled
        </label>
      </header>

      <section aria-label="Mail System connection" style={{ border: "1px solid " + appearance.borderColor, borderRadius: 8, padding: 12, margin: "16px 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <strong>Mail System connection</strong>
            <p role="status" aria-live="polite" style={{ margin: "4px 0" }}>
              {connection ? connection.message || connection.error : "Not tested in this session. The API key is checked server-side and is never shown here."}
            </p>
            {connection?.connected && connection.senders.length > 0 &&
              <small>Permitted senders: {connection.senders.map((sender) => sender.address).join(", ")}</small>}
          </div>
          <button type="button" disabled={busy} onClick={testConnection}>Test connection</button>
        </div>
      </section>
      <nav aria-label="Mail configuration" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0" }}>
        {["templates", "routing", "triggers", "settings"].map((item) =>
          <button type="button" key={item} aria-pressed={tab === item} onClick={() => setTab(item)}>
            {item[0].toUpperCase() + item.slice(1)}
          </button>)}
      </nav>

      {tab === "templates" && <div>
        <h3>Templates</h3>
        <ul>{templates.map((template) => <li key={template.id}>
          <button type="button" onClick={() => selectTemplate(template)}>
            {template.display_name} · {template.template_key} · {template.active ? "Active" : "Disabled"}
          </button>
          <button type="button" disabled={!canManage || busy} onClick={() => run(() => store.deleteTemplate(template.id), "Template deleted")}>Delete</button>
        </li>)}</ul>
        <h4>{templateId ? "Edit template" : "New template"}</h4>
        <fieldset disabled={!canManage || busy}>
          <label>Key<input value={templateKey} onChange={(event) => setTemplateKey(event.target.value)} /></label>
          <label>Name<input value={templateName} onChange={(event) => setTemplateName(event.target.value)} /></label>
          <label>Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
          <label>Text body<textarea value={textBody} onChange={(event) => setTextBody(event.target.value)} /></label>
          <label>HTML body<textarea value={htmlBody} onChange={(event) => setHtmlBody(event.target.value)} /></label>
          <label><input type="checkbox" checked={templateActive} onChange={(event) => setTemplateActive(event.target.checked)} /> Active</label>
        </fieldset>
        <button type="button" disabled={!canManage || busy} onClick={saveTemplate}>Save template</button>
        <button type="button" disabled={busy} onClick={async () => {
          try {
            const rendered = renderTemplate({ subject, text: textBody, html: htmlBody }, { sample: "Example", customer: { name: "Sample Customer" } });
            setPreview(JSON.stringify(rendered, null, 2));
          } catch (error) {
            setStatus(error instanceof Error ? error.message : "Preview failed");
          }
        }}>Preview sample</button>
        {preview && <pre style={{ whiteSpace: "pre-wrap" }}>{preview}</pre>}
        {templateId && <section aria-label="Template revision history">
          <h4>Revision history</h4>
          <ul>{revisions.map((revision) => <li key={revision.id}>
            Revision {revision.revision} · {new Date(revision.created_at).toLocaleString()}
            <button type="button" disabled={!canManage || busy} onClick={() => run(
              async () => {
                await store.restoreTemplateRevision(templateId, revision.revision);
                await selectTemplate((await store.listTemplates()).find((item) => item.id === templateId)!);
              },
              "Template revision restored as a new revision",
            )}>Restore</button>
          </li>)}</ul>
        </section>}
      </div>}

      {tab === "routing" && <div>
        <h3>Sender routing rules</h3>
        <ul>{routes.map((route) => <li key={route.id}>
          <button type="button" onClick={() => {
            setRouteKey(route.route_key);
            setSenderAddress(route.sender_address);
            setPriority(route.priority);
            setRouteActive(route.active);
            setConditions(JSON.stringify(route.conditions, null, 2));
          }}>{route.route_key} → {route.sender_address} · priority {route.priority}</button>
          <button type="button" disabled={!canManage || busy} onClick={() => run(() => store.deleteRoute(route.id), "Route deleted")}>Delete</button>
        </li>)}</ul>
        <fieldset disabled={!canManage || busy}>
          <label>Route key<input value={routeKey} onChange={(event) => setRouteKey(event.target.value)} /></label>
          <label>Permitted sender<select value={senderAddress} onChange={(event) => setSenderAddress(event.target.value)}>
            <option value="">Select sender</option>
            {senders.map((sender) => <option key={sender.id} value={sender.address}>{sender.address}</option>)}
          </select></label>
          <label>Priority<input type="number" step="1" value={priority} onChange={(event) => setPriority(Number(event.target.value))} /></label>
          <label>Conditions JSON<textarea value={conditions} onChange={(event) => setConditions(event.target.value)} /></label>
          <label><input type="checkbox" checked={routeActive} onChange={(event) => setRouteActive(event.target.checked)} /> Active</label>
        </fieldset>
        <button type="button" disabled={!canManage || busy} onClick={() => run(
          () => configureRoute(store, { route_key: routeKey, sender_address: senderAddress, priority, conditions: JSON.parse(conditions), active: routeActive }),
          "Route saved",
        )}>Save active route</button>
      </div>}

      {tab === "triggers" && <div>
        <h3>Event triggers</h3>
        <ul>{triggers.map((trigger) => <li key={trigger.id}>
          <button type="button" onClick={() => {
            setEventKey(trigger.event_key);
            setTriggerTemplate(trigger.template_key);
            setRouteKey(trigger.route_key || "");
            setRecipientMapping(JSON.stringify(trigger.recipient_mapping, null, 2));
            setTriggerActive(trigger.active);
          }}>{trigger.event_key} → {trigger.template_key} · {trigger.active ? "Active" : "Disabled"}</button>
          <button type="button" disabled={!canManage || busy} onClick={() => run(() => store.deleteTrigger(trigger.id), "Trigger deleted")}>Delete</button>
        </li>)}</ul>
        <fieldset disabled={!canManage || busy}>
          <label>Event key<input value={eventKey} onChange={(event) => setEventKey(event.target.value)} /></label>
          <label>Template<select value={triggerTemplate} onChange={(event) => setTriggerTemplate(event.target.value)}>
            <option value="">Select template</option>
            {templates.map((template) => <option key={template.id} value={template.template_key}>{template.display_name}</option>)}
          </select></label>
          <label>Route key (optional)<select value={routeKey} onChange={(event) => setRouteKey(event.target.value)}>
            <option value="">Use default route selection</option>
            {routes.map((route) => <option key={route.id} value={route.route_key}>{route.route_key}</option>)}
          </select></label>
          <label>Recipient mapping JSON<textarea value={recipientMapping} onChange={(event) => setRecipientMapping(event.target.value)} /></label>
          <label><input type="checkbox" checked={triggerActive} onChange={(event) => setTriggerActive(event.target.checked)} /> Active</label>
        </fieldset>
        <button type="button" disabled={!canManage || busy} onClick={() => run(
          () => configureTrigger(store, { event_key: eventKey, template_key: triggerTemplate, route_key: routeKey || null, recipient_mapping: JSON.parse(recipientMapping), active: triggerActive }),
          "Trigger saved",
        )}>Save trigger</button>
        <p>Recipient mapping is interpreted only by the host application's trusted server-side resolver.</p>
      </div>}

      {tab === "settings" && <div>
        <h3>Module settings and appearance</h3>
        <label>Default sender<select value={settings.defaultSender || ""} onChange={(event) => setSettings({ ...settings, defaultSender: event.target.value || null })}>
          <option value="">No default sender</option>
          {settings.defaultSender && !senders.some((sender) => sender.address === settings.defaultSender) && <option value={settings.defaultSender}>{settings.defaultSender} · saved selection</option>}
          {senders.map((sender) => <option key={sender.id} value={sender.address}>{sender.address}</option>)}
        </select></label>
        {(["title", "subtitle", "logoUrl", "fontFamily", "borderRadius"] as const).map((key) =>
          <label key={key}>{key}<input value={appearance[key] || ""} onChange={(event) => setSettings({
            ...settings,
            appearance: { ...settings.appearance, [key]: event.target.value || undefined },
          })} /></label>)}
        {(["primaryColor", "accentColor", "surfaceColor", "textColor", "borderColor"] as const).map((key) =>
          <label key={key}>{key}<input type="color" value={appearance[key]} onChange={(event) => setSettings({
            ...settings,
            appearance: { ...settings.appearance, [key]: event.target.value },
          })} /></label>)}
        <button type="button" disabled={!canManage || busy} onClick={() => run(() => updateModuleSettings(store, settings), "Settings saved")}>Save settings</button>
        <button type="button" disabled={busy} onClick={testConnection}>Test connection and refresh senders</button>
      </div>}

      {status && <p role="status">{status}</p>}
    </section>
  );
}
