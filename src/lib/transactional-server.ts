import {sendBillingMailEvent} from "@/lib/integrations/mail/server";

/**
 * Compatibility entrypoint for existing trusted Billing Store event producers.
 * Templates, recipient resolution, sender routing and delivery are owned by the
 * registered Mail integration. No legacy transport or queue is used.
 */
export async function sendAutomation(
  eventKey:string,
  to:string,
  vars:Record<string,string>,
  relatedType?:string,
  relatedId?:string
){
  return sendBillingMailEvent({
    eventKey,
    recipient:to,
    variables:vars,
    relatedType,
    relatedId
  });
}
