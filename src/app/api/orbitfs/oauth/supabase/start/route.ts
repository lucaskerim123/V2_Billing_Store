import {createOAuthState,httpError,requireOrbitUser,requireSystem} from "@/lib/orbitfs-deployment";

const STORE_ORIGIN=(process.env.NEXT_PUBLIC_ORBITFS_STORE_URL||process.env.SITE_URL||"https://orbitfsstore.vercel.app").replace(/\/+$/,"");

export async function POST(req:Request){
  try{
    const {user}=await requireOrbitUser(req);
    const s=await requireSystem("deploy");
    if(!s.supabase_oauth_enabled)throw Object.assign(new Error("Supabase customer connection is disabled"),{status:503});
    if(!s.supabase_client_id)throw Object.assign(new Error("OrbitFS Supabase OAuth App is not configured"),{status:503});
    const body=await req.json().catch(()=>({}));
    const state=await createOAuthState(user.id,"supabase",body.installationId||null,"/portal/orbitfs");
    const redirect=`${STORE_ORIGIN}/api/orbitfs/oauth/supabase/callback`;
    const u=new URL("https://api.supabase.com/v1/oauth/authorize");
    u.searchParams.set("client_id",s.supabase_client_id);
    u.searchParams.set("response_type","code");
    u.searchParams.set("redirect_uri",redirect);
    u.searchParams.set("state",state);
    return Response.json({url:u.toString(),callback:redirect});
  }catch(e){return httpError(e)}
}
