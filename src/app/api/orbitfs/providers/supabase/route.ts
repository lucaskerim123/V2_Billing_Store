import {createSupabaseProject,disconnectProviderConnection,httpError,listSupabaseResources,loadInstallation,requireOrbitUser,selectSupabaseProject} from "@/lib/orbitfs-deployment";

export async function GET(req:Request){try{const {user}=await requireOrbitUser(req);return Response.json(await listSupabaseResources(user.id),{headers:{"cache-control":"no-store"}})}catch(e){return httpError(e)}}
export async function POST(req:Request){
  try{const {user}=await requireOrbitUser(req);const body=await req.json().catch(()=>({}));if(body.action==="disconnect")return Response.json({ok:Boolean(await disconnectProviderConnection(user.id,"supabase"))});const install=await loadInstallation(String(body.installationId||""),user.id);if(body.action==="select")return Response.json({installation:await selectSupabaseProject(install,String(body.projectRef||""))});if(body.action==="create")return Response.json({installation:await createSupabaseProject(install,body)});throw Object.assign(new Error("Unsupported Supabase project action"),{status:400})}catch(e){return httpError(e)}
}
