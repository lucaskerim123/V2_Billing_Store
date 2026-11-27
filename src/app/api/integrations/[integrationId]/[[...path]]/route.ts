import {createClient} from "@supabase/supabase-js";
import {INTEGRATION_MODULE_RUNTIME} from "@/lib/integrations/generated-runtime";
import {getBuiltinIntegration,canRunIntegration} from "@/lib/integrations/runtime";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"",key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
async function dispatch(request:Request,{params}:{params:Promise<{integrationId:string;path?:string[]}>}){
 const {integrationId,path=[]}=await params;
 const manifest=getBuiltinIntegration(integrationId);
 const server=(INTEGRATION_MODULE_RUNTIME as any)[integrationId]?.entrypoints?.server;
 if(!manifest||typeof server?.handleRequest!=="function")return Response.json({error:"Integration service route not found."},{status:404});
 if(!url||!key)return Response.json({error:"Integration runtime storage is not configured."},{status:503});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:state,error}=await db.from("app_integrations").select("installed,enabled").eq("integration_id",integrationId).maybeSingle();
 if(error)return Response.json({error:"Unable to verify integration state."},{status:503});
 if(!canRunIntegration(state))return Response.json({error:"Integration is not enabled."},{status:404});
 try{
  const result=await server.handleRequest(request,{integration:{id:manifest.id,name:manifest.name,version:manifest.version},path});
  return result instanceof Response?result:Response.json(result??{ok:true});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"Integration request failed."},{status:500});}
}
export const GET=dispatch;
export const POST=dispatch;
export const PUT=dispatch;
export const PATCH=dispatch;
export const DELETE=dispatch;
export const OPTIONS=dispatch;
