import {createClient} from "@supabase/supabase-js";
import {INTEGRATION_MODULE_RUNTIME} from "@/lib/integrations/generated-runtime";
import {BUILTIN_INTEGRATIONS,canRunIntegration} from "@/lib/integrations/registry";

export const dynamic="force-dynamic";
export async function GET(req:Request){
 const secret=process.env.INTEGRATION_SCHEDULER_SECRET||"";
 const authorization=req.headers.get("authorization")||"";
 if(!secret||authorization!==`Bearer ${secret}`)return Response.json({error:"Unauthorized scheduler request."},{status:401});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"",key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
 if(!url||!key)return Response.json({error:"Integration scheduler storage is not configured."},{status:503});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:states,error}=await db.from("app_integrations").select("integration_id,installed,enabled").eq("installed",true).eq("enabled",true);
 if(error)return Response.json({error:"Unable to load enabled integrations."},{status:503});
 const results=[];
 for(const state of states||[]){
  if(!canRunIntegration(state))continue;
  const manifest=BUILTIN_INTEGRATIONS.find(item=>item.id===state.integration_id);
  const job=(INTEGRATION_MODULE_RUNTIME as any)[state.integration_id]?.entrypoints?.server?.runScheduled;
  if(!manifest||typeof job!=="function")continue;
  try{await job({integration:{id:manifest.id,name:manifest.name,version:manifest.version},scheduledAt:new Date().toISOString()});results.push({id:manifest.id,ok:true});}
  catch(error){results.push({id:manifest.id,ok:false,error:error instanceof Error?error.message:"Scheduled job failed."});}
 }
 return Response.json({ok:results.every(item=>item.ok),results},{headers:{"cache-control":"no-store"}});
}
