import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/integrations/Mailsystem/Data/remote-staff.ts", import.meta.url), "utf8");
const moduleSource = readFileSync(new URL("../src/integrations/Mailsystem/Data/module.ts", import.meta.url), "utf8");\nconst typesSource = readFileSync(new URL("../src/integrations/Mailsystem/Data/remote-staff-types.ts", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../src/integrations/Mailsystem/manifest.json", import.meta.url), "utf8"));

test("remote login provisioning requires an active, fully mapped remote identity", () => {
  assert.match(source, /export async function provisionRemoteStaffLogin/);
  assert.match(source, /synced\.remote_user\.status !== "active"/);
  assert.match(source, /synced\.access\.state === "pending_review"/);
  assert.match(source, /exchangeRemoteIdentity\(assertion\)/);
});

test("remote actor assertions are short-lived RS256 assertions with configured issuer and audience", () => {
  assert.match(source, /createSign\("RSA-SHA256"\)/);
  assert.match(source, /MAIL_SYSTEM_REMOTE_ASSERTION_PRIVATE_KEY/);
  assert.match(source, /exp: nowSeconds \+ 120/);
  assert.match(source, /jti: randomUUID\(\)/);
});

test("remote staff API exposes group sync, session lifecycle and delegated permission assignment", () => {
  assert.match(source, /group_codes\?: string\[\]/);
  assert.match(moduleSource, /assignRemoteAdminPermissions/);
  assert.match(moduleSource, /refreshRemoteSession/);
  assert.match(moduleSource, /terminateRemoteStaff/);
});

test("integration manifest advertises remote login and delegated permission features", () => {
  assert.ok(manifest.features.includes("remote-login-provisioning"));
  assert.ok(manifest.features.includes("delegated-remote-admin-permissions"));
});
