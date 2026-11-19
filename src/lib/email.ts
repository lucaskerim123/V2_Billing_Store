import {deliveryIdentity,loadMailRuntimeConfig} from "@/lib/mail-config-server";
import {sendMailThroughConfiguredTransport} from "@/lib/mail-system-transport";

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  from?: string;
  fromName?: string;
};

export type SendEmailResult = {id:string};

export async function sendEmail(input:SendEmailInput):Promise<SendEmailResult>{
  const config=await loadMailRuntimeConfig();
  const identity=deliveryIdentity(config,input.from);
  const fromName=(input.fromName||identity.name).trim()||"OrbitFS";
  if(!input.html&&!input.text)throw new Error("Email requires html or text content.");
  const response=await sendMailThroughConfiguredTransport({
    from:`${fromName} <${identity.from}>`,
    to:Array.isArray(input.to)?input.to:[input.to],
    subject:input.subject,
    html:input.html,
    text:input.text,
    replyTo:input.replyTo||identity.replyTo,
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(String(payload?.message||payload?.error||`Mail transport failed with status ${response.status}.`));
  if(!payload?.id)throw new Error("Mail transport did not return a provider message id.");
  return {id:String(payload.id)};
}

export function orbitFsEmailTemplate(title:string,bodyHtml:string):string{
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f5f7fb;font-family:Arial,sans-serif;color:#172033">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#f5f7fb">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6eaf2">
          <tr><td style="padding:12px 28px;background:#eef4fb;color:#38526f;font-size:12px;line-height:1.55">Need support or just a quick chat? Email us at <a href="mailto:support@orbitfs.cc" style="color:#1d5ea8">support@orbitfs.cc</a> or submit a ticket through the Customer Portal.</td></tr>
          <tr><td style="padding:24px 28px;background:#111827;color:#ffffff;font-size:22px;font-weight:700">OrbitFS</td></tr>
          <tr><td style="padding:28px">
            <h1 style="margin:0 0 18px;font-size:24px;line-height:1.3">${title}</h1>
            <div style="font-size:15px;line-height:1.7;color:#374151">${bodyHtml}</div>
          </td></tr>
          <tr><td style="padding:18px 28px;border-top:1px solid #eef1f6;color:#6b7280;font-size:12px;text-align:center">OrbitFS is owned and operated by IncendiaryNetworks Inc.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
