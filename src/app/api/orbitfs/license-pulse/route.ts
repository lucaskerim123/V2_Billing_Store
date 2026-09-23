import {masterPulseState} from "@/lib/master-api";

export const dynamic="force-dynamic";

export async function GET(){
 try{
  const pulse=await masterPulseState();
  return Response.json(pulse,{headers:{"cache-control":"no-store"}});
 }catch(e:any){
  return Response.json({error:e?.message||"License Master pulse unavailable"},{status:e?.status||502,headers:{"cache-control":"no-store"}});
 }
}
