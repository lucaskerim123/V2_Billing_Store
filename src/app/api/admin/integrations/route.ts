import {BUILTIN_INTEGRATIONS} from "@/lib/integrations/registry.mjs";
import {requireIntegrationAdmin,integrationErrorResponse,hasIntegrationPermission} from "@/lib/integrations/admin-context";

export async function GET(req:Request){
  try{
    const {db,access}=await requireIntegrationAdmin(req,["integrations.view","integrations.manage"]);
    const {data:rows,error}=await db.from("app_integrations")
      .select("integration_id,display_name,version,installed,enabled,updated_at")
      .order("display_name");
    if(error)throw Object.assign(new Error(error.message),{status:503});
    const integrations=BUILTIN_INTEGRATIONS.map(manifest=>{
      const row=(rows||[]).find((item:any)=>item.integration_id===manifest.id);
      return {
        ...manifest,
        state:{
          installed:row?.installed===true,
          enabled:row?.enabled===true,
          version:row?.version||manifest.version,
          updated_at:row?.updated_at||null
        },
        configured:manifest.requiredEnvironment.every((key:string)=>Boolean(process.env[key]?.trim()))
      };
    });
    return Response.json({
      integrations,
      permissions:{
        canView:hasIntegrationPermission(access,"integrations.view")||hasIntegrationPermission(access,"integrations.manage"),
        canManage:hasIntegrationPermission(access,"integrations.manage")
      }
    },{headers:{"cache-control":"no-store"}});
  }catch(error){return integrationErrorResponse(error,"Unable to load integrations.");}
}

export async function PATCH(req:Request){
  try{
    const {db}=await requireIntegrationAdmin(req,["integrations.manage"]);
    const body=await req.json().catch(()=>({}));
    const id=String(body.integration_id||"");
    const action=String(body.action||"");
    const manifest=BUILTIN_INTEGRATIONS.find(item=>item.id===id);
    if(!manifest)return Response.json({error:"Integration is not registered in this Billing Store build."},{status:404});
    if(!["install","enable","disable","uninstall"].includes(action))return Response.json({error:"Unsupported integration action."},{status:400});
    const {data:current,error:lookupError}=await db.from("app_integrations")
      .select("installed,enabled").eq("integration_id",id).maybeSingle();
    if(lookupError)throw Object.assign(new Error(lookupError.message),{status:503});
    if(!current)return Response.json({error:"Integration database registration is missing. Apply the Billing Storefront database migration first."},{status:503});
    if(action==="enable"&&current.installed!==true)return Response.json({error:"Install this integration before enabling it."},{status:409});
    const installed=action==="install"||action==="enable"||action==="disable";
    const enabled=action==="enable";
    const {data,error}=await db.rpc("admin_set_integration_state",{
      p_integration_id:id,p_installed:installed,p_enabled:enabled,p_action:action
    });
    if(error)throw Object.assign(new Error(error.message),{status:403});
    return Response.json({ok:true,...(data||{})},{headers:{"cache-control":"no-store"}});
  }catch(error){return integrationErrorResponse(error,"Unable to update integration state.");}
}
