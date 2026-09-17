import {httpError,loadInstallation,requireOrbitUser,type DeployAction} from "@/lib/orbitfs-deployment";
import {runCustomerDeployer} from "@/lib/orbitfs-customer-deployer";

const allowed=new Set<DeployAction>(["deploy","update","rollback","redeploy"]);

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {user}=await requireOrbitUser(req);
    const {id}=await params;
    const body=await req.json().catch(()=>({}));
    const action=String(body.action||"deploy") as DeployAction;
    if(!allowed.has(action))throw Object.assign(new Error("Unsupported deployment action"),{status:400});
    const install=await loadInstallation(id,user.id);
    const version=body.version?String(body.version).trim():undefined;
    const installation=await runCustomerDeployer(install,action,version);
    return Response.json({ok:true,installation},{headers:{"cache-control":"no-store"}});
  }catch(error){return httpError(error)}
}
