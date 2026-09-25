import {licenseDb} from "@/lib/license-api";
import {consumeOAuthState,billingOrbitfsConfig,saveProviderConnection} from "@/lib/orbitfs-deployment";
import {serviceRpc} from "@/lib/paymentServer";

const STORE_ORIGIN=(process.env.NEXT_PUBLIC_ORBITFS_STORE_URL||process.env.SITE_URL||"https://orbitfsstore.vercel.app").replace(/\/+$/,"");

export async function GET(req:Request){
  const u=new URL(req.url);let returnPath="/portal/orbitfs";
  try{
    const code=u.searchParams.get("code")||"",stateValue=u.searchParams.get("state")||"";
    if(!code)throw new Error(u.searchParams.get("error_description")||u.searchParams.get("error")||"Supabase authorization did not return a code");
    const state=await consumeOAuthState(stateValue,"supabase");
    returnPath=state.return_path||returnPath;
    const s=await billingOrbitfsConfig(),secret=String(await serviceRpc("service_orbitfs_release_secret",{p_key:"supabase_client_secret"})||"");
    if(!s.supabase_client_id||!secret)throw new Error("OrbitFS Supabase OAuth App is not configured");
    const redirect=`${STORE_ORIGIN}/api/orbitfs/oauth/supabase/callback`;
    const form=new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:redirect});
    const basic=Buffer.from(`${s.supabase_client_id}:${secret}`).toString("base64");
    const r=await fetch("https://api.supabase.com/v1/oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded",accept:"application/json",authorization:`Basic ${basic}`},body:form});
    if(!r.ok)throw new Error(`Supabase token exchange failed: ${await r.text()}`);
    const tokens=await r.json();
    let orgs:any[]=[];
    try{const o=await fetch("https://api.supabase.com/v1/organizations",{headers:{authorization:`Bearer ${tokens.access_token}`}});if(o.ok)orgs=await o.json()}catch{}
    const scopes=String(tokens.scope||"").split(/[ ,]+/).filter(Boolean);
    await saveProviderConnection(state.auth_user_id,"supabase",tokens,{provider_account_name:"Customer Supabase account",provider_account_id:null,scopes,organizations:orgs.map((x:any)=>({id:x.id||x.slug,name:x.name,slug:x.slug||x.id}))});
    if(state.installation_id)await licenseDb().from("orbitfs_installations").update({updated_at:new Date().toISOString()}).eq("id",state.installation_id).eq("auth_user_id",state.auth_user_id);
    return Response.redirect(new URL(`${returnPath}?connected=supabase`,STORE_ORIGIN));
  }catch(e:any){const target=new URL(returnPath,STORE_ORIGIN);target.searchParams.set("error",e?.message||"Supabase connection failed");return Response.redirect(target)}
}
