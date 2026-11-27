/** Server-side connection exports for the Mail System integration. */
export { getMailModuleConfig } from "./Data/config";
export { verifyMailSystemConnection, getSenders, sendMessage, testConnection } from "./Data/client";
export type { MailModuleConfig } from "./Data/config";
export type { MailConnectionResult, MailConnectionStatus, Sender, SendMessage } from "./Data/client";
