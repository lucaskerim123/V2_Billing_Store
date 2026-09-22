import {NextResponse} from "next/server";
import {requireOrbitAdmin} from "@/lib/orbitfs-deployment";
import {reconcileLicenseMaster} from "@/lib/license-master-reconcile";
export const dynamic="force-dynamic";
async function authorized(req:Request){const auth=String(req.headers.get("authorization")||""),cron=String(process.env.CRON_SECRET||"");if(cron&&auth==="Bearer "+cron)return true;await requireOrbitAdmin(req);return true}
export async function POST(req:Request){try{await authorized(req);const body=await req.json().catch(()=>({}));const result=await reconcileLicenseMaster(Number(body?.limit||50));return NextResponse.json(result,{headers:{"cache-control":"no-store"}})}catch(error:any){return NextResponse.json({error:error?.message||"License Master reconciliation failed"},{status:Number(error?.status)||500})}}