import {createHash,createHmac} from "node:crypto";
import {createOAuthState,httpError,requireOrbitUser,requireSystem} from "@/lib/orbitfs-deployment";
import {serviceRpc} from "@/lib/paymentServer";

const STORE_ORIGIN=(process.env.NEXT_PUBLIC_ORBITFS_STORE_URL||process.env.SITE_URL||"https://orbitfsstore.vercel.app").replace(/\/+$/,"");
function pkceVerifier(state:string,secret:string){return createHmac("sha256",secret).update(`orbitfs-vercel:${state}`).digest("base64url")}

export async function POST(req:Request){
  try{
    const {user}=await requireOrbitUser(req);
    const s=await requireSystem("deploy");
    if(!s.vercel_oauth_enabled)throw Object.assign(new Error("Vercel customer connection is disabled"),{status:503});
    if(!s.vercel_client_id)throw Object.assign(new Error("OrbitFS Vercel App client ID is not configured"),{status:503});
    const secret=String(await serviceRpc("service_orbitfs_release_secret",{p_key:"vercel_client_secret"})||"");
    if(!secret)throw Object.assign(new Error("OrbitFS Vercel App client secret is not configured"),{status:503});
    const body=await req.json().catch(()=>({}));
    const state=await createOAuthState(user.id,"vercel",body.installationId||null,"/portal/orbitfs");
    const redirect=`${STORE_ORIGIN}/api/orbitfs/oauth/vercel/callback`;
    const verifier=pkceVerifier(state,secret);
    const challenge=createHash("sha256").update(verifier).digest("base64url");
    const u=new URL("https://vercel.com/oauth/authorize");
    u.searchParams.set("client_id",s.vercel_client_id);
    u.searchParams.set("response_type","code");
    u.searchParams.set("redirect_uri",redirect);
    u.searchParams.set("state",state);
    u.searchParams.set("code_challenge",challenge);
    u.searchParams.set("code_challenge_method","S256");
    return Response.json({url:u.toString(),callback:redirect});
  }catch(e){return httpError(e)}
}
