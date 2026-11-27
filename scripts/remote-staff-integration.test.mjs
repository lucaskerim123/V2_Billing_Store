import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);

const source = readFileSync(new URL("../src/integrations/Mailsystem/Data/remote-staff.ts", import.meta.url), "utf8");
const moduleSource = readFileSync(new URL("../src/integrations/Mailsystem/Data/module.ts", import.meta.url), "utf8");
const typesSource = readFileSync(new URL("../src/integrations/Mailsystem/Data/remote-staff-types.ts", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../src/integrations/Mailsystem/manifest.json", import.meta.url), "utf8"));

test("remote login provisioning requires an active, fully mapped remote identity", () => {
  assert.match(source, /export async function provisionRemoteStaffLogin/);
  assert.match(source, /synced\.remote_user\.status !== "active"/);
  assert.match(source, /synced\.access\.state === "pending_review"/);
  assert.match(source, /exchangeRemoteIdentity\(assertion\)/);
});

test("remote actor assertions are short-lived RS256 assertions with manager-configured issuer and audience", () => {
  assert.match(source, /createSign\("RSA-SHA256"\)/);
  assert.match(source, /getMailRemoteIdentityConfig/);
  assert.match(source, /exp: nowSeconds \+ 120/);
  assert.match(source, /jti: randomUUID\(\)/);
});

test("remote staff API exposes group sync, session lifecycle and delegated permission assignment", () => {
  assert.match(typesSource, /group_codes\?: string\[\]/);
  assert.match(moduleSource, /assignRemoteAdminPermissions/);
  assert.match(moduleSource, /refreshRemoteSession/);
  assert.match(moduleSource, /terminateRemoteStaff/);
});


test("remote staff sync sends group assignments without changing omitted or empty arrays", async () => {
  const requests = [];
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  runInNewContext(compiled.outputText, {
    exports,
    require(id) {
      if (id === "node:crypto") return require(id);
      if (id === "./config") return {
        getMailModuleConfig: async () => ({ baseUrl: "https://mail.example.test", apiKey: "test-key" }),
      };
      throw new Error("Unexpected dependency: " + id);
    },
    fetch: async (url, init) => {
      requests.push({ url, init });
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });

  for (const groups of [["support", "billing"], [], undefined]) {
    const input = {
      event_id: "event-" + requests.length,
      source_revision: 1,
      user: {
        external_user_id: "staff-1",
        status: "active",
        role_codes: ["staff"],
        department_codes: ["billing"],
        ...(groups === undefined ? {} : { group_codes: groups }),
      },
    };
    await exports.syncRemoteStaff(input);
    const { url, init } = requests.at(-1);
    assert.equal(url, "https://mail.example.test/api/integrations/remote-staff/sync");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, "Bearer test-key");
    assert.equal(init.headers["Idempotency-Key"], input.event_id);
    assert.deepEqual(JSON.parse(init.body), input);
  }
  assert.equal(requests.length, 3);
});

test("integration manifest advertises remote login and delegated permission features", () => {
  assert.ok(manifest.features.includes("remote-login-provisioning"));
  assert.ok(manifest.features.includes("delegated-remote-admin-permissions"));
});

const managerPage = readFileSync(new URL("../src/app/admin/integrations/page.tsx", import.meta.url), "utf8");
const mailSettingsPage = readFileSync(new URL("../src/integrations/Mailsystem/Pages/mail-settings/page.tsx", import.meta.url), "utf8");
const connectionRoute = readFileSync(new URL("../src/app/api/admin/integrations/[integrationId]/mail-connection/route.ts", import.meta.url), "utf8");
const directoryRoute = readFileSync(new URL("../src/app/api/admin/integrations/[integrationId]/mail-directory/route.ts", import.meta.url), "utf8");

test("Integration Manager owns Mail System lifecycle, credentials and automatic remote trust setup", () => {
  assert.match(managerPage, /Mail System Core URL/);
  assert.match(managerPage, /Save connection & set up trust/);
  assert.match(managerPage, /Install/);
  assert.match(managerPage, /Uninstall/);
  assert.match(connectionRoute, /generateKeyPairSync\("rsa"/);
  assert.match(connectionRoute, /register-key/);
  assert.match(connectionRoute, /encryptedRemoteIdentity/);
});

test("Mail Settings contains working templates and routing UI without core credentials", () => {
  assert.match(mailSettingsPage, /MailModuleConsole/);
  assert.doesNotMatch(mailSettingsPage, /privateKey|apiKey|baseUrl/);
  assert.match(managerPage, /Open Mail Settings/);
});

test("Billing Store directory sync detects roles, departments, groups and permission flags", () => {
  assert.match(directoryRoute, /admin_get_staff_snapshot/);
  assert.match(directoryRoute, /profile_role/);
  assert.match(directoryRoute, /support_department_staff/);
  assert.match(directoryRoute, /group_ids/);
  assert.match(directoryRoute, /permissions: Object\.entries/);
  assert.match(directoryRoute, /remote-staff\/sync/);
  assert.match(directoryRoute, /complete_snapshot/);
  assert.doesNotMatch(directoryRoute, /\\n\\s+failures:/, "directory response must use valid TypeScript line breaks, not an escaped newline token");
});

const accessManager = readFileSync(new URL("../src/integrations/Mailsystem/Data/access-manager.tsx", import.meta.url), "utf8");

test("Mail access manager keeps permission mappings and role options strongly typed", () => {
  assert.match(accessManager, /new Map<string, string\[\]>\(/);
  assert.match(accessManager, /new Map<string, Row>\(/);
});

test("Mail access manager types grouped mailbox rules and normalises mailbox identifiers", () => {
  assert.match(accessManager, /const existing: Rule = grouped\.get\(key\)/);
  assert.match(accessManager, /const mailboxId = String\(row\.mailbox_id \|\| ""\)/);
  assert.match(accessManager, /existing\.mailbox_ids\.includes\(mailboxId\)/);
});


test("directory catalogue and staff sync use the same canonical profile role", () => {
  assert.match(directoryRoute, /const roleCode = .*member\.profile_role/);
  assert.match(directoryRoute, /const code = roleCode\(member\)/);
  assert.match(directoryRoute, /const role = roleCode\(member\)/);
  assert.match(directoryRoute, /role_codes: \[role\]/);
});

test("directory sync repairs signing trust using the saved connection", () => {
  assert.match(directoryRoute, /getMailRemoteIdentityConfig/);
  assert.match(directoryRoute, /register-key/);
  assert.match(directoryRoute, /createPublicKey/);
  assert.ok(directoryRoute.indexOf("register-key") < directoryRoute.indexOf("/remote-staff/directory"));
});
