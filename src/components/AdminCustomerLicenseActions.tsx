"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase";

type Binding = {
  id: string;
  license_id: string;
  label: string;
  license_key_last4?: string | null;
  status?: string | null;
  activations: any[];
};

export default function AdminCustomerLicenseActions() {
  const path = usePathname();
  const customerId = useMemo(() => {
    const match = path.match(/^\/admin\/customers\/([^/]+)/);
    return match ? match[1] : "";
  }, [path]);
  const sb = useMemo(() => createClient(), []);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [newKey, setNewKey] = useState("");

  async function load() {
    if (!customerId) return;
    const { data: customer } = await sb
      .from("customers")
      .select("id,auth_user_id,user_id,customer_number")
      .eq("id", customerId)
      .maybeSingle();
    const number = String(customer?.customer_number || "").trim();
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.access_token || !number) {
      setBindings([]);
      return;
    }

    const response = await fetch(
      "/api/admin/license-master?path=" + encodeURIComponent("/api/v1/license"),
      { headers: { Authorization: "Bearer " + session.access_token }, cache: "no-store" },
    );
    const master = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(master?.error || "Could not load License Master licences.");

    const current = (Array.isArray(master?.licenses) ? master.licenses : [])
      .filter((x: any) => String(x.customer_external_id || "").trim() === number)
      .filter((x: any) => !["revoked", "expired"].includes(String(x.status || "").toLowerCase()));

    setBindings(current.map((x: any) => ({
      ...x,
      id: x.id,
      license_id: x.id,
      label: x.product_code || x.product || "OrbitFS Licence",
      activations: Array.isArray(x.activations) ? x.activations : [],
    })));
  }

  useEffect(() => {
    void load().catch((error) =>
      setMsg(error instanceof Error ? error.message : "Could not load customer licences."),
    );
  }, [customerId]);

  async function control(licenseId: string, action: string, installationId = "") {
    if (!licenseId) return;
    if (!confirm(`Apply ${action} to this licence?`)) return;
    setBusy(licenseId + ":" + action);
    setMsg("");
    if (action === "rotate") setNewKey("");

    const { data: { session } } = await sb.auth.getSession();
    const response = await fetch(
      `/api/admin/license-master?path=${encodeURIComponent(`/api/v1/license/${encodeURIComponent(licenseId)}/control`)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          ...(installationId ? { installation_id: installationId } : {}),
        }),
      },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMsg(result.error || `Licence ${action} failed.`);
      setBusy("");
      return;
    }

    const key = result?.key || result?.license?.key || result?.license_key || result?.licenseKey || "";
    if (action === "rotate") {
      if (!key) {
        setMsg("Rotation completed but no replacement key was returned.");
        setBusy("");
        return;
      }
      setNewKey(String(key));
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    }

    setBusy("");
    setMsg(result.message || `Licence ${action} completed.`);
    await load();
  }

  if (!customerId) return null;

  return (
    <section className="panel" style={{ marginBottom: 14 }}>
      <div className="head">
        <div>
          <p className="eyebrow">LICENSE CONTROLLER</p>
          <h2>Customer licensing</h2>
          <p className="muted">Customer ID: {customerId}</p>
          <p className="muted">Actions route through License Master.</p>
        </div>
        <a className="buttonlink" href="/admin/licensing">Open License Master</a>
      </div>

      {newKey && (
        <div className="notice okBox" role="status" style={{ position: "sticky", top: 12, zIndex: 30 }}>
          <strong>NEW LICENSE KEY</strong>
          <p className="muted">Shown once. It stays visible until you dismiss it or refresh the page.</p>
          <div className="license-key" style={{ wordBreak: "break-all", fontSize: "1.05rem", padding: 12 }}>
            {newKey}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 8 }}>
            <button onClick={() => void navigator.clipboard?.writeText(newKey)}>Copy new key</button>
            <button className="secondary" onClick={() => setNewKey("")}>Dismiss</button>
          </div>
        </div>
      )}

      {bindings.length === 0 ? (
        <p className="muted">No active licence bindings found.</p>
      ) : (
        bindings.map((binding) => (
          <div key={binding.id} style={{ display: "grid", gap: 8, padding: "12px 0", borderBottom: "1px solid var(--line,#ddd)" }}>
            <div>
              <b>{binding.label}</b>
              <span style={{ display: "block", opacity: 0.7, fontSize: 12 }}>
                {binding.license_id} · {binding.license_key_last4 ? `••••${binding.license_key_last4}` : "Key protected"} · {binding.status || "unknown"}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
              <button disabled={!!busy} onClick={() => void control(binding.license_id, "activate")}>Reactivate</button>
              <button disabled={!!busy} onClick={() => void control(binding.license_id, "suspend")}>Suspend</button>
              <button disabled={!!busy} onClick={() => void control(binding.license_id, "rotate")}>Rotate key</button>
              <button className="danger" disabled={!!busy} onClick={() => void control(binding.license_id, "terminate")}>Block / terminate</button>

              {binding.activations.length > 0 && (
                <div style={{ display: "grid", gap: 6, paddingTop: 6 }}>
                  <b>Installations</b>
                  {binding.activations.map((activation: any) => (
                    <div key={activation.id || activation.installation_id} style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, opacity: 0.8 }}>
                        {activation.installation_id} · {activation.status || "unknown"}{activation.product_version ? " · v" + activation.product_version : ""}
                      </span>
                      {String(activation.status || "").toLowerCase() === "locked" ? (
                        <button disabled={!!busy} onClick={() => void control(binding.license_id, "unlock-installation", String(activation.installation_id))}>Unlock</button>
                      ) : (
                        <button disabled={!!busy} onClick={() => void control(binding.license_id, "lock-installation", String(activation.installation_id))}>Lock</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))
      )}

      {msg && <p>{msg}</p>}
    </section>
  );
}
