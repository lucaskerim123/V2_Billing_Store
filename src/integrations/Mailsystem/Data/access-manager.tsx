"use client";

import { useEffect, useMemo, useState } from "react";

type Row = Record<string, any>;
type Rule = { selector_type: "group" | "department" | "role"; selector_code: string; access_profile_id: string; mailbox_ids: string[] };
type PermissionRule = { external_permission_code: string; mail_permission_ids: string[] };

function groupMappings(rows: Row[]): Rule[] {
  const grouped = new Map<string, Rule>();
  for (const row of rows || []) {
    const selector_type = row.external_group_code ? "group" : row.external_department_code ? "department" : "role";
    const selector_code = row.external_group_code || row.external_department_code || row.external_role_code;
    if (!selector_code) continue;
    const key = [selector_type, selector_code, row.access_profile_id].join("|");
    const mailboxId = String(row.mailbox_id || "");
    if (!mailboxId) continue;
    const existing: Rule = grouped.get(key) || {
      selector_type,
      selector_code,
      access_profile_id: String(row.access_profile_id || ""),
      mailbox_ids: [],
    };
    if (!existing.mailbox_ids.includes(mailboxId)) existing.mailbox_ids.push(mailboxId);
    grouped.set(key, existing);
  }
  return [...grouped.values()];
}

