import {httpError,loadInstallation,requireOrbitUser,supabaseApi,vercelApi} from "@/lib/orbitfs-deployment";

/**
 * Read-only customer-connection check. Uses the currently stored encrypted
 * provider credentials on the server; no secrets are returned to the browser.
 * Does not create resources, change installation bindings or authorize deploys.
 */
export async function POST(req:Request){
  try{
    const {user}=await requireOrbitUser(req);
    const body=await req.json().catch(()=>({}));
    const provider=String(body.provider||"");
    if(provider!=="supabase"&&provider!=="vercel")
      throw Object.assign(new Error("Choose Supabase or Vercel."),{status:400});
    const install=await loadInstallation(String(body.installationId||""),user.id);
    const checkedAt=new Date().toISOString();
    if(provider==="supabase"){
      const ref=String(install.supabase_project_ref||"").trim();
      if(!ref){
        await supabaseApi(user.id,"/projects");
        return Response.json({ok:true,provider,checkedAt,accountAccessible:true,projectAccessible:null,projectName:null,projectRef:null,message:"Supabase API credentials are valid. Select a database project before deployment."},{headers:{"cache-control":"no-store"}});
      }
      const project=await supabaseApi(user.id,`/projects/${encodeURIComponent(ref)}`);
      return Response.json({ok:true,provider,checkedAt,accountAccessible:true,projectAccessible:true,projectName:String(project?.name||install.supabase_project_name||ref),projectRef:ref,message:"Supabase API and the selected installation project are accessible."},{headers:{"cache-control":"no-store"}});
    }
    const projectId=String(install.vercel_project_id||"").trim();
    const project=await vercelApi(user.id,projectId?`/v9/projects/${encodeURIComponent(projectId)}`:"/v9/projects?limit=1");
    return Response.json({ok:true,provider,checkedAt,accountAccessible:true,projectAccessible:projectId?true:null,projectName:String((projectId?project?.name:null)||install.vercel_project_name||"")||null,projectId:projectId||null,message:projectId?"Vercel API and the deployed installation project are accessible.":"Vercel API is accessible. The project will be checked after deployment."},{headers:{"cache-control":"no-store"}});
  }catch(error){return httpError(error)}
}
