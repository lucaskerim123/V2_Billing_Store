import {createHash} from "node:crypto";
import {OBS_SCOPES,obsAdmin,obsDb,storeObsKey,type ObsScope} from "@/lib/obs-api";
export async function GET(req:Request){
 if(!await obsAdmin(req))return Response.json({error:"Forbidden"},{status:403});
 const {data,error}=await obsDb().from("orbitfs_billing_api_keys").select("id,name,key_last4,scopes,target_profile,status,created_at,revoked_at").order("created_at",{ascending:false}).limit(100);
 return error?Response.json({error:error.message},{status:503}):Response.json({keys:data,permissions:OBS_SCOPES});
}
export async function POST(req:Request){
 const actor=await obsAdmin(req);if(!actor)return Response.json({error:"Forbidden"},{status:403});
 const body=await req.json().catch(()=>({}));
 const name=String(body.name||"").trim(),scopes=body.scopes,target=String(body.target_profile||"both");
 if(!["main","fallback","both"].includes(target)||name.length<2||name.length>120||!Array.isArray(scopes)||!scopes.length||scopes.length>OBS_SCOPES.length||!scopes.every((x:unknown)=>typeof x==="string"&&(OBS_SCOPES as readonly string[]).includes(x))||new Set(scopes).size!==scopes.length)return Response.json({error:"Invalid name or permissions"},{status:400});
 try{return Response.json(await storeObsKey(name,scopes as ObsScope[],actor.id,target as "main"|"fallback"|"both"),{status:201,headers:{"cache-control":"no-store"}})}
 catch(e:any){return Response.json({error:e.message||"Key creation failed"},{status:503})}
}
export async function DELETE(req:Request){
 if(!await obsAdmin(req))return Response.json({error:"Forbidden"},{status:403});
 const body=await req.json().catch(()=>({})),id=String(body.id||"");
 if(!/^[a-f0-9-]{36}$/i.test(id))return Response.json({error:"Invalid key ID"},{status:400});
 const {data,error}=await obsDb().from("orbitfs_billing_api_keys").update({status:"revoked",revoked_at:new Date().toISOString()}).eq("id",id).eq("status","active").select("id").maybeSingle();
 return error?Response.json({error:error.message},{status:503}):Response.json({revoked:Boolean(data)});
}
