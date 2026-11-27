import {createClient} from "@supabase/supabase-js";
import {requireIntegrationAdmin,integrationErrorResponse} from "@/lib/integrations/admin-context";
import {getBuiltinIntegration} from "@/lib/integrations/registry";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"",serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
const KEY=/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
async function context(req:Request,integrationId:string){
 const admin=await requireIntegrationAdmin(req,["integrations.manage"]);
 if(!getBuiltinIntegration(integrationId))throw Object.assign(new Error("Integration package not found."),{status:404});
 const {data:state,error}=await admin.db.from("app_integrations").select("installed").eq("integration_id",integrationId).maybeSingle();
 if(error)throw Object.assign(new Error(error.message),{status:503});
 if(state?.installed!==true)throw Object.assign(new Error("Install the integration before managing its data."),{status:409});
 if(!url||!serviceKey)throw Object.assign(new Error("Central integration storage credentials are not configured."),{status:503});
 return createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
}
async function mutateConfig(db:any,integrationId:string,key:string,value:unknown,remove=false){
 for(let attempt=0;attempt<4;attempt++){
  const {data:row,error:readError}=await db.from("app_integrations").select("config,updated_at").eq("integration_id",integrationId).single();
  if(readError)throw Object.assign(new Error(readError.message),{status:503});
  const config=row.config&&typeof row.config==="object"&&!Array.isArray(row.config)?{...row.config}:{};
  if(remove)delete config[key];else config[key]=value;
  const serialized=JSON.stringify(config);
  if(serialized.length>262144)throw Object.assign(new Error("Integration configuration is limited to 256 KB."),{status:413});
  const nextUpdatedAt=new Date(Math.max(Date.now(),Date.parse(row.updated_at||"1970-01-01T00:00:00.000Z")+1)).toISOString();
  let query=db.from("app_integrations").update({config,updated_at:nextUpdatedAt}).eq("integration_id",integrationId);
  if(row.updated_at)query=query.eq("updated_at",row.updated_at);
  const {data,error}=await query.select("updated_at").maybeSingle();
  if(error)throw Object.assign(new Error(error.message),{status:503});
  if(data)return config;
 }
 throw Object.assign(new Error("Integration configuration changed concurrently. Retry the update."),{status:409});
}
export async function GET(req:Request,{params}:{params:Promise<{integrationId:string}>}){
 try{
  const {integrationId}=await params,db=await context(req,integrationId),key=new URL(req.url).searchParams.get("key");
  if(key&&!KEY.test(key))return Response.json({error:"Invalid data key."},{status:400});
  const {data,error}=await db.from("app_integrations").select("config").eq("integration_id",integrationId).single();
  if(error)throw Object.assign(new Error(error.message),{status:503});
  const config=data.config&&typeof data.config==="object"&&!Array.isArray(data.config)?data.config:{};
  return Response.json(key?{key,value:config[key]??null}:{config},{headers:{"cache-control":"no-store"}});
 }catch(error){return integrationErrorResponse(error,"Unable to read integration data.");}
}
export async function PUT(req:Request,{params}:{params:Promise<{integrationId:string}>}){
 try{
  const {integrationId}=await params,db=await context(req,integrationId),body=await req.json().catch(()=>null);
  if(!body||typeof body.key!=="string"||!KEY.test(body.key)||!("data" in body))return Response.json({error:"A valid key and data value are required."},{status:400});
  if(JSON.stringify(body.data).length>65536)return Response.json({error:"Each integration data value is limited to 64 KB."},{status:413});
  const config=await mutateConfig(db,integrationId,body.key,body.data);
  return Response.json({ok:true,key:body.key,value:config[body.key]},{headers:{"cache-control":"no-store"}});
 }catch(error){return integrationErrorResponse(error,"Unable to save integration data.");}
}
export async function DELETE(req:Request,{params}:{params:Promise<{integrationId:string}>}){
 try{
  const {integrationId}=await params,db=await context(req,integrationId),key=new URL(req.url).searchParams.get("key");
  if(!key||!KEY.test(key))return Response.json({error:"A valid data key is required."},{status:400});
  await mutateConfig(db,integrationId,key,null,true);
  return Response.json({ok:true,deleted:key},{headers:{"cache-control":"no-store"}});
 }catch(error){return integrationErrorResponse(error,"Unable to delete integration data.");}
}
