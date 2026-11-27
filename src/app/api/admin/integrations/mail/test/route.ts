import {verifyMailSystemConnection} from "@/integrations/mail/client";
import {requireIntegrationAdmin,integrationErrorResponse} from "@/lib/integrations/admin-context";

export async function POST(req:Request){
  try{
    const {db}=await requireIntegrationAdmin(req,["integrations.view","integrations.manage"]);
    const {data:state,error}=await db.from("app_integrations")
      .select("installed").eq("integration_id","mail").maybeSingle();
    if(error)throw Object.assign(new Error(error.message),{status:503});
    if(!state?.installed)return Response.json({error:"Mail integration is not installed."},{status:409});
    const result=await verifyMailSystemConnection();
    return Response.json(result,{headers:{"cache-control":"no-store"}});
  }catch(error){return integrationErrorResponse(error,"Mail connection test failed.");}
}
