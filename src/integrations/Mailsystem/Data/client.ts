import { getMailModuleConfig, type MailModuleConfig } from "./config";

export type Sender = { id: string; address: string; kind?: string };
export type MailboxCatalogue = { mailboxes: Sender[]; provisioning_domains: string[] };
export type SendMessage = {
  to: string | string[]; subject: string; text?: string; html?: string;
  from_address?: string; reply_to?: string; cc?: string[]; bcc?: string[];
  attachments?: { filename: string; content: string; content_type?: string }[];
  headers?: Record<string, string>;
};
export type MailConnectionStatus =
  | "connected" | "no_senders_assigned" | "invalid_api_key"
  | "external_system_or_scope_invalid" | "configuration_missing"
  | "mail_system_unavailable" | "network_error" | "unknown_error";
export type MailConnectionResult = {
  connected: boolean; canSend: boolean; status: MailConnectionStatus;
  message: string; sender: string | null; senders: Sender[]; provisioningDomains?: string[];
};
export class MailSystemApiError extends Error {
  constructor(message: string, readonly statusCode?: number) { super(message); this.name = "MailSystemApiError"; }
}
async function call<T>(path: string, init: RequestInit = {}, suppliedConfig?: MailModuleConfig): Promise<T> {
  const config = suppliedConfig ?? await getMailModuleConfig();
  let response: Response;
  try {
    response = await fetch(config.baseUrl + path, {
      ...init,
      headers: { Authorization: "Bearer " + config.apiKey, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
      cache: "no-store", signal: init.signal ?? AbortSignal.timeout(10000),
    });
  } catch (error) { throw new MailSystemApiError(error instanceof Error ? error.message : "Could not reach Mail System."); }
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new MailSystemApiError(typeof data.error === "string" ? data.error : "Mail System request failed (" + response.status + ").", response.status);
  return data as T;
}
export async function getSenders(config?: MailModuleConfig) {
  const catalogue = await getMailboxCatalogue(config);
  const senders = catalogue.mailboxes;
  const system = senders.filter(item => item.kind === "system");
  return { sender: system.length === 1 ? system[0].address : null, senders, provisioningDomains: catalogue.provisioning_domains };
}
export async function getMailboxCatalogue(config?: MailModuleConfig): Promise<MailboxCatalogue> {
  const result = await call<MailboxCatalogue>("/api/integrations/mailboxes", {}, config);
  if (!Array.isArray(result.mailboxes) || !Array.isArray(result.provisioning_domains)) throw new MailSystemApiError("Invalid scoped mailbox catalogue.", 503);
  return result;
}
export async function verifyMailSystemConnection(config?: MailModuleConfig): Promise<MailConnectionResult> {
  try {
    const result = await getSenders(config);
    const senders = Array.isArray(result.senders) ? result.senders.filter(sender => sender && typeof sender.id === "string" && typeof sender.address === "string") : [];
    if (!senders.length) return { connected: true, canSend: false, status: "no_senders_assigned", message: "Connected to Mail System, but this External System has no active sender mailboxes assigned.", sender: null, senders: [], provisioningDomains:result.provisioningDomains };
    return { connected: true, canSend: true, status: "connected", message: "Connected and verified. " + senders.length + " permitted sender mailbox(es) available.", sender: result.sender, senders, provisioningDomains: result.provisioningDomains };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection verification failed.";
    if (/MAIL_SYSTEM_URL|MAIL_SYSTEM_API_KEY|Mail System is not connected|Billing Store secure integration storage/.test(message)) return { connected: false, canSend: false, status: "configuration_missing", message, sender: null, senders: [] };
    if (error instanceof MailSystemApiError && error.statusCode === 401) return { connected: false, canSend: false, status: "invalid_api_key", message: "Mail System rejected the API key. Check that the saved API key is current and has not been revoked.", sender: null, senders: [] };
    if (error instanceof MailSystemApiError && error.statusCode === 403) return { connected: false, canSend: false, status: "external_system_or_scope_invalid", message: "The API key is not authorised. Check that the External System is active and the key has mail:send or mail:admin permission.", sender: null, senders: [] };
    if (error instanceof MailSystemApiError && (error.statusCode || 0) >= 500) return { connected: false, canSend: false, status: "mail_system_unavailable", message: "Mail System is reachable but its sender-verification service failed. " + message, sender: null, senders: [] };
    if (error instanceof MailSystemApiError && error.statusCode === undefined) return { connected: false, canSend: false, status: "network_error", message: "Could not reach Mail System. Check the saved URL, DNS and network access. " + message, sender: null, senders: [] };
    return { connected: false, canSend: false, status: "unknown_error", message, sender: null, senders: [] };
  }
}
export async function testConnection(config?: MailModuleConfig) {
  const result = await verifyMailSystemConnection(config);
  if (!result.connected) throw new Error(result.message);
  return result;
}
export async function sendMessage(input: SendMessage, config?: MailModuleConfig) {
  const result = await verifyMailSystemConnection(config);
  if (!result.connected) throw new Error(result.message);
  const sender = input.from_address || result.sender;
  if (!sender || !result.senders.some(item => item.address.toLowerCase() === sender.toLowerCase())) throw new Error("Sender not assigned to this application.");
  return call<{ ok: boolean; id: string; providerId?: string }>("/api/mail", { method: "POST", body: JSON.stringify({ ...input, from_address: sender }) }, config);
}
