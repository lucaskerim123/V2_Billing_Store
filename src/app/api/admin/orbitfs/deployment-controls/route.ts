import {userRpc} from "@/lib/paymentServer";
import {httpError,requireOrbitAdmin} from "@/lib/orbitfs-deployment";

const allowed=new Set([
  "enabled","maintenance_mode","maintenance_message",
  "customer_deploy_enabled","customer_updates_enabled","customer_rollbacks_enabled"
]);

export async function GET(req:Request){
  try{
    const {token}=await requireOrbitAdmin(req);
    const settings=await userRpc(token,"orbitfs_release_public_settings",{});
    return Response.json({settings,authority:"billing_store_customer_gate"},{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}

export async function POST(req:Request){
  try{
    const {token}=await requireOrbitAdmin(req);
    const body=await req.json().catch(()=>({}));
    const patch:any={};
    for(const [key,value] of Object.entries(body))if(allowed.has(key))patch[key]=value;
    if(!Object.keys(patch).length)throw Object.assign(new Error("No deployment control fields supplied"),{status:400});
    const settings=await userRpc(token,"admin_update_orbitfs_release_system",{p_patch:patch});
    return Response.json({settings,authority:"billing_store_customer_gate"},{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}
