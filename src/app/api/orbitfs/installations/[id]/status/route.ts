import {httpError,loadInstallation,requireOrbitUser,syncDeployment,ensureStandardPanelProtection} from "@/lib/orbitfs-deployment";
import {reconcileOrbitfsInstallation} from "@/lib/orbitfs-lifecycle";

export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {user}=await requireOrbitUser(req),{id}=await params;
    let install=await loadInstallation(id,user.id);
    install=await reconcileOrbitfsInstallation(install);
    if(!install.vercel_project_id||!install.vercel_deployment_id)return Response.json({installation:install},{headers:{"cache-control":"no-store"}});
    return Response.json({installation:await syncDeployment(install)},{headers:{"cache-control":"no-store"}});
  }catch(e){return httpError(e)}
}

// Explicit customer repair action: re-scope this installation's Vercel Authentication
// to protect generated URLs, then re-resolve its public production domain.
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const {user}=await requireOrbitUser(req),{id}=await params;
  let install=await loadInstallation(id,user.id);
  if(!install.vercel_project_id||!install.vercel_deployment_id)return Response.json({error:"Deploy Base before repairing public access"},{status:409});
  await ensureStandardPanelProtection(install);
  install=await syncDeployment(install);
  return Response.json({installation:install},{headers:{"cache-control":"no-store"}});
 }catch(e){return httpError(e)}
}
