import {httpError,requireOrbitAdmin} from "@/lib/orbitfs-deployment";
import {userRpc} from "@/lib/paymentServer";

const ALLOWED=new Set(["enabled","maintenance_mode","maintenance_message","customer_deploy_enabled","customer_updates_enabled","customer_rollbacks_enabled"]);

export async function GET(req:Request){
  try{
    const {token}=await requireOrbitAdmin(req);
    const snapshot=await userRpc(token,"admin_orbitfs_release_system_snapshot",{});
    return Response.json(snapshot||{}, {headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}

export async function PATCH(req:Request){
  try{
    const {token}=await requireOrbitAdmin(req);
    const body=await req.json().catch(()=>({}));
    const patch:any={};
    for(const [key,value] of Object.entries(body||{}))if(ALLOWED.has(key))patch[key]=value;
    if(!Object.keys(patch).length)return Response.json({error:"No supported Billing Store delivery controls were supplied"},{status:400});
    const settings=await userRpc(token,"admin_update_orbitfs_release_system",{p_patch:patch});
    return Response.json({ok:true,settings},{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}