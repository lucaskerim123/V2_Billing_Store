import {createClient} from "@supabase/supabase-js";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||"";

export async function POST(req:Request){
  if(!url||!serviceKey)return Response.json({error:"Billing Store database is not configured."},{status:503});
  const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const provided=req.headers.get("x-orbitfs-sync-token")||"";
  const {data:row,error}=await service.from("app_settings").select("value").eq("key","internal.gateway_sync_token").maybeSingle();
  if(error)return Response.json({error:"Could not read gateway sync configuration."},{status:500});
  const expected=typeof row?.value==="string"?row.value:String(row?.value||"");
  if(!expected||provided!==expected)return Response.json({error:"Forbidden"},{status:403});
  const endpoint=`${url.replace(/\/$/,"")}/functions/v1/payment-gateway-canonical-sync`;
  try{
    const r=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json","x-orbitfs-sync-token":expected},body:"{}",cache:"no-store"});
    const text=await r.text();
    return new Response(text,{status:r.status,headers:{"content-type":r.headers.get("content-type")||"application/json","cache-control":"no-store"}});
  }catch(error:any){
    return Response.json({error:error?.message||"Gateway canonical sync failed."},{status:502});
  }
}
