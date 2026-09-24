import {httpError,requireOrbitUser,requireSystem} from "@/lib/orbitfs-deployment";
import {userRpc} from "@/lib/paymentServer";

export async function POST(req:Request){
  try{
    const {token}=await requireOrbitUser(req);
    await requireSystem("deploy");
    const body=await req.json().catch(()=>({}));
    const bindingId=String(body?.bindingId||body?.binding_id||"").trim();
    if(!bindingId)throw Object.assign(new Error("OrbitFS license binding is required"),{status:400});
    const installation=await userRpc(token,"ensure_orbitfs_installation",{p_binding_id:bindingId});
    return Response.json({ok:true,installation},{headers:{"cache-control":"no-store"}});
  }catch(error){return httpError(error)}
}
