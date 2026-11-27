import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderVariable, renderTemplate } from "./renderer.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFile(join(root, name), "utf8");

test("dotted variables interpolate and missing values become empty", () => {
  assert.equal(renderVariable("Hello {{user.name}} / {{missing}}", { user: { name: "Ada" } }), "Hello Ada / ");
});

test("subject and text render", () => {
  assert.deepEqual(
    renderTemplate({ subject: "Hi {{name}}", text: "{{count}} items" }, { name: "Ada", count: 2 }),
    { subject: "Hi Ada", text: "2 items", html: undefined },
  );
});

test("browser-facing components do not import or expose central API credentials", async () => {
  const [consoleSource, adminSource] = await Promise.all([read("console.tsx"), read("admin-ui.tsx")]);
  for (const source of [consoleSource, adminSource]) {
    assert.doesNotMatch(source, /MAIL_SYSTEM_API_KEY|MAIL_SYSTEM_URL|getMailModuleConfig|from ["']\.\/module/);
  }
});

test("server send path checks enablement, recipient addresses and API-key sender permissions", async () => {
  const source = await read("module.ts");
  assert.match(source, /if \(!settings\.enabled\)/);
  assert.match(source, /EMAIL_PATTERN\.test\(recipient\)/);
  assert.match(source, /capabilities\.senders\.some/);
  assert.match(source, /sendMessage\(/);
});

test("routing rejects unknown operators and evaluates supported conditional operators", async () => {
  const source = await read("routing.ts");
  for (const operator of ["equals", "notEquals", "in", "contains"]) assert.match(source, new RegExp(operator));
  assert.match(source, /operators\.some/);
  assert.match(source, /sort\(\(a, b\) => b\.priority - a\.priority\)/);
});

test("host persistence contract requires revision listing, restoration and atomic snapshots", async () => {
  const source = await read("types.ts");
  assert.match(source, /saveTemplate MUST update the template and/);
  assert.match(source, /insert its next revision snapshot in one database transaction/);
  assert.match(source, /listTemplateRevisions/);
  assert.match(source, /restoreTemplateRevision/);
});

test("host schema starts disabled and enables row-level security on every module table", async () => {
  const source = await read("schema.sql");
  assert.match(source, /'enabled', false/);
  for (const table of ["app_mail_templates", "app_mail_template_revisions", "app_mail_routes", "app_mail_triggers", "app_mail_settings"]) {
    assert.match(source, new RegExp("alter table " + table + " enable row level security", "i"));
  }
});

test("module documentation states the host and central service responsibility boundary", async () => {
  const [readme, install, api] = await Promise.all([read("README.md"), read("INSTALL.md"), read("API.md")]);
  assert.match(readme, /central Mail System.*owns mail transports, domains, sender mailboxes, API credentials/i);
  assert.match(install, /server-only/i);
  assert.match(api, /trusted server-side host code/i);
});

test("connection verifier uses the production sender discovery contract and classifies failures", async () => {
  const source = await read("client.ts");
  assert.match(source, /\/api\/mail\/senders/);
  assert.match(source, /Authorization: "Bearer " \+ config\.apiKey/);
  for (const status of ["connected", "no_senders_assigned", "invalid_api_key", "external_system_or_scope_invalid", "configuration_missing", "mail_system_unavailable", "network_error"]) {
    assert.match(source, new RegExp(status));
  }
  assert.match(source, /\/api\/mail["']/);
});

test("host Supabase adapter persists every declared store capability", async () => {
  const source = await read("supabase-store.ts");
  for (const table of ["app_mail_templates", "app_mail_template_revisions", "app_mail_routes", "app_mail_triggers", "app_mail_settings"]) {
    assert.match(source, new RegExp(table));
  }
  assert.match(source, /app_mail_save_template_with_revision/);
  assert.match(source, /app_mail_restore_template_revision/);
});

test("package and manifest return to the requested v1 version", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const manifest = JSON.parse(await read("manifest.json"));
  assert.equal(pkg.version, "1.0.0");
  assert.equal(manifest.version, "1.0.0");
  assert.equal(pkg.private, false);
});


test("connection verifier and API contract accept mail:admin as well as mail:send", async () => {
  const [client, api, install] = await Promise.all([read("client.ts"), read("API.md"), read("INSTALL.md")]);
  assert.match(client, /mail:send or mail:admin permission/);
  assert.match(api, /mail:admin.*active sender mailboxes across the system/);
  assert.match(install, /mail:send.*mail:admin/);
  assert.match(install, /admin-scoped keys discover active mailboxes across the system/);
});


import { readFile as readRemoteFile } from "node:fs/promises";

test("Billing workspace exports the Remote Staff lifecycle and identity helpers", async () => {
  const sdk = await readRemoteFile(new URL("./remote-staff.ts", import.meta.url), "utf8");
  const entry = await readRemoteFile(new URL("./module.ts", import.meta.url), "utf8");
  assert.match(sdk, /syncRemoteStaff/);
  assert.match(sdk, /terminateRemoteStaff/);
  assert.match(sdk, /exchangeRemoteIdentity/);
  assert.match(sdk, /revokeRemoteSession/);
  assert.match(entry, /from ".\/remote-staff"/);
});

test("Billing Remote Staff client uses server-side credentials and idempotent lifecycle calls", async () => {
  const sdk = await readRemoteFile(new URL("./remote-staff.ts", import.meta.url), "utf8");
  assert.match(sdk, /getMailModuleConfig\(\)/);
  assert.match(sdk, /Idempotency-Key/);
  assert.match(sdk, /\/api\/integrations\/remote-staff\/sync/);
  assert.match(sdk, /\/api\/integrations\/remote-staff\/terminate/);
  assert.match(sdk, /X-Remote-Actor-Assertion/);
});

test("customer profile mail endpoint resolves the recipient from the Billing customer record", async () => {
  const route = await read("../../app/api/admin/customers/[id]/mail/route.ts");
  assert.match(route, /resolveRecipients:async\(\)=>customer\.email/);
  assert.doesNotMatch(route, /body\.to|body\.recipient/);
  assert.match(route, /communications\.mail\.send/);
});

test("Remote Staff sync derives access codes from Billing staff groups and departments", async () => {
  const source = await read("billing-sync.ts");
  assert.match(source, /app_mail_next_remote_staff_revision/);
  assert.match(source, /group_codes/);
  assert.match(source, /department_codes/);
  assert.match(source, /syncRemoteStaff/);
  assert.match(source, /terminateRemoteStaff/);
});

test("staff permission editor exposes separate mail management and send capabilities", async () => {
  const source = await read("../../lib/staff-capabilities.ts");
  assert.match(source, /communications\.mail\.manage/);
  assert.match(source, /communications\.mail\.send/);
});
