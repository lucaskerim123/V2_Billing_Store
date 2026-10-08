import {createOAuthState,httpError,requireOrbitUser,requireSetupSystem} from "@/lib/orbitfs-deployment";
import {orbitfsStoreUrl} from "@/lib/site-origin";
import {serviceRpc} from "@/lib/paymentServer";

export async function POST(req:Request){
  try{
    const {user}=await requireOrbitUser(req);
    const s=await requireSetupSystem();
    if(!s.supabase_oauth_enabled)throw Object.assign(new Error("Supabase customer connection is disabled"),{status:503});
    if(!s.supabase_client_id)throw Object.assign(new Error("OrbitFS Supabase OAuth App client ID is not configured"),{status:503});
    const secret=String(await serviceRpc("service_orbitfs_release_secret",{p_key:"supabase_client_secret"})||process.env.ORBITFS_SUPABASE_CLIENT_SECRET||"").trim();
    if(!secret)throw Object.assign(new Error("OrbitFS Supabase OAuth App client secret is not saved. Save it in Admin → System settings → Deployment providers before connecting."),{status:503});
    const body=await req.json().catch(()=>({}));
    const requestedReturnPath=String(body.returnPath||"/portal/orbitfs").trim();
    const returnPath=/^\/portal\/orbitfs(?:\/(?:base|releases|license|channels))?$/.test(requestedReturnPath)?requestedReturnPath:"/portal/orbitfs";
    const state=await createOAuthState(user.id,"supabase",body.installationId||null,returnPath);
    const redirect=await orbitfsStoreUrl("/api/orbitfs/oauth/supabase/callback",req.url);
    const u=new URL("https://api.supabase.com/v1/oauth/authorize");
    u.searchParams.set("client_id",s.supabase_client_id);
    u.searchParams.set("response_type","code");
    u.searchParams.set("redirect_uri",redirect);
    u.searchParams.set("state",state);
    if(s.supabase_scopes)u.searchParams.set("scope",String(s.supabase_scopes).trim());
    return Response.json({url:u.toString(),callback:redirect});
  }catch(e){return httpError(e)}
}