export function MailAccessManager({
  onLoad,
  onSave,
  canManage = false,
}: {
  onLoad: () => Promise<any>;
  onSave: (body: any) => Promise<any>;
  canManage?: boolean;
}) {
  const [data, setData] = useState<any>(null);
  const [enabled, setEnabled] = useState(false);
  const [allowedMailboxIds, setAllowedMailboxIds] = useState<string[]>([]);
  const [allowedProfileIds, setAllowedProfileIds] = useState<string[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [permissionRules, setPermissionRules] = useState<PermissionRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setStatus("");
    try {
      const result = await onLoad();
      setData(result);
      const core = result.core || {};
      const delegation = core.delegation || {};
      setEnabled(delegation.enabled === true);
      setAllowedMailboxIds(delegation.allowed_mailbox_ids || []);
      setAllowedProfileIds(delegation.allowed_profile_ids || []);
      setRules(groupMappings(core.mappings || []));
      const existing = new Map<string, string[]>(
        (core.permissionMappings || [])
          .filter((row: Row) => row.active)
          .map((row: Row): [string, string[]] => [
            String(row.external_permission_code),
            Array.isArray(row.mail_permission_ids) ? row.mail_permission_ids : [],
          ]),
      );
      const codes: string[] = [...new Set<string>(
        (core.groupPermissions || [])
          .map((row: Row) => String(row.external_permission_code || ""))
          .filter(Boolean),
      )].sort();
      setPermissionRules(codes.map((code: any) => ({ external_permission_code: code, mail_permission_ids: (existing.get(code) as string[]) || [] })));
    } catch (error: any) {
      setStatus(error?.message || "Could not load users and access rules.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const core = data?.core || {};
  const directory = data?.directory || {};
  const mailboxes: Row[] = core.mailboxes || [];
  const profiles: Row[] = core.accessProfiles || [];
  const groups: Row[] = directory.groups || [];
  const departments: Row[] = directory.departments || [];
  const roleOptions = new Map<string, Row>(
    (directory.users || []).map((user: Row): [string, Row] => {
      const role = String(user.role || "staff");
      return [role, { code: role, name: role }];
    }),
  );
  const roles: Row[] = [...roleOptions.values()];
  const adminCeiling: string[] = core.delegation?.admin_permission_ceiling || [];
  const userRows: Row[] = (directory.users || []).map((user: Row) => {
    const remote = (core.remoteUsers || []).find((item: Row) => item.external_user_id === user.id);
    const grants = remote ? (core.mailboxGrants || []).filter((grant: Row) => grant.remote_user_id === remote.id) : [];
    return { ...user, remote, grants };
  });

  function addRule() {
    const firstGroup = groups[0]?.code || departments[0]?.code || roles[0]?.code || "";
    setRules(current => [...current, {
      selector_type: groups.length ? "group" : departments.length ? "department" : "role",
      selector_code: firstGroup, access_profile_id: allowedProfileIds[0] || profiles[0]?.id || "",
      mailbox_ids: [],
    }]);
  }

  function updateRule(index: number, patch: Partial<Rule>) {
    setRules(current => current.map((rule, i) => i === index ? { ...rule, ...patch } : rule));
  }

  function toggleValue(values: string[], value: string, checked: boolean) {
    return checked ? [...new Set([...values, value])] : values.filter(item => item !== value);
  }

  async function save() {
    setBusy(true); setStatus("");
    try {
      const mappings = rules.flatMap(rule => rule.mailbox_ids.map(mailbox_id => ({
        selector_type: rule.selector_type, selector_code: rule.selector_code,
        access_profile_id: rule.access_profile_id, mailbox_id,
      })));
      const permission_mappings = permissionRules.filter(rule => rule.mail_permission_ids.length).map(rule => ({
        external_permission_code: rule.external_permission_code, mail_permission_ids: rule.mail_permission_ids,
      }));
      const result = await onSave({
        delegation: { enabled, allowed_mailbox_ids: allowedMailboxIds, allowed_profile_ids: allowedProfileIds },
        mappings, permission_mappings,
      });
      setStatus(`Saved ${result.saved ?? mappings.length} mailbox rules and ${result.permission_mappings ?? permission_mappings.length} group permission mappings.`);
      await load();
    } catch (error: any) {
      setStatus(error?.message || "Could not save access rules.");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <section className="panel mail-admin-card"><p>Detecting Billing Store users, groups and departments…</p>{status}</section>;
  if (!data) return <section className="panel mail-admin-card"><p role="status">{status || "Access configuration unavailable."}</p><button type="button" onClick={() => void load()}>Retry</button></section>;

  return <section className="mail-access-manager">
    <section className="panel mail-admin-card">
      <div className="mail-admin-card-heading"><div><h3>Billing Store access connection</h3><p className="muted">Users, groups, departments and permissions are detected from Billing Store automatically.</p></div><button type="button" disabled={busy || loading} onClick={() => void load()}>Refresh directory</button></div>
      <div className="mail-admin-meta">
        <span><small>Staff users</small><strong>{userRows.length}</strong></span>
        <span><small>Groups</small><strong>{groups.length}</strong></span>
        <span><small>Departments</small><strong>{departments.length}</strong></span>
        <span><small>Mailboxes</small><strong>{mailboxes.length}</strong></span>
        <span><small>Remote login trust</small><strong>{core.delegation?.assertion_issuer ? "Registered" : "Not registered"}</strong></span>
      </div>
      <label className="mail-admin-check"><input type="checkbox" checked={enabled} disabled={!canManage || busy} onChange={event => setEnabled(event.target.checked)} /> Enable Billing Store Remote Staff access</label>
      <p className="muted">Select the mailboxes and access profiles Billing Store is allowed to assign. These are the maximum permissions the integration can grant.</p>
      <div className="mail-admin-form-grid">
        <div className="mail-admin-check-list"><strong>Mailboxes available to Billing Store</strong>{mailboxes.map(mailbox => <label className="mail-admin-check" key={mailbox.id}><input type="checkbox" checked={allowedMailboxIds.includes(mailbox.id)} disabled={!canManage || busy} onChange={event => setAllowedMailboxIds(current => toggleValue(current, mailbox.id, event.target.checked))} />{mailbox.address}</label>)}</div>
        <div className="mail-admin-check-list"><strong>Access profiles available to Billing Store</strong>{profiles.map(profile => <label className="mail-admin-check" key={profile.id}><input type="checkbox" checked={allowedProfileIds.includes(profile.id)} disabled={!canManage || busy} onChange={event => setAllowedProfileIds(current => toggleValue(current, profile.id, event.target.checked))} /><span><b>{profile.display_name}</b><small>{(profile.capabilities || []).join(", ")}</small></span></label>)}</div>
      </div>
    </section>

    <section className="panel mail-admin-card">
      <div className="mail-admin-card-heading"><div><h3>Group, department and role mailbox rules</h3><p className="muted">Access accumulates. A user receives the combined mailbox access from every matching group, department and role.</p></div><button type="button" disabled={!canManage || busy} onClick={addRule}>Add access rule</button></div>
      {rules.map((rule, index) => {
        const options = rule.selector_type === "group" ? groups : rule.selector_type === "department" ? departments : roles;
        return <div className="panel mail-admin-card" key={index}>
          <div className="mail-admin-form-grid">
            <label>Applies to<select value={rule.selector_type} disabled={!canManage || busy} onChange={event => {
              const selector_type = event.target.value as Rule["selector_type"];
              const nextOptions = selector_type === "group" ? groups : selector_type === "department" ? departments : roles;
              updateRule(index, { selector_type, selector_code: nextOptions[0]?.code || "" });
            }}><option value="group">User group</option><option value="department">Department</option><option value="role">Role</option></select></label>
            <label>Billing Store group / department / role<select value={rule.selector_code} disabled={!canManage || busy} onChange={event => updateRule(index, { selector_code: event.target.value })}>{options.map((option: Row) => <option key={option.code} value={option.code}>{option.name || option.code}</option>)}</select></label>
            <label>Mail System access profile<select value={rule.access_profile_id} disabled={!canManage || busy} onChange={event => updateRule(index, { access_profile_id: event.target.value })}><option value="">Select profile</option>{profiles.filter(profile => allowedProfileIds.includes(profile.id)).map(profile => <option key={profile.id} value={profile.id}>{profile.display_name}</option>)}</select></label>
          </div>
          <div className="mail-admin-check-list"><strong>Mailbox access</strong>{mailboxes.filter(mailbox => allowedMailboxIds.includes(mailbox.id)).map(mailbox => <label className="mail-admin-check" key={mailbox.id}><input type="checkbox" checked={rule.mailbox_ids.includes(mailbox.id)} disabled={!canManage || busy} onChange={event => updateRule(index, { mailbox_ids: toggleValue(rule.mailbox_ids, mailbox.id, event.target.checked) })} />{mailbox.address}</label>)}</div>
          <button className="ghost danger-action" type="button" disabled={!canManage || busy} onClick={() => setRules(current => current.filter((_, i) => i !== index))}>Remove rule</button>
        </div>;
      })}
      {!rules.length && <p className="muted">No mailbox rules yet. Add a rule to assign mailboxes to a Billing Store group, department or role.</p>}
    </section>

    <section className="panel mail-admin-card">
      <h3>Billing Store group permissions → Mail System administration</h3>
      <p className="muted">Map a Billing Store permission to a Mail System administrator permission. A user receives the mapped Mail System permissions when they belong to a group carrying that Billing Store permission.</p>
      {permissionRules.map((rule, index) => <div className="mail-admin-row" key={rule.external_permission_code}>
        <span><strong>{rule.external_permission_code}</strong><small>{rule.mail_permission_ids.length ? "Grants: " + rule.mail_permission_ids.join(", ") : "No Mail System admin access mapped"}</small></span>
        <details className="mail-admin-disclosure"><summary>Configure</summary><div className="mail-admin-check-list">{adminCeiling.map(permission => <label className="mail-admin-check" key={permission}><input type="checkbox" disabled={!canManage || busy} checked={rule.mail_permission_ids.includes(permission)} onChange={event => setPermissionRules(current => current.map((item, i) => i === index ? { ...item, mail_permission_ids: toggleValue(item.mail_permission_ids, permission, event.target.checked) } : item))} />{permission}</label>)}</div></details>
      </div>)}
      {!permissionRules.length && <p className="muted">No Billing Store group permissions detected yet.</p>}
      {!adminCeiling.length && <p className="muted">Mail System Core has not authorised any delegated administrator permissions.</p>}
    </section>

    <section className="panel mail-admin-card">
      <h3>Linked users</h3>
      <p className="muted">Staff users are provisioned automatically. Group and department changes update their Mail System access; removing a Billing Store staff member revokes their remote session and mailbox grants.</p>
      <div className="mail-admin-list">{userRows.map(user => <div className="mail-admin-row" key={user.id}>
        <span><strong>{user.display_name}</strong><small>{user.email} · Groups: {(user.group_codes || []).join(", ") || "None"} · Departments: {(user.department_codes || []).join(", ") || "None"}</small></span>
        <span><b>{user.remote?.status || "Not linked"}</b><small>{user.grants.map((grant: Row) => mailboxes.find(mailbox => mailbox.id === grant.mailbox_id)?.address).filter(Boolean).join(", ") || "No mailbox access"}</small></span>
      </div>)}</div>
    </section>
    {status && <p role="status" className="notice">{status}</p>}
    <div className="mail-admin-form-action"><button className="primary" type="button" disabled={!canManage || busy || (enabled && (!allowedMailboxIds.length || !allowedProfileIds.length))} onClick={() => void save()}>{busy ? "Saving…" : "Save access and user mappings"}</button></div>
  </section>;
}
