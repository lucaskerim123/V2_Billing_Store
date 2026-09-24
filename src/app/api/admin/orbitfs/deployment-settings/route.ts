import {requireOrbitAdmin,httpError} from "@/lib/orbitfs-deployment";
import {userRpc} from "@/lib/paymentServer";

const editable=new Set([
  "enabled",
  "maintenance_mode",
  "customer_deploy_enabled",
  "customer_updates_enabled",
  "customer_rollbacks_enabled"
]);

export async function GET(req:Request){
  try{
    const {token}=await requireOrbitAdmin(req);
    const snapshot=await userRpc(token,"admin_orbitfs_release_system_snapshot",{});
    return Response.json({settings:snapshot?.settings||{},snapshot},{headers:{"cache-control":"no-store"}});
  }catch(error){return httpError(error)}
}

export async function PATCH(req:Request){
  try{
    const {token}=await requireOrbitAdmin(req);
    const body=await req.json().catch(()=>({}));
    const patch:any={};
    for(const key of Object.keys(body||{})){
      if(editable.has(key)&&typeof body[key]==="boolean")patch[key]=body[key];
    }
    if(typeof body?.maintenance_message==="string"&&body.maintenance_message.trim())patch.maintenance_message=body.maintenance_message.trim().slice(0,500);
    if(!Object.keys(patch).length)return Response.json({error:"No deployment settings supplied"},{status:400});
    const settings=await userRpc(token,"admin_update_orbitfs_release_system",{p_patch:patch});
    return Response.json({ok:true,settings},{headers:{"cache-control":"no-store"}});
  }catch(error){return httpError(error)}
}
