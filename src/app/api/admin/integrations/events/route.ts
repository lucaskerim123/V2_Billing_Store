import {BILLING_EMAIL_EVENTS} from "@/lib/billing-email-events.mjs";
import {requireIntegrationAdmin,integrationErrorResponse,hasIntegrationPermission} from "@/lib/integrations/admin-context";

/** Read-only host contract for trusted integrations. Events are defined by Billing Store. */
export async function GET(req:Request){
  try{
    const {access}=await requireIntegrationAdmin(req,["integrations.view","integrations.manage"]);
    return Response.json({
      events:BILLING_EMAIL_EVENTS,
      ownership:"billing-store",
      permissions:{
        canView:hasIntegrationPermission(access,"integrations.view")||hasIntegrationPermission(access,"integrations.manage"),
        canManage:hasIntegrationPermission(access,"integrations.manage")
      }
    },{headers:{"cache-control":"no-store"}});
  }catch(error){return integrationErrorResponse(error,"Unable to load Billing Store events.");}
}
