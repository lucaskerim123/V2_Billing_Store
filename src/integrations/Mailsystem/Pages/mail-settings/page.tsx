"use client";

import { MailModuleConsole } from "../../Data/console";
import type { MailModuleStore, MailSender } from "../../Data/types";

type IntegrationPageProps = {
  integration?: { id: string; name: string; version: string };
  store?: MailModuleStore;
  onTestConnection?: () => Promise<{
    connected: boolean;
    canSend?: boolean;
    status?: string;
    message?: string;
    sender?: string | null;
    senders: MailSender[];
    error?: string;
  }>;
  canManage?: boolean;
};

/** Admin contribution entrypoint. The host must inject its authenticated store and server-side connection verifier. */
export default function MailSettingsPage({
  integration,
  store,
  onTestConnection,
  canManage = false,
}: IntegrationPageProps) {
  if (!store || !onTestConnection) {
    return (
      <section aria-labelledby="mail-settings-title">
        <h1 id="mail-settings-title">Mail Settings</h1>
        <p>Mail System integration is registered. The host application must provide its authenticated MailModuleStore and server-side connection verifier before settings can be managed.</p>
        {integration && <small>{integration.name} · v{integration.version}</small>}
      </section>
    );
  }

  return <MailModuleConsole store={store} onTestConnection={onTestConnection} canManage={canManage} />;
}
