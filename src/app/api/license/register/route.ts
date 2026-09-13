import {masterLicenseValidate} from "@/lib/master-api";

export async function POST(req:Request){
  try{return Response.json(await masterLicenseValidate({...await req.json(),activate:true}))}
  catch(e:any){return Response.json({error:e.message||"License registration failed",code:e.code||"LICENSE_REGISTRATION_ERROR"},{status:e.status||500})}
}
export async function OPTIONS(){return new Response(null,{status:204})}
