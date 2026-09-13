import {masterLicenseValidate} from "@/lib/master-api";

export async function POST(req:Request){
  try{return Response.json(await masterLicenseValidate(await req.json()))}
  catch(e:any){return Response.json({error:e.message||"License validation failed",code:e.code||"LICENSE_VALIDATION_ERROR"},{status:e.status||500})}
}
export async function OPTIONS(){return new Response(null,{status:204})}
