import crypto from "node:crypto";
import {licenseDb} from "@/lib/license-api";

const hash=(value:string)=>crypto.createHash("sha256").update(value,"utf8").digest("hex");

export async function POST(req:Request){
  try{
    const length=Number(req.headers.get("content-length")||0);
    if(length>4096)return Response.json({error:"Request too large"},{status:413});
    const body=await req.json().catch(()=>({}));
    const token=String(body?.token||"").trim();
    if(token.length<32||token.length>256)return Response.json({error:"Invalid licence-key link.",code:"INVALID_LINK"},{status:400});

    const db=licenseDb();
    const result=await db.rpc("consume_license_key_delivery",{p_token_hash:hash(token)});
    if(result.error)throw result.error;
    const data:any=result.data||{};
    if(data.ok!==true){
      const code=String(data.code||"INVALID_LINK");
      const message=code==="LINK_ALREADY_USED"?"This licence-key link has already been used.":code==="LINK_EXPIRED"?"This licence-key link has expired.":"This licence-key link is invalid.";
      return Response.json({error:message,code},{status:code==="INVALID_LINK"?404:410,headers:{"cache-control":"no-store"}});
    }
    return Response.json({ok:true,licenseKey:String(data.license_key||""),licenseId:String(data.license_id||"")},{headers:{"cache-control":"no-store"}});
  }catch(e:any){
    return Response.json({error:e?.message||"Could not reveal licence key."},{status:500,headers:{"cache-control":"no-store"}});
  }
}
