import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [transport, email, automation, queue, transactionalRoute, outboxRoute, manualRoute, customerEmail, env] = await Promise.all([
  read("../src/lib/mail-system-transport.ts"),
  read("../src/lib/email.ts"),
  read("../src/lib/transactional-server.ts"),
  read("../src/lib/mail-queue-worker.ts"),
  read("../src/app/api/mail/transactional/route.ts"),
  read("../src/app/api/mail/outbox/route.ts"),
  read("../src/app/api/mail/route.ts"),
  read("../src/app/api/admin/customer-email/route.ts"),
  read("../.env.example"),
]);

test("central Mail System transport is preferred and sender-scoped", () => {
  assert.match(transport, /MAIL_SYSTEM_URL/);
  assert.match(transport, /MAIL_SYSTEM_API_KEY/);
  assert.match(transport, /\/api\/mail\/senders/);
  assert.match(transport, /\/api\/mail/);
  assert.match(transport, /selected Billing Store sender is not assigned/);
  assert.match(transport, /RESEND_API_KEY/);
  assert.match(transport, /attachments: input\.attachments/);
  assert.match(manualRoute, /attachments:reqBody\.attachments/);
});

test("all Billing Store outbound email paths use the shared transport adapter", () => {
  for (const source of [email, automation, queue, transactionalRoute, outboxRoute, manualRoute, customerEmail]) {
    assert.match(source, /sendMailThroughConfiguredTransport/);
    assert.doesNotMatch(source, /https:\/\/api\.resend\.com\/emails/);
  }
});

test("central Mail System credentials are documented as server-only environment variables", () => {
  assert.match(env, /MAIL_SYSTEM_URL=/);
  assert.match(env, /MAIL_SYSTEM_API_KEY=/);
  assert.match(env, /RESEND_API_KEY=/);
});
