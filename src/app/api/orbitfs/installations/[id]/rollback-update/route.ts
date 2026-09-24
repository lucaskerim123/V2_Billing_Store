import {httpError,loadInstallation,requireOrbitUser} from "@/lib/orbitfs-deployment";
import {rollbackCustomerUpdate} from "@/lib/orbitfs-customer-deployer";

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {user}=await requireOrbitUser(req);
    const {id}=await params;
    const install=await loadInstallation(id,user.id);
    const body=await req.json().catch(()=>({}));
    const reason=String(body?.reason||"").trim();
    if(!reason)throw Object.assign(new Error("A rollback reason is required"),{status:400});
    const installation=await rollbackCustomerUpdate(install,reason);
    return Response.json({ok:true,installation},{headers:{"cache-control":"no-store"}});
  }catch(error){return httpError(error)}
}
