import {masterRequest} from "@/lib/master-api";
import {licenseDb} from "@/lib/license-api";
import {httpError,requireOrbitAdmin} from "@/lib/orbitfs-deployment";

async function bounded<T>(promise:Promise<T>,fallback:T,ms=6000):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([promise,new Promise<T>(resolve=>{timer=setTimeout(()=>resolve(fallback),ms)})])}
  finally{if(timer)clearTimeout(timer)}
}

export async function GET(req:Request){
  try{
    await requireOrbitAdmin(req);
    const u=new URL(req.url),action=u.searchParams.get("action")||"drafts";
    const id=u.searchParams.get("id");
    if(action==="drafts"){
      const db=licenseDb();
      const {data,error}=await bounded(db.from("orbitfs_release_bundles").select("id,version,channel,status,title,description,changelog,base_source_commit,engine_source_commit,published_at,updated_at,created_at,rollout").order("updated_at",{ascending:false}).limit(100) as any,{data:[],error:null} as any);
      if(error)throw error;
      return Response.json({releases:(data||[]).map((r:any)=>({id:r.id,version:r.version,channel:r.channel,status:r.status==="published"?"published":r.status==="draft"?"draft":r.status,title:r.title,description:r.description,changelog:r.changelog,sourceCommit:r.channel==="base"?r.base_source_commit:r.engine_source_commit,deliveryStatus:r.status==="published"?"published":"pending",deliveryAttempts:0,deliveryError:null,publishedAt:r.published_at,updatedAt:r.updated_at}))},{headers:{"cache-control":"no-store"}});
    }
    return Response.json(await masterRequest(`/api/release-handoff?action=${encodeURIComponent(action)}${id?`&id=${encodeURIComponent(id)}`:""}`,{method:"GET"},"billing"));
  }catch(e){return httpError(e)}
}

export async function POST(req:Request){
  try{
    await requireOrbitAdmin(req);
    const u=new URL(req.url),action=u.searchParams.get("action")||"publish",id=u.searchParams.get("id"),body=await req.text();
    return Response.json(await masterRequest(`/api/release-handoff?action=${encodeURIComponent(action)}${id?`&id=${encodeURIComponent(id)}`:""}`,{method:"POST",headers:{"content-type":"application/json"},body},"billing"));
  }catch(e){return httpError(e)}
}
