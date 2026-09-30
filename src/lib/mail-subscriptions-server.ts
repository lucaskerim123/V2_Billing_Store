/**
 * Central customer email opt-out decision for server-originated messages.
 * This reads Billing's subscription policy, never release/deployment authority.
 * Query failures stop delivery rather than silently bypassing customer preferences.
 */
export async function customerAllowsMail(
  db:any,
  recipientEmail:string,
  eventKey:string,
  templateKey?:string|null
):Promise<boolean>{
  const {data,error}=await db.rpc("mail_subscription_allowed",{
    p_recipient_email:String(recipientEmail||"").trim(),
    p_event_key:String(eventKey||"").trim(),
    p_template_key:templateKey||null
  });
  if(error)throw new Error("Mail subscription check failed: "+error.message);
  return data===true;
}
