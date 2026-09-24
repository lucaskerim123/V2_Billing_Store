import {syncPaidOrderToLicenseMaster} from "@/lib/license-master-sync";
import {requireOrbitDeploymentAdmin} from "@/lib/orbitfs-deployment-auth";

const MAX_BODY_BYTES=16*1024;

export async function POST(req:Request){
  try{
    await requireOrbitDeploymentAdmin(req);
    const length=Number(req.headers.get("content-length")||0);
    if(length>MAX_BODY_BYTES)return Response.json({error:"Request body too large"},{status:413});
    const body=await req.json().catch(()=>({}));
    const orderId=String(body.orderId||body.order_id||"").trim();
    if(!orderId)return Response.json({error:"orderId is required"},{status:400});
    const result=await syncPaidOrderToLicenseMaster(orderId,{manual:true});
    return Response.json(result,{headers:{"cache-control":"no-store"}});
  }catch(e:any){
    return Response.json({error:String(e?.message||"License fulfilment failed")},{status:Number(e?.status)||502,headers:{"cache-control":"no-store"}});
  }
}
