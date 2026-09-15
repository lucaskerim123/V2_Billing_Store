import {createClient} from "@supabase/supabase-js";

export const dynamic="force-dynamic";

const supabaseUrl=()=>String(process.env.NEXT_PUBLIC_SUPABASE_URL||"");
const supabaseKey=()=>String(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"");
const masterBase=()=>String(process.env.MASTER_API_URL||"").replace(/\/+$/,"" ).replace(/\/api$/i,"");
const timeoutMs=()=>Math.max(1000,Number(process.env.MASTER_API_TIMEOUT_MS||10000));

async function currentUser(req:Request){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token||!supabaseUrl()||!supabaseKey())throw Object.assign(new Error("Authentication is unavailable"),{status:401});
  const sb=createClient(supabaseUrl(),supabaseKey(),{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
  const {data,error}=await sb.auth.getUser(token);
  if(error||!data.user)throw Object.assign(new Error("Unauthorized"),{status:401});
  return data.user;
}

export async function GET(req:Request){
  try{
    const user=await currentUser(req),base=masterBase(),billingToken=String(process.env.BILLING_API_TOKEN||"").trim();
    if(!base)throw Object.assign(new Error("MASTER_API_URL is not configured"),{status:503});
    if(!billingToken)throw Object.assign(new Error("BILLING_API_TOKEN is not configured"),{status:503});
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs());
    try{
      const response=await fetch(`${base}/api/orbitfs/status`,{method:"GET",headers:{authorization:`Bearer ${billingToken}`,"x-orbit-user-id":user.id},cache:"no-store",signal:controller.signal});
      const text=await response.text();
      let data:any={};
      try{data=text?JSON.parse(text):{}}catch{data={error:text||"License Master returned an invalid response"};}
      if(!response.ok)throw Object.assign(new Error(data?.error||`License Master request failed (${response.status})`),{status:response.status});
      return Response.json(data,{headers:{"cache-control":"no-store"}});
    }catch(error:any){
      if(error?.name==="AbortError")throw Object.assign(new Error(`License Master status request timed out after ${timeoutMs()}ms`),{status:504});
      throw error;
    }finally{clearTimeout(timer)}
  }catch(e:any){
    return Response.json({error:e?.message||"License Master unavailable"},{status:Number(e?.status)||503,headers:{"cache-control":"no-store"}});
  }
}
