import {masterRequest} from "@/lib/master-api";
import {licenseDb} from "@/lib/license-api";
import {httpError,requireOrbitAdmin} from "@/lib/orbitfs-deployment";

const PATH_RE=/^\\/api\\/v1\\/(license(?:\\/health|\\/[^/]+\\/control)?|products|releases(?:\\/[^/]+(?:\\/(?:validate|artifact))?)?|release-channels(?:\\/access)?)$/;

function allowed(path:string){return PATH_RE.test(path);}
async function forward(req:Request,method:string){
  await requireOrbitAdmin(req);
  const url=new URL(req.url);
  const raw=String(url.searchParams.get("path")||"").trim();
  if(!raw||!allowed(raw))return Response.json({error:"LICENSE_MASTER_PATH_NOT_ALLOWED"},{status:400});
  const body=method==="GET"||method==="HEAD"?undefined:await req.text();
  const result:any=await masterRequest(raw,{method,body:body||undefined,headers:body?{"content-type":req.headers.get("content-type")||"application/json"}:undefined}, "billing");

  // Rotation is authoritative in License Manager and happens in place. Keep
  // the Billing Store's linked customer record in sync with the new suffix;
  // never fail or hide a successful rotation if this secondary sync fails.
  if(method==="POST"&&body){
    let input:any={};
    try{input=JSON.parse(body)}catch{}
    const match=raw.match(/^\\/api\\/v1\\/license\\/([^/]+)\\/control$/);
    if(match&&String(input?.action||"").trim().toLowerCase()==="rotate"){
      const licenseId=decodeURIComponent(match[1]);
      const license=result?.license||result?.licence||result;
      const keyLast4=String(license?.license_key_last4||license?.key_last4||license?.licenseKeyLast4||(license?.key?String(license.key).slice(-4):"")).trim();
      if(keyLast4&&String(license?.id||license?.license_id||licenseId)===licenseId){
        try{
          const {data,error}=await licenseDb().from("license_bindings")
            .update({license_key_last4:keyLast4,updated_at:new Date().toISOString()})
            .eq("license_id",licenseId).is("archived_at",null).select("id");
          if(error)throw error;
          result.billing_binding_sync={ok:true,updated:Number(data?.length||0)};
        }catch(error:any){
          console.error("[license-controller] rotation succeeded but Billing Store binding metadata sync failed",{licenseId,error:error?.message||String(error)});
          result.billing_binding_sync={ok:false};
        }
      }
    }
  }
  return Response.json(result,{headers:{"cache-control":"no-store"}});
}
export async function GET(req:Request){try{return await forward(req,"GET")}catch(e){return httpError(e)}}
export async function POST(req:Request){try{return await forward(req,"POST")}catch(e){return httpError(e)}}
export async function PATCH(req:Request){try{return await forward(req,"PATCH")}catch(e){return httpError(e)}}
