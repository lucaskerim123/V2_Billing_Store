import {randomUUID,timingSafeEqual} from "node:crypto";
import {licenseDb} from "@/lib/license-api";
import {rollbackCustomerUpdate,runCustomerDeployer} from "@/lib/orbitfs-customer-deployer";
import {runBaseLifecycleOperation,type BaseLifecycleAction} from "@/lib/orbitfs-base-operations";

function safeEqual(a:string,b:string){const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb)}
function authorized(req:Request){
 const expected=String(process.env.DEV_PANEL_EVENT_SECRET||"").trim();
 const supplied=String(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim()||String(req.headers.get("x-orbitfs-event-secret")||"").trim();
 return Boolean(expected&&supplied&&safeEqual(supplied,expected));
}
async function findCustomer(identity:string){
 const db=licenseDb(),value=identity.trim();if(!value)return null;
 if(value.includes("@")){const r=await db.from("customers").select("id,auth_user_id,user_id,customer_number,name,email").ilike("email",value).limit(2);if(r.error)throw r.error;return r.data?.[0]||null}
 let r=await db.from("customers").select("id,auth_user_id,user_id,customer_number,name,email").eq("customer_number",value).limit(2);if(r.error)throw r.error;if(r.data?.length)return r.data[0];
 if(/^[0-9a-f-]{36}$/i.test(value)){r=await db.from("customers").select("id,auth_user_id,user_id,customer_number,name,email").or("id.eq."+value+",auth_user_id.eq."+value+",user_id.eq."+value).limit(2);if(r.error)throw r.error;if(r.data?.length)return r.data[0]}
 return null;
}
async function findInstallation(body:any){
 const db=licenseDb();
 const wanted=String(body.installation_id||body.installationId||"").trim();
 if(wanted){
  const isUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(wanted);
  const byId=isUuid
   ?await db.from("orbitfs_installations").select("*").or("id.eq."+wanted+",installation_id.eq."+wanted).limit(2)
   :await db.from("orbitfs_installations").select("*").eq("installation_id",wanted).limit(2);
  if(byId.error)throw byId.error;if(byId.data?.length)return byId.data[0];
 }
 const identity=String(body.identity||body.email||body.customer||"").trim();
 if(identity){
  const customer=await findCustomer(identity);
  const userId=String(customer?.auth_user_id||customer?.user_id||"").trim();
  if(userId){
   const rows=await db.from("orbitfs_installations").select("*").eq("auth_user_id",userId).order("created_at",{ascending:false}).limit(10);
   if(rows.error)throw rows.error;
   if(rows.data?.length===1)return rows.data[0];
   if(rows.data?.length>1)throw Object.assign(new Error("Multiple installations match this customer; specify installation_id."),{status:409,installations:rows.data.map((x:any)=>({id:x.id,installation_id:x.installation_id,state:x.state,release_version:x.release_version,vercel_project_name:x.vercel_project_name}))});
  }
 }
 return null;
}

export async function POST(req:Request){
 if(!authorized(req))return Response.json({error:"UNAUTHORIZED"},{status:401});
 try{
  const body:any=await req.json().catch(()=>({}));
  const action=String(body.action||"status").trim().toLowerCase();
  const install=await findInstallation(body);
  if(!install)return Response.json({error:"INSTALLATION_NOT_FOUND"},{status:404});
  if(action==="status")return Response.json({ok:true,installation:install},{headers:{"cache-control":"no-store"}});
  const version=body.version?String(body.version).trim():undefined;
  const releaseId=body.release_id||body.releaseId?String(body.release_id||body.releaseId).trim():undefined;
  const channel=String(body.channel||install.release_channel||"stable").trim().toLowerCase();
  const reason=String(body.reason||"Dev MCP operation").trim();
  if(action==="update"){
   const installation=await runCustomerDeployer(install,"update",version,channel,releaseId,reason);
   return Response.json({ok:true,action,installation},{headers:{"cache-control":"no-store"}});
  }
  if(action==="rollback_update"){
   const result=await rollbackCustomerUpdate(install,reason);
   return Response.json({ok:true,action,...result},{headers:{"cache-control":"no-store"}});
  }
  if(["deploy","base_update","redeploy","rollback"].includes(action)){
   const result=await runBaseLifecycleOperation({
    install,
    action:action as BaseLifecycleAction,
    version,
    channel,
    releaseId,
    reason,
    idempotencyKey:String(body.idempotency_key||body.idempotencyKey||("devmcp-"+randomUUID()))
   });
   return Response.json({ok:true,action,...result},{headers:{"cache-control":"no-store"}});
  }
  return Response.json({error:"UNSUPPORTED_ACTION"},{status:400});
 }catch(error:any){
  return Response.json({error:String(error?.message||"Customer operation failed"),code:error?.code||"CUSTOMER_OPERATION_FAILED",installations:error?.installations||undefined},{status:Number(error?.status||500)});
 }
}
