import {createClient} from "@supabase/supabase-js";
import {masterRequest} from "@/lib/master-api";

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const SUPABASE_PUBLISHABLE_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
const ALLOWED_PREFIXES=["/api/licenses","/api/license","/api/products","/api/installations","/api/releases","/api/deployments","/api/settings","/api/release-capture","/api/release-control","/api/release-handoff","/api/release-automation-settings"];

async function authorize(req:Request){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token||!SUPABASE_PUBLISHABLE_KEY)return false;
  const sb=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
  const {data:{user},error:userError}=await sb.auth.getUser(token);
  if(userError||!user)return false;
  const {data,error}=await sb.rpc("get_my_staff_access");
  if(error||!data)return false;
  const row=Array.isArray(data)?data[0]:data,p=row?.permissions;
  if(p?.all===true)return true;
  if(Array.isArray(p))return p.includes("licenses.view")||p.includes("licenses.manage")||p.includes("license_api.manage");
  return Boolean(p?.["licenses.view"]||p?.["licenses.manage"]||p?.["license_api.manage"]);
}
function allowed(path:string){return path.startsWith("/api/")&&ALLOWED_PREFIXES.some(x=>path===x||path.startsWith(x+"/")||path.startsWith(x+"?"));}
export async function GET(req:Request){return forward(req,"GET")}
export async function POST(req:Request){return forward(req,"POST")}
export async function PATCH(req:Request){return forward(req,"PATCH")}
async function forward(req:Request,method:"GET"|"POST"|"PATCH"){
  if(!await authorize(req))return Response.json({error:"Unauthorized"},{status:401});
  const path=new URL(req.url).searchParams.get("path")||"";
  if(!allowed(path))return Response.json({error:"License Master path is not allowed"},{status:400});
  const role=path.startsWith("/api/deployments")?"deployer":"billing";
  try{const init:RequestInit={method};if(method!=="GET")init.body=await req.text();const data=await masterRequest(path,init,role);return Response.json(data,{headers:{"cache-control":"no-store"}})}catch(e){return Response.json({error:e instanceof Error?e.message:"License Master request failed"},{status:502,headers:{"cache-control":"no-store"}})}
}
