import crypto from "node:crypto";
import {licenseDb} from "@/lib/license-api";

function safeEqual(a:string,b:string){
  const aa=Buffer.from(a),bb=Buffer.from(b);
  return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);
}

function authorized(req:Request){
  const expected=String(process.env.DEV_PANEL_EVENT_SECRET||"").trim();
  const supplied=String(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim()||String(req.headers.get("x-orbitfs-event-secret")||"").trim();
  return Boolean(expected&&supplied&&safeEqual(supplied,expected));
}

export async function POST(req:Request){
  if(!authorized(req))return Response.json({error:"UNAUTHORIZED"},{status:401});
  try{
    const body:any=await req.json().catch(()=>({}));
    const version=String(body.version||"").trim();
    const releaseType=String(body.releaseType||body.release_type||"").trim().toLowerCase();
    const channel=String(body.channel||"stable").trim().toLowerCase()||"stable";
    const releaseIds=[...new Set((Array.isArray(body.releaseIds)?body.releaseIds:[]).map((x:any)=>String(x||"").trim()).filter(Boolean))];
    if(!version||!["base","update"].includes(releaseType))return Response.json({error:"INVALID_RELEASE_RESET_TARGET"},{status:400});

    const db=licenseDb();
    let presentationDeleted=0;
    if(releaseIds.length){
      const presentation=await db.from("orbitfs_release_presentation_overrides").delete().in("release_id",releaseIds).select("release_id");
      if(presentation.error)throw presentation.error;
      presentationDeleted=(presentation.data||[]).length;
    }

    const bundles=await db.from("orbitfs_release_bundles").delete().eq("version",version).eq("channel",channel).select("id");
    if(bundles.error)throw bundles.error;

    return Response.json({
      ok:true,
      version,
      releaseType,
      channel,
      presentationDeleted,
      legacyBundlesDeleted:(bundles.data||[]).length,
      customerInstallationsDeleted:0
    },{headers:{"cache-control":"no-store"}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"Unable to reset Billing release state"},{status:500});
  }
}
