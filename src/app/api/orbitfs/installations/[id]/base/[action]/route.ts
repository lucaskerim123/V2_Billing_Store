import {httpError,loadInstallation,requireOrbitUser} from "@/lib/orbitfs-deployment";
import {baseIdempotencyKey,runBaseLifecycleOperation,type BaseLifecycleAction} from "@/lib/orbitfs-base-operations";
import {completePendingBaseForceReinstall,pendingBaseForceReinstall} from "@/lib/orbitfs-force-reinstall";

const ACTIONS:Record<string,BaseLifecycleAction>={
  install:"deploy",
  update:"base_update",
  redeploy:"redeploy",
  rollback:"rollback"
};

export async function POST(req:Request,{params}:{params:Promise<{id:string;action:string}>}){
  try{
    const {user}=await requireOrbitUser(req);
    const {id,action:rawAction}=await params;
    const action=ACTIONS[String(rawAction||"").trim().toLowerCase()];
    if(!action)throw Object.assign(new Error("Unsupported Base lifecycle action"),{status:400,code:"BASE_ACTION_UNSUPPORTED"});
    const body=await req.json().catch(()=>({}));
    const install=await loadInstallation(id,user.id);
    if(action==="deploy"&&pendingBaseForceReinstall(install)){
      const completion=await completePendingBaseForceReinstall(install);
      return Response.json({ok:true,...completion},{headers:{"cache-control":"no-store"}});
    }
    const idempotencyKey=baseIdempotencyKey(req,body,true);
    const channel=String(body.channel||install.release_channel||"stable").trim().toLowerCase();
    if(!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(channel))throw Object.assign(new Error("Invalid release channel"),{status:400,code:"RELEASE_CHANNEL_INVALID"});
    let releaseId=body.releaseId?String(body.releaseId).trim():undefined;
    let version=body.version?String(body.version).trim():undefined;
    const reason=body.reason?String(body.reason).trim():undefined;

    if(action==="base_update"&&!releaseId)throw Object.assign(new Error("Base update requires an explicit published release ID."),{status:400,code:"BASE_UPDATE_RELEASE_REQUIRED"});
    if(action==="deploy"&&!releaseId)throw Object.assign(new Error("Base install requires an explicit published release ID."),{status:400,code:"BASE_INSTALL_RELEASE_REQUIRED"});
    if(action==="redeploy"){
      // Redeploy means "deploy the current published Base for this channel".
      // Historical installation release ids are audit/rollback metadata only.
      releaseId=undefined;
      version=undefined;
      if(!install.vercel_project_id)throw Object.assign(new Error("The installation does not have an existing Base project to redeploy."),{status:409,code:"BASE_PROJECT_MISSING"});
    }
    if(action==="rollback"&&!reason)throw Object.assign(new Error("A rollback reason is required."),{status:400,code:"ROLLBACK_REASON_REQUIRED"});

    const result=await runBaseLifecycleOperation({install,action,version,channel,releaseId,reason,idempotencyKey});
    return Response.json({ok:true,...result},{headers:{"cache-control":"no-store"}});
  }catch(error){
    return httpError(error);
  }
}
