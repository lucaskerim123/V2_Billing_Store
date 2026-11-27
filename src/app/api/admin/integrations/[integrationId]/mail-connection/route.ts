import { createCipheriv, createDecipheriv, createHash, randomBytes, generateKeyPairSync, createPublicKey, randomUUID } from "node:crypto";
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
  if (!hasIntegrationPermission(context.access, "integrations.mail.manage") && !hasIntegrationPermission(context.access, "integrations.manage")) throw Object.assign(new Error("Mail System integration management permission required."), { status: 403 });
  if (!getBuiltinIntegration(INTEGRATION_ID)) throw Object.assign(new Error("Mail System integration is not registered."), { status: 404 });
  const service = db();
  const { data: row, error } = await service.from("app_integrations").select("installed,enabled,config").eq("integration_id", INTEGRATION_ID).maybeSingle();
  if (error) throw Object.assign(new Error(error.message), { status: 503 });
  if (row?.installed !== true) throw Object.assign(new Error("Install Mail System in Integration Manager first."), { status: 409 });
  return { ...context, service, row };
}
export async function GET(req: Request) {
  try {
    const { row } = await admin(req), saved = row.config?.[SECRET_KEY];
    let remoteIdentityConfigured = false;
    if (saved?.encryptedRemoteIdentity) {
      try { const identity = JSON.parse(decrypt(saved.encryptedRemoteIdentity)); remoteIdentityConfigured = !!(identity.issuer && identity.audience && identity.keyId && identity.privateKey); } catch { remoteIdentityConfigured = false; }
    }
    return Response.json({ configured: !!saved?.encryptedApiKey, baseUrl: saved?.baseUrl || "", apiKeyConfigured: !!saved?.encryptedApiKey, remoteIdentityConfigured }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return integrationErrorResponse(error, "Unable to load Mail System connection settings."); }
}
export async function POST(req: Request) {
  try {
    const { service, row } = await admin(req);
    const body = await req.json().catch(() => ({})), action = body.action;
    const existing = row.config?.[SECRET_KEY] || {};
    const baseUrl = String(body.baseUrl || existing.baseUrl || "").trim().replace(/\/$/, "");
    const apiKey = String(body.apiKey || "").trim();
    if (!/^https:\/\//i.test(baseUrl)) return Response.json({ error: "Enter a valid HTTPS Mail System URL." }, { status: 400 });
    let credential = apiKey;
    if (!credential && existing.encryptedApiKey) credential = decrypt(existing.encryptedApiKey);
    if (!credential) return Response.json({ error: "Enter the Mail System API key." }, { status: 400 });
    const result = await verifyMailSystemConnection({ baseUrl, apiKey: credential });
    if (action === "test") return Response.json({ ...result, apiKey: undefined }, { headers: { "cache-control": "no-store" } });
    if (action !== "save") return Response.json({ error: "Unsupported action." }, { status: 400 });
    if (!result.connected) return Response.json({ ...result, error: result.message }, { status: 422 });
    let identity: { issuer: string; audience: string; keyId: string; privateKey: string };
    if (existing.encryptedRemoteIdentity) {
      try { identity = JSON.parse(decrypt(existing.encryptedRemoteIdentity)); }
      catch { throw Object.assign(new Error("Saved remote identity key is invalid. Reconfigure the integration."), { status: 409 }); }
    } else {
      const pair = generateKeyPairSync("rsa", { modulusLength: 3072 });
      identity = {
        issuer: "billing-store",
        audience: "mail-system",
        keyId: "billing-store-remote-" + randomUUID(),
        privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      };
    }
    const publicJwk = createPublicKey(identity.privateKey).export({ format: "jwk" }) as Record<string, unknown>;
    const trustResponse = await fetch(baseUrl + "/api/integrations/remote-staff/register-key", {
      method: "POST",
      headers: { Authorization: "Bearer " + credential, "Content-Type": "application/json" },
      body: JSON.stringify({ kid: identity.keyId, issuer: identity.issuer, audience: identity.audience, public_jwk: publicJwk }),
      cache: "no-store",
    });
    const trustResult: any = await trustResponse.json().catch(() => ({}));
    if (!trustResponse.ok) {
      const detail = typeof trustResult.error === "object" ? trustResult.error.message : trustResult.error;
      return Response.json({ error: detail || "Mail System did not register the remote login trust key. Ensure the API key has remote:staff:sync scope." }, { status: trustResponse.status });
    }
    const encryptedRemoteIdentity = encrypt(JSON.stringify(identity));
    const config = row.config && typeof row.config === "object" && !Array.isArray(row.config) ? { ...row.config } : {};
    config[SECRET_KEY] = { baseUrl, encryptedApiKey: encrypt(credential), encryptedRemoteIdentity, savedAt: new Date().toISOString() };
    const { error } = await service.from("app_integrations").update({ config, updated_at: new Date().toISOString() }).eq("integration_id", INTEGRATION_ID);
    if (error) throw Object.assign(new Error(error.message), { status: 503 });
    return Response.json({ ok: true, configured: true, baseUrl, connected: true, canSend: result.canSend, status: result.status, remoteIdentityConfigured: !!encryptedRemoteIdentity, trust: "registered", message: "Mail System connection saved, verified and remote login trust registered automatically." }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return integrationErrorResponse(error, "Unable to update Mail System connection."); }
}
