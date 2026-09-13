import {masterRevision} from "@/lib/master-api";

export async function GET(){
  try{return Response.json(await masterRevision())}
  catch(e:any){return Response.json({error:e.message||"License Master unavailable",code:e.code||"LICENSE_MASTER_UNAVAILABLE"},{status:e.status||503})}
}
export async function OPTIONS(){return new Response(null,{status:204})}
