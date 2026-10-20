import {authorizeObs,obsDb,obsProfile,type ObsScope} from "@/lib/obs-api";
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const resources=new Set(["customers","orders","invoices","payments"]);
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"cache-control":"no-store"}});
export async function POST(req:Request){
 const body=await req.json().catch(()=>null);
 if(!body||typeof body!=="object"||Array.isArray(body))return json({error:"Invalid JSON body"},400);
 const resource=String(body.resource||"");
 if(!resources.has(resource))return json({error:"Unknown Billing resource"},400);
 const actor=await authorizeObs(req,(resource+".write") as ObsScope);
 if(!actor)return json({error:"OBS key lacks the required write scope or target permission"},403);
 const action=String(body.action||"update");
 const reason=String(body.reason||"").trim();
 if(reason.length<4||reason.length>500)return json({error:"A meaningful reason is required"},400);
 const profile=obsProfile();
 const db=obsDb();
 if(action==="record_manual_payment"&&resource==="payments"){
  const id=String(body.invoice_id||"");
  const amount=Number(body.amount_cents);
  const reference=String(body.reference||"").trim();
  if(!uuid.test(id)||!Number.isSafeInteger(amount)||amount<=0||reference.length<8||reference.length>160)return json({error:"Invalid manual payment input"},400);
  const {data,error}=await db.rpc("obs_record_manual_payment",{
   p_key_id:actor.id,p_profile:profile,p_invoice_id:id,p_amount_cents:amount,p_reference:reference,p_reason:reason
  });
  return error?json({error:error.message},409):json(data);
 }
 if(action!=="update")return json({error:"Unsupported action for resource"},400);
 const id=String(body.id||"");
 const changes=body.changes;
 if(!uuid.test(id)||!changes||typeof changes!=="object"||Array.isArray(changes)||Object.keys(changes).length<1||JSON.stringify(changes).length>6000)return json({error:"Invalid record ID or changes"},400);
 const {data,error}=await db.rpc("obs_update_record",{
  p_key_id:actor.id,p_profile:profile,p_resource:resource,p_id:id,p_changes:changes,p_reason:reason
 });
 return error?json({error:error.message},409):json(data);
}
