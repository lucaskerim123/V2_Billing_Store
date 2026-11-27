import {getBillingEmailEvent} from "@/lib/billing-email-events.mjs";

/**
 * Billing-owned event publisher boundary.
 * Business event keys and payload contracts live in Billing Store. Delivery is
 * intentionally unavailable until a separately installed integration provides
 * the transport/configuration adapter.
 */
export async function sendAutomation(
  eventKey:string,
  _to:string,
  _vars:Record<string,string>,
  _relatedType?:string,
  _relatedId?:string
){
  if(!getBillingEmailEvent(eventKey)){
    throw new Error("Unknown Billing Store email event: "+eventKey);
  }
  return {ok:true,skipped:true as const,eventKey,reason:"no_email_integration_installed"};
}
