import {syncPaidOrderToLicenseMaster} from "@/lib/license-master-sync";
import {requireOrbitDeploymentAdmin} from "@/lib/orbitfs-deployment-auth";

export async function POST(req:Request){
  try{
    await requireOrbitDeploymentAdmin(req);
    const body=await req.json().catch(()=>({}));
    const orderId=String(body.orderId||body.order_id||"").trim();
    if(!orderId)return Response.json({error:"orderId is required"},{status:400});
    const result=await syncPaidOrderToLicenseMaster(orderId);
    return Response.json(result,{headers:{"cache-control":"no-store"}});
  }catch(e:any){return Response.json({error:String(e?.message||"License fulfilment failed")},{status:Number(e?.status)||502,headers:{"cache-control":"no-store"}})}
}
