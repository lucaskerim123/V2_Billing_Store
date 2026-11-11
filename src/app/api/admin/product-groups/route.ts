import {createClient} from "@supabase/supabase-js";
import {masterProductGroups,masterProducts} from "@/lib/master-api";
const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const SUPABASE_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
async function staff(req:Request){
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
 if(!token||!SUPABASE_URL||!SUPABASE_KEY)return null;
 const sb=createClient(SUPABASE_URL,SUPABASE_KEY,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error}=await sb.auth.getUser(token);if(error||!user)return null;
 const {data}=await sb.rpc("get_my_staff_access");const row=Array.isArray(data)?data[0]:data,p=row?.permissions;
 const ok=p?.all===true||(Array.isArray(p)?p.includes("licenses.manage")||p.includes("license_api.manage"):Boolean(p?.["licenses.manage"]||p?.["license_api.manage"]));
 return ok?user:null;
}
export async function GET(req:Request){try{if(!await staff(req))return Response.json({error:"License management permission required"},{status:403});const [data,productData]=await Promise.all([masterProductGroups(),masterProducts()]);return Response.json({...data,products:productData.products||[]},{headers:{"cache-control":"no-store"}})}catch(e:any){return Response.json({error:e?.message||"Could not load product groups"},{status:e?.status||500})}}
export async function POST(req:Request){try{if(!await staff(req))return Response.json({error:"License management permission required"},{status:403});const body=await req.json();const data=await masterProductGroups({method:"POST",body});return Response.json(data,{status:201})}catch(e:any){return Response.json({error:e?.message||"Could not create product group"},{status:e?.status||500})}}
export async function PATCH(req:Request){try{if(!await staff(req))return Response.json({error:"License management permission required"},{status:403});const body=await req.json();const data=await masterProductGroups({method:"PATCH",body});return Response.json(data)}catch(e:any){return Response.json({error:e?.message||"Could not update product group"},{status:e?.status||500})}}
