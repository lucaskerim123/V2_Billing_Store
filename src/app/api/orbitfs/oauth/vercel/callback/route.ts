import {licenseDb} from "@/lib/license-api";
import {createHmac} from "node:crypto";
import {consumeOAuthState,billingOrbitfsConfig,saveProviderConnection} from "@/lib/orbitfs-deployment";
import {serviceRpc} from "@/lib/paymentServer";

const STORE_ORIGIN=(process.env.NEXT_PUBLIC_ORBITFS_STORE_URL||process.env.SITE_URL||"https://orbitfsstore.vercel.app").replace(/\/+$/,"");
function pkceVerifier(state:string,secret:string){return createHmac("sha256",secret).update(`orbitfs-vercel:${state}`).digest("base64url")}

export async function GET(req:Request){
  const u=new URL(req.url);let returnPath="/portal/orbitfs";
  try{
    const code=u.searchParams.get("code")||"",stateValue=u.searchParams.get("state")||"";
    if(!code)throw new Error(u.searchParams.get("error_description")||u.searchParams.get("error")||"Vercel authorization did not return a code");
    const state=await consumeOAuthState(stateValue,"vercel");
    returnPath=state.return_path||returnPath;
    const s=await billingOrbitfsConfig(),secret=String(await serviceRpc("service_orbitfs_release_secret",{p_key:"vercel_client_secret"})||"");
    if(!s.vercel_client_id||!secret)throw new Error("OrbitFS Vercel App is not configured");
    const redirect=`${STORE_ORIGIN}/api/orbitfs/oauth/vercel/callback`;
    const form=new URLSearchParams({grant_type:"authorization_code",client_id:s.vercel_client_id,client_secret:secret,code,code_verifier:pkceVerifier(stateValue,secret),redirect_uri:redirect});
    const r=await fetch("https://api.vercel.com/login/oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded",accept:"application/json"},body:form});
    if(!r.ok)throw new Error(`Vercel token exchange failed: ${await r.text()}`);
    const tokens=await r.json();
    let profile:any={},teams:any[]=[];
    try{const p=await fetch("https://api.vercel.com/login/oauth/userinfo",{headers:{authorization:`Bearer ${tokens.access_token}`,accept:"application/json"}});if(p.ok)profile=await p.json()}catch{}
    try{const t=await fetch("https://api.vercel.com/v2/teams?limit=100",{headers:{authorization:`Bearer ${tokens.access_token}`,accept:"application/json"}});if(t.ok){const j=await t.json();teams=Array.isArray(j)?j:Array.isArray(j?.teams)?j.teams:[]}}catch{}
    const teamId=String(tokens.team_id||profile.team_id||"").trim()||null;
    const scopes=String(tokens.scope||"").split(/[ ,]+/).filter(Boolean);
    const accountName=String(profile.name||profile.preferred_username||profile.email||"").trim()||(teamId?"Customer Vercel team":"Customer Vercel account");
    await saveProviderConnection(state.auth_user_id,"vercel",tokens,{provider_account_id:teamId||profile.sub||tokens.user_id||null,provider_account_name:accountName,team_id:teamId,scopes,teams:teams.map((x:any)=>({id:x.id,name:x.name,slug:x.slug}))});
    if(state.installation_id)await licenseDb().from("orbitfs_installations").update({updated_at:new Date().toISOString()}).eq("id",state.installation_id).eq("auth_user_id",state.auth_user_id);
    return Response.redirect(new URL(`${returnPath}?connected=vercel`,STORE_ORIGIN));
  }catch(e:any){const target=new URL(returnPath,STORE_ORIGIN);target.searchParams.set("error",e?.message||"Vercel connection failed");return Response.redirect(target)}
}
