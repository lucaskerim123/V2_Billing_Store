import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_INTEGRATIONS,
  canRunIntegration,
  getBuiltinIntegration,
  validateBuiltinIntegration
} from "../src/lib/integrations/registry.mjs";

test("Billing Mail integration is registered as a bundled host-adapted module", () => {
  const mail = getBuiltinIntegration("mail");
  assert.ok(mail);
  assert.equal(mail.sourceRepository, "remipetrovich-design/Mail-system");
  assert.equal(mail.sourcePath, "mail-configuration-module/Billing");
  assert.equal(mail.sourceWorkspaceBuildOnly, true);
  assert.equal(mail.hostAdapted, true);
  assert.equal(mail.distribution, "bundled");
  assert.equal(mail.installable, true);
});

test("only the hard-coded trusted integration manifest is accepted", () => {
  const mail = getBuiltinIntegration("mail");
  assert.equal(validateBuiltinIntegration(mail), true);
  assert.equal(validateBuiltinIntegration({ ...mail, publisher: "untrusted" }), false);
  assert.equal(validateBuiltinIntegration({ ...mail, sourceRepository: "other/repo" }), false);
  assert.equal(validateBuiltinIntegration({ ...mail, id: "unknown" }), false);
});

test("an integration can execute only when installed and enabled", () => {
  assert.equal(canRunIntegration({ installed: true, enabled: true }), true);
  assert.equal(canRunIntegration({ installed: true, enabled: false }), false);
  assert.equal(canRunIntegration({ installed: false, enabled: true }), false);
  assert.equal(canRunIntegration(null), false);
  assert.equal(BUILTIN_INTEGRATIONS.length, 1);
});
