import {masterRequest} from "@/lib/master-api";
import {httpError,requireOrbitAdmin} from "@/lib/orbitfs-deployment";

const PATH_RE=/^\/api\/v1\/(license(?:\/[^/]+\/control)?|products|releases(?:\/[^/]+(?:\/(?:validate|artifact))?)?|release-channels(?:\/access)?)$/;

function allowed(path:string){return PATH_RE.test(path);}
async function forward(req:Request,method:string){
  await requireOrbitAdmin(req);
  const url=new URL(req.url);
  const raw=String(url.searchParams.get("path")||"").trim();
  if(!raw||!allowed(raw))return Response.json({error:"LICENSE_MASTER_PATH_NOT_ALLOWED"},{status:400});
  const body=method==="GET"||method==="HEAD"?undefined:await req.text();
  return Response.json(await masterRequest(raw,{method,body:body||undefined,headers:body?{"content-type":req.headers.get("content-type")||"application/json"}:undefined}, "billing"),{headers:{"cache-control":"no-store"}});
}
export async function GET(req:Request){try{return await forward(req,"GET")}catch(e){return httpError(e)}}
export async function POST(req:Request){try{return await forward(req,"POST")}catch(e){return httpError(e)}}
export async function PATCH(req:Request){try{return await forward(req,"PATCH")}catch(e){return httpError(e)}}
