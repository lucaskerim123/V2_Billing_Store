import {NextResponse} from "next/server";
import {requireOrbitAdmin} from "@/lib/orbitfs-deployment";
import {reconcileLicenseMaster} from "@/lib/license-master-reconcile";
export const dynamic="force-dynamic";

async function authorized(req:Request){
 const auth=String(req.headers.get("authorization")||"");
 const cron=String(process.env.CRON_SECRET||"");
 if(cron&&auth==="Bearer "+cron)return true;
 await requireOrbitAdmin(req);
 return true;
}

export async function GET(req:Request){
 const cron=String(process.env.CRON_SECRET||"");
 const auth=String(req.headers.get("authorization")||"");
 if(!cron||auth!=="Bearer "+cron)
  return NextResponse.json({error:"Cron authorization required"},{status:401,headers:{"cache-control":"no-store"}});
 try{
  const url=new URL(req.url);
  const result=await reconcileLicenseMaster(Number(url.searchParams.get("limit")||50));
  console.info("License Manager scheduled reconciliation completed",{ok:result.ok,processed:result.processed,failed:result.failed});
  return NextResponse.json(result,{headers:{"cache-control":"no-store"}});
 }catch(error:any){
  console.error("License Manager scheduled reconciliation failed",{error:String(error?.message||error)});
  return NextResponse.json({error:error?.message||"License Manager reconciliation failed"},{status:Number(error?.status)||500,headers:{"cache-control":"no-store"}});
 }
}

export async function POST(req:Request){
 try{
  await authorized(req);
  const body=await req.json().catch(()=>({}));
  const result=await reconcileLicenseMaster(Number(body?.limit||50));
  return NextResponse.json(result,{headers:{"cache-control":"no-store"}});
 }catch(error:any){
  return NextResponse.json({error:error?.message||"License Master reconciliation failed"},{status:Number(error?.status)||500});
 }
}
