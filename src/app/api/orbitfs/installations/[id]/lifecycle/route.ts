import {httpError,loadInstallation,requireOrbitUser} from "@/lib/orbitfs-deployment";
import {executeOrbitfsLifecycle,planOrbitfsLifecycle,type OrbitfsLifecycleAction} from "@/lib/orbitfs-lifecycle";

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {user}=await requireOrbitUser(req),{id}=await params,body=await req.json().catch(()=>({}));
    const install=await loadInstallation(id,user.id);
    const raw=String(body.action||"").trim().toLowerCase();
    if(raw==="plan"){
      const mode=String(body.mode||body.lifecycleAction||"").trim().toLowerCase() as OrbitfsLifecycleAction;
      if(!["undeploy","uninstall"].includes(mode))throw Object.assign(new Error("Lifecycle plan mode must be undeploy or uninstall"),{status:400});
      return Response.json(await planOrbitfsLifecycle(install,mode,body));
    }
    if(raw==="undeploy"||raw==="uninstall"){
      return Response.json(await executeOrbitfsLifecycle(install,raw as OrbitfsLifecycleAction,body));
    }
    // Backward compatibility for the previous deregister action.
    if(raw==="deregister"){
      return Response.json(await executeOrbitfsLifecycle(install,"uninstall",{...body,removeDatabase:false,removeStorage:false,releaseLicense:true}));
    }
    throw Object.assign(new Error("Unsupported installation lifecycle action"),{status:400});
  }catch(e){return httpError(e)}
}
