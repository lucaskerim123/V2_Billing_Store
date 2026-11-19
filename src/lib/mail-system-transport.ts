export type MailTransportInput = {
  from: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  cc?: string[];
  bcc?: string[];
  attachments?: { filename: string; content: string; content_type?: string }[];
};

const addressOf = (value: string) => {
  const match = String(value || "").match(/<([^>]+)>/);
  return (match ? match[1] : String(value || "")).trim().toLowerCase();
};

async function responsePayload(response: Response) {
  const raw = await response.text();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { message: raw }; }
}

/**
 * Prefer the central Mail System when configured. Resend remains a temporary
 * compatibility transport until the Mail System key and sender assignments
 * have been provisioned for this application.
 */
export async function sendMailThroughConfiguredTransport(input: MailTransportInput): Promise<Response> {
  const mailUrl = String(process.env.MAIL_SYSTEM_URL || "").trim().replace(/\/+$/, "");
  const mailKey = String(process.env.MAIL_SYSTEM_API_KEY || "").trim();
  if (mailUrl || mailKey) {
    if (!mailUrl || !mailKey) {
      return Response.json({ message: "Both MAIL_SYSTEM_URL and MAIL_SYSTEM_API_KEY must be configured." }, { status: 503 });
    }
    try {
      const directoryResponse = await fetch(mailUrl + "/api/mail/senders", {
        headers: { Authorization: "Bearer " + mailKey }, cache: "no-store",
      });
      const directory: any = await responsePayload(directoryResponse);
      if (!directoryResponse.ok) {
        return Response.json({ message: directory.error || "Mail System sender lookup failed." }, { status: directoryResponse.status });
      }
      const requestedSender = addressOf(input.from);
      const assigned = (directory.senders || []).some((sender: any) =>
        String(sender.address || "").trim().toLowerCase() === requestedSender,
      );
      if (!assigned) {
        return Response.json({ message: "The selected Billing Store sender is not assigned to its Mail System integration." }, { status: 403 });
      }
      const response = await fetch(mailUrl + "/api/mail", {
        method: "POST",
        headers: { Authorization: "Bearer " + mailKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          from_address: input.from,
          to: input.to,
          subject: input.subject,
          text: input.text,
          html: input.html,
          reply_to: input.replyTo,
          headers: input.headers || {},
          cc: input.cc,
          bcc: input.bcc,
      attachments: input.attachments,
          attachments: input.attachments,
        }),
        cache: "no-store",
      });
      const result: any = await responsePayload(response);
      return Response.json({
        id: result.providerId || result.id || null,
        message: result.error || result.message || null,
        mailSystemMessageId: result.id || null,
      }, { status: response.status });
    } catch (error) {
      return Response.json({ message: error instanceof Error ? error.message : "Mail System request failed." }, { status: 502 });
    }
  }

  const resendKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!resendKey) return Response.json({ message: "Configure MAIL_SYSTEM_URL and MAIL_SYSTEM_API_KEY, or RESEND_API_KEY during migration." }, { status: 503 });
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + resendKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: input.from,
      to: Array.isArray(input.to) ? input.to : [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
      reply_to: input.replyTo,
      headers: input.headers,
      cc: input.cc,
      bcc: input.bcc,
    }),
    cache: "no-store",
  });
}
