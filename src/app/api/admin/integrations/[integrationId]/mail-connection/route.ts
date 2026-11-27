import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { requireIntegrationAdmin, integrationErrorResponse, hasIntegrationPermission } from "@/lib/integrations/admin-context";
import { getBuiltinIntegration } from "@/lib/integrations/runtime";
import { verifyMailSystemConnection } from "@/integrations/Mailsystem/Data/client";

export const runtime = "nodejs";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const INTEGRATION_ID = "mailsystem";
const SECRET_KEY = "mailSystemConnection";
function db() {
  if (!URL || !SERVICE_KEY) throw Object.assign(new Error("Billing Store secure integration storage is unavailable."), { status: 503 });
  return createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function key() {
  if (!SERVICE_KEY) throw Object.assign(new Error("Secure storage key is unavailable."), { status: 503 });
  return createHash("sha256").update("orbitfs-integration-secret:v1:").update(SERVICE_KEY).digest();
}
function encrypt(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { version: 1, algorithm: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}
function decrypt(value: any): string {
  if (!value || value.version !== 1 || value.algorithm !== "aes-256-gcm") throw new Error("Stored Mail System credentials are invalid. Save the connection again.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
async function admin(req: Request) {
  const context = await requireIntegrationAdmin(req, ["integrations.manage"]);
  if (!hasIntegrationPermission(context.access, "integrations.mail.manage") && !hasIntegrationPermission(context.access, "integrations.manage")) {
    throw Object.assign(new Error("Mail System integration management permission required."), { status: 403 });
  }
  const manifest = getBuiltinIntegration(INTEGRATION_ID);
  if (!manifest) throw Object.assign(new Error("Mail System integration is not registered."), { status: 404 });
  const service = db();
  const { data: row, error } = await service.from("app_integrations").select("installed,enabled,config").eq("integration_id", INTEGRATION_ID).maybeSingle();
  if (error) throw Object.assign(new Error(error.message), { status: 503 });
  if (row?.installed !== true || row?.enabled !== true) throw Object.assign(new Error("Install and enable Mail System in Integration Manager first."), { status: 409 });
  return { ...context, service, row };
}
export async function GET(req: Request) {
  try {
    const { row } = await admin(req), stored = row.config?.[SECRET_KEY];
    return Response.json({ configured: !!stored, baseUrl: stored?.baseUrl || "", apiKeyConfigured: !!stored?.encryptedApiKey }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return integrationErrorResponse(error, "Unable to load Mail System connection settings."); }
}
export async function POST(req: Request) {
  try {
    const { service, row } = await admin(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const baseUrl = String(body.baseUrl || row.config?.[SECRET_KEY]?.baseUrl || "").trim().replace(/\/$/, "");
    const apiKey = String(body.apiKey || "").trim();
    if (!/^https:\/\//i.test(baseUrl)) return Response.json({ error: "Enter a valid HTTPS Mail System URL." }, { status: 400 });
    let credential = apiKey;
    if (!credential && row.config?.[SECRET_KEY]?.encryptedApiKey) credential = decrypt(row.config[SECRET_KEY].encryptedApiKey);
    if (!credential) return Response.json({ error: "Enter the Mail System API key." }, { status: 400 });
    const result = await verifyMailSystemConnection({ baseUrl, apiKey: credential });
    if (action === "test") return Response.json({ ...result, apiKey: undefined }, { headers: { "cache-control": "no-store" } });
    if (action !== "save") return Response.json({ error: "Unsupported action." }, { status: 400 });
    if (!result.connected) return Response.json({ ...result, error: result.message }, { status: 422 });
    const config = row.config && typeof row.config === "object" && !Array.isArray(row.config) ? { ...row.config } : {};
    config[SECRET_KEY] = { baseUrl, encryptedApiKey: encrypt(credential), savedAt: new Date().toISOString() };
    const { error } = await service.from("app_integrations").update({ config, updated_at: new Date().toISOString() }).eq("integration_id", INTEGRATION_ID);
    if (error) throw Object.assign(new Error(error.message), { status: 503 });
    return Response.json({ ok: true, configured: true, baseUrl, connected: true, canSend: result.canSend, status: result.status, message: "Mail System connection saved and verified." }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return integrationErrorResponse(error, "Unable to update Mail System connection."); }
}
