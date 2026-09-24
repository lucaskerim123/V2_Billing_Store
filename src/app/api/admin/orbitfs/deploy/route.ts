import {httpError,loadInstallation,type DeployAction} from "@/lib/orbitfs-deployment";
import {requireOrbitDeploymentAdmin} from "@/lib/orbitfs-deployment-auth";
import {reconcileOrbitfsInstallation} from "@/lib/orbitfs-lifecycle";
import {runCustomerDeployer} from "@/lib/orbitfs-customer-deployer";

const allowed=new Set<DeployAction>(["deploy","update","rollback","redeploy"]);

export async function POST(req:Request){
  try{
    await requireOrbitDeploymentAdmin(req);
    const body=await req.json().catch(()=>({}));
    const installationId=String(body.installationId||body.installation_id||"").trim();
    const action=String(body.action||"deploy") as DeployAction;
    if(!installationId)throw Object.assign(new Error("Installation ID is required"),{status:400});
    if(!allowed.has(action))throw Object.assign(new Error("Unsupported deployment action"),{status:400});
    let install=await loadInstallation(installationId,"",true);
    install=await reconcileOrbitfsInstallation(install);
    if(action==="redeploy"&&!install.release_version)throw Object.assign(new Error("The Panel is not currently deployed. Use Deploy to create a new Vercel project."),{status:409});
    let version=body.version?String(body.version).trim():undefined;
    let releaseId=body.releaseId?String(body.releaseId).trim():undefined;
    if(version?.startsWith("release:")&&!releaseId){releaseId=version.slice(8).trim()||undefined;version=undefined}
    if(version?.startsWith("update:"))version=version.slice(7).trim()||undefined;
    const channel=String(body.channel||install.release_channel||"stable").trim().toLowerCase();
    if(!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(channel))throw Object.assign(new Error("Invalid release channel"),{status:400});
    const reason=body.reason?String(body.reason).trim():undefined;
    return Response.json({installation:await runCustomerDeployer(install,action,version,channel,releaseId,reason)},{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}
