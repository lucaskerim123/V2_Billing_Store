"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";

const componentLabels:Record<string,string>={orbitfs_base:"OrbitFS Base",orbitfs_apex:"OrbitFS APEX",orbitfs_mcp:"OrbitFS MCP",orbitfs_studio:"OrbitFS Studio"};
function enabledComponents(binding:any){
  const components=binding?.components&&typeof binding.components==="object"?binding.components:{};
  const enabled=Object.entries(componentLabels).filter(([id])=>{
    const value=components[id];
    return value===true||value?.allowed===true||["active","enabled","locked"].includes(String(value?.state||""));
  }).map(([,label])=>label);
  if(binding?.license_product_key==="orbitfs_base"&&!enabled.includes("OrbitFS Base"))enabled.unshift("OrbitFS Base");
  return enabled;
}

export default function OrbitFSLicenseController() {
  const sb = useMemo(() => createClient(), []);
  const [d, setD] = useState<any>();
  const [msg, setMsg] = useState("");
  const [newKey, setNewKey] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    const {
      data: { session },
    } = await sb.auth.getSession();
    const r = await fetch("/api/orbitfs/status", {
      headers: session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {},
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setD(j);
    else setMsg(j.error || "Could not load your licence.");
  }

  useEffect(() => {
    void load();
  }, []);

  const bindings = Array.isArray(d?.bindings) ? d.bindings : [];
  const binding =
    bindings.find(
      (x: any) =>
        x.license_product_key === "orbitfs_base" || x.components?.orbitfs_base,
    ) || bindings[0];
  const install = (d?.installations || []).find(
    (x: any) => x.license_binding_id === binding?.id,
  );
  const customerUnlockEnabled = d?.settings?.customer_self_unlock_enabled !== false;
  const licenseActive = String(binding?.authoritative_status || binding?.status || '').toLowerCase() === 'active';
  const pendingBaseForceReinstall=install?.metadata?.pendingBaseForceReinstall&&typeof install.metadata.pendingBaseForceReinstall==="object"?install.metadata.pendingBaseForceReinstall:null;

  async function control(action: string) {
    if (!binding?.license_id)
      return setMsg("No License Master licence ID is available.");
    if (
      !confirm(
        action === "rotate"
          ? "Rotate your licence key?"
          : "Unlock this installation?",
      )
    )
      return;

    setBusy(action);
    setNewKey("");

    const {
      data: { session },
    } = await sb.auth.getSession();

    const r = await fetch("/api/orbitfs/license-control", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session?.access_token || ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        licenseId: binding.license_id,
        installationId: install?.installation_id || null,
        action,
      }),
    });
    const j = await r.json().catch(() => ({}));

    setBusy("");
    if (r.ok) {
      setMsg(j.message || `Licence ${action} completed.`);
      if (action === "rotate" && j.key) setNewKey(String(j.key));
      await load();
    } else {
      setMsg(j.error || `Licence ${action} failed.`);
    }
  }

  if (!d)
    return (
      <main className="portalOverviewV2">
        <section className="panel">Loading licence…</section>
      </main>
    );

  return (
    <main className="portalOverviewV2 orbitfsLicenseController">
      <header className="portalOverviewHero">
        <div>
          <p className="eyebrow">MY ORBITFS · LICENCE</p>
          <h1>Your OrbitFS licence</h1>
          <p className="muted">
            Licence state is read from the independent License Master
            authority. The Store does not create or replace the licence
            authority.
          </p>
        </div>
        <Link className="buttonlink" href="/portal/orbitfs">
          ← My OrbitFS
        </Link>
      </header>

      <div className="portalOverviewGrid">
        <section className="panel">
          <p className="eyebrow">LICENCES</p>
          <h2>Linked licences</h2>

          {bindings.length === 0 ? (
            <p className="muted">
              No current licences are linked to this customer account.
            </p>
          ) : (
            bindings.map((b: any) => (
              <div
                key={b.id}
                className="panel"
                style={{ marginTop: 12 }}
              >
                <p className="eyebrow">
                  {b.license_product_key === "orbitfs_base"
                    ? "PRIMARY SYSTEM"
                    : "SECONDARY ADD-ON"}
                </p>
                <h2>
                  {(
                    {
                      orbitfs_base: "OrbitFS Base",
                      orbitfs_apex: "OrbitFS APEX",
                      orbitfs_mcp: "OrbitFS MCP",
                      orbitfs_studio: "OrbitFS Studio",
                    } as any
                  )[b.license_product_key] ||
                    b.label ||
                    b.license_product_key ||
                    "OrbitFS Licence"}
                </h2>

                <div className="listrow">
                  <b>Status</b>
                  <span>{b.authoritative_status || b.status || "unknown"}</span>
                </div>
                <div className="listrow">
                  <b>Key</b>
                  <span>
                    {b.license_key_last4
                      ? `••••${b.license_key_last4}`
                      : "Protected"}
                  </span>
                </div>
                <div className="listrow">
                  <b>Components</b>
                  <span style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
                    {enabledComponents(b).map((name)=><span key={name} className="badge">{name}</span>)}
                  </span>
                </div>
                <div className="listrow">
                  <b>Installation</b>
                  <span>{install?.installation_id || "Not registered"}</span>
                </div>
                <div className="listrow">
                  <b>Expires</b>
                  <span>
                    {b.authoritative_expires_at||b.expires_at
                      ? new Date(b.authoritative_expires_at||b.expires_at).toLocaleDateString()
                      : "No expiry"}
                  </span>
                </div>

                {newKey && (
                  <div className="panel licenseKeyReveal" style={{ marginTop: 12 }}>
                    <b>New licence key</b>
                    <p className="muted">
                      Shown once. Copy it now. {pendingBaseForceReinstall?"Then return to Base Deployment and enter this exact key to continue the Base reinstall.":"Save it before leaving this page."}
                    </p>
                    <code style={{ wordBreak: "break-all" }}>{newKey}</code>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
                      <button type="button" className="secondary" onClick={()=>void navigator.clipboard?.writeText(newKey)}>Copy key</button>
                      {pendingBaseForceReinstall&&<Link className="buttonlink" href="/portal/orbitfs">Return to Base Deployment →</Link>}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </section>

        <section className="panel">
          <p className="eyebrow">PERMITTED ACTIONS</p>
          <h2>Manage licence</h2>
          <p className="muted">
            Customer controls are intentionally narrower than administrator
            enforcement controls.
          </p>
          {pendingBaseForceReinstall&&<div className="panel" style={{margin:"12px 0",borderColor:"rgba(245,158,11,.65)"}}><p className="eyebrow">BASE REINSTALL WAITING</p><h2>Rotate this licence key</h2><p className="muted">The previous Base activation has been released. Rotate the key now. The replacement key is shown once; copy it, then return to Base Deployment and enter it to continue the reinstall of published Base {pendingBaseForceReinstall.targetVersion||"current"}.</p></div>}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              disabled={!!busy || !binding?.license_id || !licenseActive}
              onClick={() => void control("rotate")}
            >
              {busy === "rotate" ? "Rotating…" : pendingBaseForceReinstall ? "Rotate key for Base reinstall" : "Rotate key"}
            </button>
            <button
              className="secondary"
              disabled={!!busy || !binding?.license_id || !install?.installation_id || !customerUnlockEnabled || !licenseActive}
              onClick={() => void control("unlock")}
            >
              {busy === "unlock" ? "Unlocking…" : customerUnlockEnabled ? "Unlock installation" : "Customer unlock disabled"}
            </button>
          </div>

          {msg && <p>{msg}</p>}
        </section>
      </div>
    </main>
  );
}
