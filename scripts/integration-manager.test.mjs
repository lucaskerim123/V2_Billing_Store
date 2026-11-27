import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {
  BUILTIN_INTEGRATIONS,
  canRunIntegration,
  discoverIntegrations,
  getBuiltinIntegration,
  validateBuiltinIntegration
} from "../src/lib/integrations/registry.mjs";

test("Billing Mail integration is discovered from its module folder", () => {
  const mail = getBuiltinIntegration("mail");
  assert.ok(mail);
  assert.equal(mail.sourceRepository, "remipetrovich-design/Mail-system");
  assert.equal(mail.sourcePath, "mail-configuration-module");
  assert.equal(mail.billingExtensionPath, "mail-configuration-module/Billing");
  assert.equal(mail.sourceWorkspaceBuildOnly, true);
  assert.equal(mail.hostAdapted, true);
  assert.equal(mail.distribution, "bundled");
  assert.equal(mail.installable, true);
  assert.equal(mail.route, "/admin/integrations/mail");
});

test("the folder scanner discovers valid modules and ignores invalid folders", () => {
  const root = mkdtempSync(join(tmpdir(), "orbitfs-integrations-"));
  try {
    const valid = {
      format: "orbitfs-billing-integration-v1",
      id: "example-module",
      displayName: "Example Module",
      version: "1.0.0",
      publisher: "Test Publisher",
      distribution: "bundled",
      installable: true,
      serverOnly: true,
      requires: ["EXAMPLE_API_KEY"],
      entrypoints: { console: "./console.tsx" }
    };
    mkdirSync(join(root, "example-module"));
    writeFileSync(join(root, "example-module", "manifest.json"), JSON.stringify(valid));
    mkdirSync(join(root, "not-a-module"));
    writeFileSync(join(root, "not-a-module", "manifest.json"), JSON.stringify({ ...valid, id: "different-id" }));
    mkdirSync(join(root, "invalid"));
    writeFileSync(join(root, "invalid", "manifest.json"), JSON.stringify({ ...valid, entrypoints: { console: "../outside.tsx" } }));

    const found = discoverIntegrations(root);
    assert.deepEqual(found.map((item) => item.id), ["example-module"]);
    assert.equal(found[0].route, "/admin/integrations/example-module");
    assert.deepEqual(found[0].requiredEnvironment, ["EXAMPLE_API_KEY"]);
    assert.equal(discoverIntegrations(join(root, "missing")).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("manifest validation matches discovered metadata and rejects unknown IDs", () => {
  const mail = getBuiltinIntegration("mail");
  assert.ok(mail);
  const manifest = JSON.parse(readFileSync(new URL("../src/integrations/mail/manifest.json", import.meta.url), "utf8"));
  assert.equal(validateBuiltinIntegration(manifest), true);
  assert.equal(validateBuiltinIntegration(mail), true);
  assert.equal(validateBuiltinIntegration({ ...mail, publisher: "untrusted" }), false);
  assert.equal(validateBuiltinIntegration({ ...mail, sourceRepository: "other/repo" }), false);
  assert.equal(validateBuiltinIntegration({ ...mail, id: "unknown" }), false);
});

test("only installed and enabled integrations can execute", () => {
  assert.equal(canRunIntegration({ installed: true, enabled: true }), true);
  assert.equal(canRunIntegration({ installed: true, enabled: false }), false);
  assert.equal(canRunIntegration({ installed: false, enabled: true }), false);
  assert.equal(canRunIntegration(null), false);
  const ids = BUILTIN_INTEGRATIONS.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});
