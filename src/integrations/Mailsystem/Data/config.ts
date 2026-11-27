export type MailModuleConfig = {
  baseUrl: string;
  apiKey: string;
};

export function getMailModuleConfig(
  env: NodeJS.ProcessEnv = process.env,
): MailModuleConfig {
  if (typeof window !== "undefined") {
    throw new Error("Mail System credentials are server-only and cannot be read in a browser.");
  }

  const baseUrl = String(env.MAIL_SYSTEM_URL ?? "")
    .trim()
    .replace(/\/$/, "");
  const apiKey = String(env.MAIL_SYSTEM_API_KEY ?? "").trim();

  if (!/^https:\/\//i.test(baseUrl)) {
    throw new Error("MAIL_SYSTEM_URL must be HTTPS.");
  }

  if (!apiKey) {
    throw new Error("MAIL_SYSTEM_API_KEY is missing.");
  }

  return {
    baseUrl,
    apiKey,
  };
}
