import {createClient} from "@supabase/supabase-js";
import {syncPaidOrderToLicenseMaster} from "@/lib/license-master-sync";
import {licenseDb} from "@/lib/license-api";
import {requireOrbitDeploymentAdmin} from "@/lib/orbitfs-deployment-auth";

const MAX_BODY_BYTES=16*1024;
export const dynamic="force-dynamic";

async function authorize(req:Request,orderId:string){
 const bearer=String(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
 const url=String(process.env.NEXT_PUBLIC_SUPABASE_URL||"");
 const key=String(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"");
 if(bearer&&url&&key){
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await client.auth.getUser(bearer);
  if(!error&&user){
   const {data:order,error:orderError}=await licenseDb().from("orders").select("id,auth_user_id,status,payment_status").eq("id",orderId).maybeSingle();
   if(orderError)throw orderError;
   if(order&&String(order.auth_user_id)===user.id){
    if(String(order.status).toLowerCase()!=="active"||!String(order.payment_status||"").toLowerCase().startsWith("paid"))
     throw Object.assign(new Error("Order has not been approved and paid"),{status:409});
    return false;
   }
  }
 }
 await requireOrbitDeploymentAdmin(req);
 return true;
}

export async function POST(req:Request){
 try{
  const length=Number(req.headers.get("content-length")||0);
  if(length>MAX_BODY_BYTES)return Response.json({error:"Request body too large"},{status:413});
  const body=await req.json().catch(()=>({}));
  const orderId=String(body.orderId||body.order_id||"").trim();
  if(!/^[0-9a-f-]{36}$/i.test(orderId))return Response.json({error:"Valid orderId is required"},{status:400});
  const isAdmin=await authorize(req,orderId);
  const result=await syncPaidOrderToLicenseMaster(orderId,{manual:isAdmin});
  return Response.json(result,{status:result?.ok===false?502:200,headers:{"cache-control":"no-store"}});
 }catch(e:any){
  return Response.json({error:String(e?.message||"License fulfilment failed")},{status:Number(e?.status)||502,headers:{"cache-control":"no-store"}});
 }
}
