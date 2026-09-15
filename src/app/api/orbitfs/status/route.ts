import {masterRequest} from "@/lib/master-api";

export const dynamic="force-dynamic";

const url=()=>String(process.env.NEXT_PUBLIC_SUPABASE_URL||"").replace(/\/+$/,'');
const key=()=>String(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"");

async function currentUser(req:Request){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  const base=url();
  if(!token||!base||!key())throw Object.assign(new Error("Authentication is unavailable"),{status:401});
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),5000);
  try{
    const response=await fetch(`${base}/auth/v1/user`,{headers:{apikey:key(),authorization:`Bearer ${token}`},cache:"no-store",signal:controller.signal});
    if(!response.ok)throw Object.assign(new Error("Unauthorized"),{status:401});
    return await response.json();
  }catch(e:any){
    if(e?.name==="AbortError")throw Object.assign(new Error("Authentication request timed out"),{status:504});
    throw e;
  }finally{clearTimeout(timer)}
}

export async function GET(req:Request){
  try{
    const user=await currentUser(req);
    return Response.json(await masterRequest("/api/orbitfs/status",{method:"GET",headers:{"x-orbit-user-id":String(user.id||"")}},"billing"),{headers:{"cache-control":"no-store"}});
  }catch(e:any){
    return Response.json({error:e?.message||"Could not load OrbitFS status"},{status:Number(e?.status)||500,headers:{"cache-control":"no-store"}});
  }
}
