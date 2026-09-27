import crypto from "node:crypto";
import {masterRequest} from "@/lib/master-api";

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
    const releaseId=String(body.releaseId||body.release_id||"").trim();
    const action=String(body.action||"").trim().toLowerCase();
    if(!releaseId)return Response.json({error:"RELEASE_ID_REQUIRED"},{status:400});
    if(action!=="withdraw")return Response.json({error:"DEV_PANEL_ONLY_SUPPORTS_UNPUBLISH"},{status:403});

    const current=await masterRequest("/api/v1/releases/"+encodeURIComponent(releaseId),{method:"GET"},"billing");
    if(!current?.release)return Response.json({error:"RELEASE_NOT_FOUND"},{status:404});
    if(String(current.release.status||"").toLowerCase()!=="published"){
      return Response.json({ok:true,release:current.release,alreadyUnpublished:true,authority:"license_manager"});
    }
    const result=await masterRequest("/api/v1/releases/"+encodeURIComponent(releaseId),{
      method:"POST",
      body:JSON.stringify({action:"withdraw"})
    },"billing");
    return Response.json({...result,authority:"license_manager",control_surface:"billing_store"},{headers:{"cache-control":"no-store"}});
  }catch(error:any){
    return Response.json({error:error?.message||"Unable to unpublish release"},{status:Number(error?.status||500)});
  }
}
