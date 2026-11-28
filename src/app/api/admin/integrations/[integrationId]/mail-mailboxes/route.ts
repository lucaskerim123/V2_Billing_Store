import {requireIntegrationAdmin,integrationErrorResponse} from "@/lib/integrations/admin-context";
import {getMailboxCatalogue} from "@/integrations/Mailsystem/Data/client";
import {getMailModuleConfig} from "@/integrations/Mailsystem/Data/config";
export const runtime="nodejs";
export async function POST(req:Request){
 try{
  const {db}=await requireIntegrationAdmin(req,["integrations.manage","integrations.mail.manage"]);
  const {data:state,error}=await db.from("app_integrations").select("installed,enabled").eq("integration_id","mailsystem").maybeSingle();
  if(error)throw error;
  if(!state?.installed||!state.enabled)throw Object.assign(new Error("Install and enable Mail System first."),{status:409});
  const body=await req.json().catch(()=>null);
  const config=await getMailModuleConfig();
  let mailboxes=body?.mailboxes;
  if(typeof body?.domain==="string"){
   const domain=body.domain.trim().toLowerCase();
   const catalogue=await getMailboxCatalogue(config);
   if(!catalogue.provisioning_domains.includes(domain))throw Object.assign(new Error("Select an authorized provisioning domain."),{status:403});
   const {data:departments,error:departmentError}=await db.from("support_departments").select("name,slug,email").eq("enabled",true);
   if(departmentError)throw departmentError;
   const assigned=new Set(catalogue.mailboxes.map(mailbox=>mailbox.address.toLowerCase()));
   const candidates=[{address:"system@"+domain,kind:"system",display_name:"System"},{address:"noreply@"+domain,kind:"system",display_name:"No reply"},...(departments||[]).map(row=>({address:row.email||String(row.slug||"").replace(/[^a-z0-9._-]/gi,"").toLowerCase()+"@"+domain,kind:"department",display_name:String(row.name||row.slug||"Department")}))];
   mailboxes=[...new Map(candidates.filter(item=>typeof item.address==="string"&&item.address.toLowerCase().endsWith("@"+domain)&&!assigned.has(item.address.toLowerCase())).map(item=>[item.address.toLowerCase(),item])).values()];
   if(!mailboxes.length)return Response.json({ok:true,results:[]},{headers:{"cache-control":"no-store"}});
  }
  if(!Array.isArray(mailboxes)||mailboxes.length>100)throw Object.assign(new Error("Provide up to 100 mailboxes."),{status:400});
  const response=await fetch(config.baseUrl+"/api/integrations/mailboxes",{method:"POST",headers:{Authorization:"Bearer "+config.apiKey,"Content-Type":"application/json"},body:JSON.stringify({mailboxes}),cache:"no-store",signal:AbortSignal.timeout(15000)});
  const result=await response.json().catch(()=>({}));
  return Response.json(result,{status:response.status,headers:{"cache-control":"no-store"}});
 }catch(error){return integrationErrorResponse(error,"Unable to provision mailbox.");}
}
