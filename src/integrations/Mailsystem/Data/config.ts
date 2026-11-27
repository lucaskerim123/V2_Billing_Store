import { createDecipheriv, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export type MailModuleConfig = { baseUrl: string; apiKey: string };
export type MailRemoteIdentityConfig = { issuer: string; audience: string; keyId: string; privateKey: string };

function decryptSecret(value: any, serviceKey: string): string {
  if (!value || value.version !== 1 || value.algorithm !== "aes-256-gcm") throw new Error("Stored Mail System credentials are invalid. Re-enter them in Integration Manager.");
  const key = createHash("sha256").update("orbitfs-integration-secret:v1:").update(serviceKey).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
async function readSavedConfig() {
  if (typeof window !== "undefined") throw new Error("Mail System credentials are server-only and cannot be read in a browser.");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "", serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !serviceKey) throw new Error("Billing Store secure integration storage is unavailable.");
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.from("app_integrations").select("config").eq("integration_id", "mailsystem").single();
  if (error) throw new Error("Unable to read Mail System integration configuration: " + error.message);
  return { saved: data?.config?.mailSystemConnection, serviceKey };
}
export async function getMailModuleConfig(): Promise<MailModuleConfig> {
  const { saved, serviceKey } = await readSavedConfig();
  if (!saved?.baseUrl || !saved?.encryptedApiKey) throw new Error("Mail System is not connected. Configure it in System → Integration Manager → Mail Settings.");
  const baseUrl = String(saved.baseUrl).trim().replace(/\/$/, "");
  if (!/^https:\/\//i.test(baseUrl)) throw new Error("Saved Mail System URL must use HTTPS.");
  return { baseUrl, apiKey: decryptSecret(saved.encryptedApiKey, serviceKey) };
}
export async function getMailRemoteIdentityConfig(): Promise<MailRemoteIdentityConfig> {
  const { saved, serviceKey } = await readSavedConfig();
  if (!saved?.encryptedRemoteIdentity) throw new Error("Remote login trust is configured automatically in Integration Manager.");
  const value = JSON.parse(decryptSecret(saved.encryptedRemoteIdentity, serviceKey));
  if (!value.issuer || !value.audience || !value.keyId || !value.privateKey) throw new Error("Remote identity signing configuration is incomplete.");
  return value as MailRemoteIdentityConfig;
}
