import {requireIntegrationAdmin,integrationErrorResponse} from "@/lib/integrations/admin-context";
import {getMailModuleConfig} from "@/integrations/Mailsystem/Data/config";
export const runtime="nodejs";
export async function POST(req:Request){
 try{
  const {db}=await requireIntegrationAdmin(req,["integrations.manage","integrations.mail.manage"]);
  const {data:state,error}=await db.from("app_integrations").select("installed,enabled").eq("integration_id","mailsystem").maybeSingle();
  if(error)throw error;
  if(!state?.installed||!state.enabled)throw Object.assign(new Error("Install and enable Mail System first."),{status:409});
  const body=await req.json().catch(()=>null);
  if(!Array.isArray(body?.mailboxes)||body.mailboxes.length>100)throw Object.assign(new Error("Provide up to 100 mailboxes."),{status:400});
  const config=await getMailModuleConfig();
  const response=await fetch(config.baseUrl+"/api/integrations/mailboxes",{method:"POST",headers:{Authorization:"Bearer "+config.apiKey,"Content-Type":"application/json"},body:JSON.stringify({mailboxes:body.mailboxes}),cache:"no-store"});
  const result=await response.json().catch(()=>({}));
  return Response.json(result,{status:response.status,headers:{"cache-control":"no-store"}});
 }catch(error){return integrationErrorResponse(error,"Unable to provision mailbox.");}
}
