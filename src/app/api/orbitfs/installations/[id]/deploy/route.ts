import {httpError,loadInstallation,requireOrbitUser,type DeployAction} from "@/lib/orbitfs-deployment";
import {customerReleaseChannels} from "@/lib/orbitfs-release-channels";
import {runCustomerDeployer} from "@/lib/orbitfs-customer-deployer";

const allowed=new Set<DeployAction>(["deploy","update","rollback","redeploy"]);

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {user}=await requireOrbitUser(req);
    const {id}=await params;
    const body=await req.json().catch(()=>({}));
    const rawAction=String(body.action||"deploy");
    const install=await loadInstallation(id,user.id);
    if(rawAction==="set_channel"){
      const channel=String(body.channel||"").trim().toLowerCase();
      if(!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(channel))throw Object.assign(new Error("Invalid release channel"),{status:400});
      const allowedChannels=await customerReleaseChannels(user.id,install.license_binding_id||null);
      if(!allowedChannels.includes(channel))throw Object.assign(new Error("Release channel is not available for this customer"),{status:403});
      const {data,error}=await (await import("@/lib/license-api")).licenseDb().from("orbitfs_installations").update({release_channel:channel,updated_at:new Date().toISOString()}).eq("id",install.id).eq("auth_user_id",user.id).select().single();
      if(error)throw error;
      return Response.json({installation:data});
    }
    const action=rawAction as DeployAction;
    if(!allowed.has(action))throw Object.assign(new Error("Unsupported deployment action"),{status:400});
    let version=body.version?String(body.version).trim():undefined;
    let releaseId=body.releaseId?String(body.releaseId).trim():undefined;
    if(version?.startsWith("release:")&&!releaseId){releaseId=version.slice(8).trim()||undefined;version=undefined}
    if(version?.startsWith("update:"))version=version.slice(7).trim()||undefined;
    const channel=String(body.channel||install.release_channel||"stable").trim().toLowerCase();
    if(!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(channel))throw Object.assign(new Error("Invalid release channel"),{status:400});
    const reason=body.reason?String(body.reason).trim():undefined;
    const installation=await runCustomerDeployer(install,action,version,channel,releaseId,reason);
    return Response.json({ok:true,installation},{headers:{"cache-control":"no-store"}});
  }catch(error){return httpError(error)}
}
