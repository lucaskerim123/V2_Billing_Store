import {createClient} from "@supabase/supabase-js";
import {BUILTIN_INTEGRATIONS} from "@/lib/integrations/registry.mjs";
import {INTEGRATION_MODULE_RUNTIME} from "@/lib/integrations/generated-runtime";
import {requireIntegrationAdmin,integrationErrorResponse,hasIntegrationPermission} from "@/lib/integrations/admin-context";

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
function serviceDb(){
 if(!SUPABASE_URL||!SERVICE_KEY)throw Object.assign(new Error("Central integration registry service credentials are not configured."),{status:503});
 return createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}

export async function GET(req:Request){
 try{
  const {db,access}=await requireIntegrationAdmin(req,["integrations.view","integrations.manage"]);
  const {data:rows,error}=await db.from("app_integrations").select("integration_id,display_name,version,installed,enabled,updated_at").order("display_name");
  if(error)throw Object.assign(new Error(error.message),{status:503});
  const integrations=BUILTIN_INTEGRATIONS.map(manifest=>{const row=(rows||[]).find((item:any)=>item.integration_id===manifest.id);return {...manifest,state:{installed:row?.installed===true,enabled:row?.enabled===true,version:row?.version||manifest.version,updated_at:row?.updated_at||null},configured:manifest.requiredEnvironment.every((key:string)=>Boolean(process.env[key]?.trim()))};});
  const menu=integrations.filter(item=>item.state.enabled).flatMap(item=>item.contributions.adminMenu.map((entry:any)=>({...entry,integrationId:item.id})));
  return Response.json({integrations,menu,summary:{installedCount:integrations.filter(item=>item.state.installed).length,installableCount:integrations.filter(item=>item.installable).length},permissions:{canView:hasIntegrationPermission(access,"integrations.view")||hasIntegrationPermission(access,"integrations.manage"),canManage:hasIntegrationPermission(access,"integrations.manage")}},{headers:{"cache-control":"no-store"}});
 }catch(error){return integrationErrorResponse(error,"Unable to load integrations.");}
}
export async function PATCH(req:Request){
 try{
  const {db}=await requireIntegrationAdmin(req,["integrations.manage"]);const body=await req.json().catch(()=>({}));
  const id=String(body.integration_id||""),action=String(body.action||"");const manifest=BUILTIN_INTEGRATIONS.find(item=>item.id===id);
  if(!manifest)return Response.json({error:"Integration is not registered in this Billing Store build."},{status:404});
  if(!["install","enable","disable","uninstall"].includes(action))return Response.json({error:"Unsupported integration action."},{status:400});
  let {data:current,error:lookupError}=await db.from("app_integrations").select("installed,enabled").eq("integration_id",id).maybeSingle();
  if(lookupError)throw Object.assign(new Error(lookupError.message),{status:503});
  if(action==="install"&&current?.installed)return Response.json({error:"Integration is already installed."},{status:409});
  const service=(action==="install"||action==="uninstall")?serviceDb():null;
  if(action==="install"){
   const registration={display_name:manifest.name,version:manifest.version,manifest:{id:manifest.id,publisher:manifest.publisher,distribution:manifest.distribution,entrypoints:manifest.entrypoints,contributions:manifest.contributions,features:manifest.features,requires:manifest.requiredEnvironment},updated_at:new Date().toISOString()};
   const result=current
    ?await service!.from("app_integrations").update(registration).eq("integration_id",id)
    :await service!.from("app_integrations").insert({integration_id:id,...registration,installed:false,enabled:false,config:{}});
   if(result.error)throw Object.assign(new Error(result.error.message),{status:503});
   if(!current){const lookup=await db.from("app_integrations").select("installed,enabled").eq("integration_id",id).maybeSingle();if(lookup.error)throw Object.assign(new Error(lookup.error.message),{status:503});current=lookup.data;}
  }
  if(action==="enable"&&current?.installed!==true)return Response.json({error:"Install this integration before enabling it."},{status:409});
  if(action==="enable"&&current?.enabled===true)return Response.json({error:"Integration is already enabled."},{status:409});
  if(action==="disable"&&current?.enabled!==true)return Response.json({error:"Integration is not enabled."},{status:409});
  if(action==="uninstall"&&current?.installed!==true)return Response.json({error:"Integration is not installed."},{status:409});
  if(action==="enable"&&!manifest.requiredEnvironment.every((key:string)=>Boolean(process.env[key]?.trim())))return Response.json({error:"Required server environment variables are missing."},{status:409});
  const serverEntry=(INTEGRATION_MODULE_RUNTIME as any)[id]?.entrypoints?.server;
  const hook=action==="install"?serverEntry?.onInstall:action==="enable"?serverEntry?.onEnable:action==="disable"?serverEntry?.onDisable:serverEntry?.onUninstall;
  if(hook)await hook({integration:{id,name:manifest.name,version:manifest.version},action});
  const {data,error}=await db.rpc("admin_set_integration_state",{p_integration_id:id,p_installed:action!=="uninstall",p_enabled:action==="enable",p_action:action});
  if(error)throw Object.assign(new Error(error.message),{status:error.code==="42501"?403:["23505","23514"].includes(error.code)?409:503});
  if(action==="uninstall"){
   const {error:deleteError}=await service!.from("app_integrations").delete().eq("integration_id",id);
   if(deleteError)throw Object.assign(new Error("Integration was disabled but its central registration could not be fully removed: "+deleteError.message),{status:503});
  }
  return Response.json({ok:true,...(data||{}),cleaned:action==="uninstall"},{headers:{"cache-control":"no-store"}});
 }catch(error){return integrationErrorResponse(error,"Unable to update integration state.");}
}
