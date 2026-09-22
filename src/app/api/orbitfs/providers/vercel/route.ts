import {licenseDb} from "@/lib/license-api";
import {httpError,requireOrbitUser,requireSystem,saveProviderConnection} from "@/lib/orbitfs-deployment";
import {serviceRpc} from "@/lib/paymentServer";
import {disconnectProviderConnection} from "@/lib/orbitfs-deployment";

const VERCEL_API="https://api.vercel.com";

async function api(token:string,path:string){
  const r=await fetch(`${VERCEL_API}${path}`,{headers:{authorization:`Bearer ${token}`,accept:"application/json"},cache:"no-store"});
  const text=await r.text();let body:any={};try{body=text?JSON.parse(text):{}}catch{body={message:text}}return {r,body};
}

async function validateAndSave(userId:string,token:string,requestedTeamId:string|null){
  const userResult=await api(token,"/v2/user");
  if(!userResult.r.ok)throw Object.assign(new Error(`Vercel token validation failed (${userResult.r.status}): ${userResult.body?.error?.message||userResult.body?.message||"invalid token"}. Create a Full Account Access token in Vercel Account Settings → Tokens.`),{status:400});
  const profile=userResult.body?.user||userResult.body||{};let teams:any[]=[];
  const teamsResult=await api(token,"/v2/teams?limit=100");if(teamsResult.r.ok){const raw=teamsResult.body;teams=Array.isArray(raw)?raw:Array.isArray(raw?.teams)?raw.teams:[]}
  const teamId=String(requestedTeamId||"").trim()||null,team=teamId?teams.find((x:any)=>String(x.id||x.uid||"")===teamId):null;
  if(teamId&&!team)throw Object.assign(new Error("That Vercel team is not available to this token. Use a Full Account Access token or choose another team."),{status:400});
  const projectsUrl=new URL("/v9/projects",VERCEL_API);projectsUrl.searchParams.set("limit","1");if(teamId)projectsUrl.searchParams.set("teamId",teamId);
  const projectCheck=await fetch(projectsUrl,{headers:{authorization:`Bearer ${token}`,accept:"application/json"},cache:"no-store"});
  if(!projectCheck.ok){const text=await projectCheck.text();throw Object.assign(new Error(`Vercel project access check failed (${projectCheck.status}): ${text||"permission denied"}. Create a Full Account Access token, not a project-only token.`),{status:400})}
  const accountId=String(teamId||profile.id||profile.uid||profile.userId||"")||null,accountName=String(team?.name||team?.slug||profile.username||profile.name||profile.email||"Customer Vercel account");
  const metadata={auth_mode:"personal_access_token",api_ready:true,provider_account_id:accountId,provider_account_name:accountName,team_id:teamId,scopes:["vercel_api"],teams:teams.map((x:any)=>({id:x.id||x.uid,name:x.name||x.slug||x.id,slug:x.slug||null})),validated_at:new Date().toISOString()};
  await saveProviderConnection(userId,"vercel",{access_token:token},metadata);
  return {ok:true,account:{id:accountId,name:accountName,teamId},teams:metadata.teams,apiReady:true};
}

export async function POST(req:Request){
  try{
    const {user}=await requireOrbitUser(req),s=await requireSystem("deploy");
    if(!s.vercel_oauth_enabled)throw Object.assign(new Error("Customer Vercel connection is disabled"),{status:503});
    const body=await req.json().catch(()=>({})),action=String(body.action||"connect");
    const {data:deployed}=await licenseDb().from("orbitfs_installations").select("id,vercel_team_id,vercel_project_id").eq("auth_user_id",user.id).not("vercel_project_id","is",null).limit(1).maybeSingle();
    if(action==="disconnect"){if(deployed?.vercel_project_id)throw Object.assign(new Error("Undeploy the OrbitFS Panel before resetting the Vercel connector."),{status:409});return Response.json({ok:Boolean(await disconnectProviderConnection(user.id,"vercel"))})}
    if(action==="select_team"){
      if(deployed?.vercel_project_id)throw Object.assign(new Error("Undeploy your OrbitFS Panel before changing the Vercel deployment account/team."),{status:409});
      const existing=String(await serviceRpc("service_orbitfs_provider_secret",{p_user_id:user.id,p_provider:"vercel",p_key:"access_token"})||"").trim();
      if(!existing)throw Object.assign(new Error("Connect your Vercel token first"),{status:409});
      return Response.json(await validateAndSave(user.id,existing,String(body.teamId||"")||null));
    }
    if(action!=="connect")throw Object.assign(new Error("Unsupported Vercel connection action"),{status:400});
    const token=String(body.token||"").trim();if(token.length<20)throw Object.assign(new Error("Enter a valid Vercel Full Account Access token"),{status:400});
    const teamId=deployed?.vercel_project_id?(String(deployed.vercel_team_id||"")||null):(String(body.teamId||"")||null);
    return Response.json(await validateAndSave(user.id,token,teamId));
  }catch(e){return httpError(e)}
}
