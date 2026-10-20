import {authorizeObs,obsProfile} from "@/lib/obs-api";
export async function GET(req:Request){
 const actor=await authorizeObs(req,"customers.read");
 if(!actor)return Response.json({error:"OBS_AUTH_DENIED",profile:obsProfile()},{status:403,headers:{"cache-control":"no-store"}});
 return Response.json({ok:true,service:"orbitfs-billing-system",profile:obsProfile(),identity:actor.name,capability:"customers.read"},{headers:{"cache-control":"no-store"}});
}
