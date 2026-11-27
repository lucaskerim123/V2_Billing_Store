import {createClient} from "@supabase/supabase-js";
import {requireIntegrationAdmin,integrationErrorResponse} from "@/lib/integrations/admin-context";
import {getBuiltinIntegration} from "@/lib/integrations/registry";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
const KEY=/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
async function context(req:Request,integrationId:string){
 const admin=await requireIntegrationAdmin(req,["integrations.manage"]);
 const manifest=getBuiltinIntegration(integrationId);
 if(!manifest)throw Object.assign(new Error("Integration package not found."),{status:404});
 const {data:state,error}=await admin.db.from("app_integrations").select("installed").eq("integration_id",integrationId).maybeSingle();
 if(error)throw Object.assign(new Error(error.message),{status:503});
 if(state?.installed!==true)throw Object.assign(new Error("Install the integration before managing its data."),{status:409});
 if(!url||!serviceKey)throw Object.assign(new Error("Server-side integration storage is not configured."),{status:503});
 return {manifest,storage:createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})};
}
export async function GET(req:Request,{params}:{params:Promise<{integrationId:string}>}){
 try{const {integrationId}=await params;const {storage}=await context(req,integrationId);const key=new URL(req.url).searchParams.get("key");
  if(key&&!KEY.test(key))return Response.json({error:"Invalid data key."},{status:400});
  let query=storage.from("app_integration_data").select("data_key,data,updated_at").eq("integration_id",integrationId);
  if(key)query=query.eq("data_key",key);
  const {data,error}=await query.order("data_key");if(error)throw Object.assign(new Error(error.message),{status:503});
  return Response.json({items:data||[]},{headers:{"cache-control":"no-store"}});
 }catch(error){return integrationErrorResponse(error,"Unable to read integration data.");}
}
export async function PUT(req:Request,{params}:{params:Promise<{integrationId:string}>}){
 try{const {integrationId}=await params;const {storage}=await context(req,integrationId);const body=await req.json().catch(()=>null);
  if(!body||typeof body.key!=="string"||!KEY.test(body.key)||!("data" in body))return Response.json({error:"A valid key and data value are required."},{status:400});
  const serialized=JSON.stringify(body.data);if(serialized.length>65536)return Response.json({error:"Integration data values are limited to 64 KB."},{status:413});
  const {data,error}=await storage.from("app_integration_data").upsert({integration_id:integrationId,data_key:body.key,data:body.data,updated_at:new Date().toISOString()},{onConflict:"integration_id,data_key"}).select("data_key,data,updated_at").single();
  if(error)throw Object.assign(new Error(error.message),{status:503});
  return Response.json({ok:true,item:data},{headers:{"cache-control":"no-store"}});
 }catch(error){return integrationErrorResponse(error,"Unable to save integration data.");}
}
export async function DELETE(req:Request,{params}:{params:Promise<{integrationId:string}>}){
 try{const {integrationId}=await params;const {storage}=await context(req,integrationId);const key=new URL(req.url).searchParams.get("key");
  if(!key||!KEY.test(key))return Response.json({error:"A valid data key is required."},{status:400});
  const {error}=await storage.from("app_integration_data").delete().eq("integration_id",integrationId).eq("data_key",key);
  if(error)throw Object.assign(new Error(error.message),{status:503});
  return Response.json({ok:true,deleted:key},{headers:{"cache-control":"no-store"}});
 }catch(error){return integrationErrorResponse(error,"Unable to delete integration data.");}
}
