import {licenseDb} from "@/lib/license-api";
import {masterControl,masterIssue,masterLicenses} from "@/lib/master-api";
import {syncPaidOrderToLicenseMaster} from "@/lib/license-master-sync";

const CANONICAL=new Set(["orbitfs_base","orbitfs_apex","orbitfs_mcp","orbitfs_studio"]);
const MAX_BATCH=50;
function productOf(binding:any){return String(binding?.license_product_key||"").trim().toLowerCase()}
function masterId(result:any){return String(result?.id||result?.license_id||result?.license?.id||result?.licence?.id||result?.binding?.id||"").trim()}
function masterKey(result:any){return String(result?.license_key||result?.licenseKey||result?.key||result?.license?.license_key||result?.license?.licenseKey||result?.licence?.license_key||"").trim()}
function masterState(result:any,fallback:string){return String(result?.status||result?.license?.status||result?.licence?.status||result?.binding?.status||fallback).trim().toLowerCase()}

export async function reconcileLicenseMaster(limit=MAX_BATCH){
 const db=licenseDb(),cap=Math.min(MAX_BATCH,Math.max(1,Number(limit)||MAX_BATCH));
 const results:any[]=[],failures:any[]=[];
 try{
  const [snapshot,customersResult]=await Promise.all([
   masterLicenses(),
   db.from("customers").select("id,auth_user_id,user_id,customer_number")
  ]);
  if(customersResult.error)throw customersResult.error;
  const customers=customersResult.data||[],byNumber=new Map(customers.filter((x:any)=>x.customer_number).map((x:any)=>[String(x.customer_number).toLowerCase(),x]));
  const remotes=Array.isArray(snapshot?.licenses)?snapshot.licenses:[];
  for(const remoteLicense of remotes){
   const id=masterId(remoteLicense),product=String(remoteLicense?.product_code||remoteLicense?.product||"").toLowerCase();
   if(!id||product!=="orbitfs_base"||["revoked","expired"].includes(String(remoteLicense?.status||"").toLowerCase()))continue;
   const customer:any=byNumber.get(String(remoteLicense?.customer_external_id||"").toLowerCase());
   if(!customer)continue;
   const userId=String(customer.auth_user_id||customer.user_id||"");if(!userId)continue;
   const policy=remoteLicense?.metadata?.license_policy||{},raw=remoteLicense?.components||policy?.components||{};
   const components={orbitfs_base:true,orbitfs_apex:Boolean(raw.orbitfs_apex),orbitfs_mcp:Boolean(raw.orbitfs_mcp),orbitfs_studio:Boolean(raw.orbitfs_studio)};
   const owner=await db.from("license_bindings").select("id,auth_user_id").eq("license_id",id).is("archived_at",null).limit(1).maybeSingle();
   if(owner.error)throw owner.error;
   const now=new Date().toISOString(),payload:any={auth_user_id:userId,license_id:id,license_product_key:"orbitfs_base",desired_state:String(remoteLicense.status||"active"),remote_state:String(remoteLicense.status||"active"),components,license_key_last4:remoteLicense.license_key_last4||null,expires_at:remoteLicense.expires_at||null,label:remoteLicense.product_name||remoteLicense.product||"OrbitFS Base",api_source:"license_master",admin_override:true,last_synced_at:now,last_sync_error:null,updated_at:now};
   let bindingId=owner.data?.id||null;
   if(bindingId){
    const write=await db.from("license_bindings").update(payload).eq("id",bindingId);if(write.error)throw write.error;
    if(String(owner.data.auth_user_id)!==userId){const move=await db.from("orbitfs_installations").update({auth_user_id:userId,updated_at:now}).eq("license_binding_id",bindingId);if(move.error)throw move.error;}
   }else{
    const write=await db.from("license_bindings").insert(payload).select("id").single();if(write.error)throw write.error;bindingId=write.data?.id||null;
   }
   results.push({kind:"authority_link",licenseId:id,bindingId,customerId:customer.id,customerNumber:customer.customer_number,status:"synced"});
  }
 }catch(error:any){failures.push({kind:"authority_link",error:String(error?.message||error)})}
 const pendingResult=await db.from("license_fulfillments").select("order_id,order_item_id,state,attempt_count,last_error").in("state",["pending","failed"]).not("order_id","is",null).order("updated_at",{ascending:true}).limit(cap);
 if(pendingResult.error)throw pendingResult.error;
 const orderIds=[...new Set((pendingResult.data||[]).map((x:any)=>String(x.order_id)).filter(Boolean))];
 for(const orderId of orderIds){try{const r=await syncPaidOrderToLicenseMaster(orderId);results.push({kind:"fulfillment",orderId,result:r})}catch(error:any){failures.push({kind:"fulfillment",orderId,error:String(error?.message||error)})}}
 const [errorResult,mismatchResult]=await Promise.all([
  db.from("license_bindings").select("*").not("last_sync_error","is",null).order("updated_at",{ascending:true}).limit(cap),
  db.from("license_bindings").select("*").not("desired_state","is",null).order("updated_at",{ascending:true}).limit(cap*2)
 ]);
 if(errorResult.error)throw errorResult.error;if(mismatchResult.error)throw mismatchResult.error;
 const seenBindings=new Set<string>(),bindings:any[]=[];
 for(const row of [...(errorResult.data||[]),...(mismatchResult.data||[]).filter((x:any)=>String(x.desired_state||"").toLowerCase()!==String(x.remote_state||"").toLowerCase())]){
  const id=String(row.id||"");if(id&&!seenBindings.has(id)){seenBindings.add(id);bindings.push(row)}if(bindings.length>=cap)break;
 }
 for(const binding of bindings){
  const bindingId=String(binding.id||"");
  try{
   if(!bindingId)continue;
   const desired=String(binding.desired_state||"").toLowerCase(),remote=String(binding.remote_state||"").toLowerCase(),product=productOf(binding);
   if(!CANONICAL.has(product)){await db.from("license_bindings").update({last_synced_at:new Date().toISOString(),last_sync_error:null}).eq("id",bindingId);continue}
   if(remote===desired&&!binding.last_sync_error)continue;
   if(remote===desired&&binding.last_sync_error&&binding.license_id){
    const confirmationAction=desired==="active"?"activate":desired==="suspended"?"suspend":desired==="revoked"?"revoke":"";
    if(confirmationAction){const confirmation=await masterControl(String(binding.license_id),{action:confirmationAction,actorRef:"billing_store_reconciliation_retry"});const confirmedState=masterState(confirmation,desired);if(confirmedState!==desired)throw new Error("License Master returned state "+confirmedState+" while Billing Store expected "+desired);const now=new Date().toISOString();const {error:confirmWrite}=await db.from("license_bindings").update({remote_state:desired,last_synced_at:now,last_sync_error:null,updated_at:now}).eq("id",bindingId);if(confirmWrite)throw confirmWrite;results.push({kind:"binding",bindingId,licenseId:String(binding.license_id),desired,remoteState:desired,status:"reconfirmed"});continue}
   }
   const orderResult=binding.order_id?await db.from("orders").select("id,order_number,auth_user_id,status,payment_status").eq("id",binding.order_id).maybeSingle():{data:null,error:null};
   if(orderResult.error)throw orderResult.error;
   const order=orderResult.data,userId=String(binding.auth_user_id||order?.auth_user_id||"").trim();
   if(!userId)throw new Error("Binding has no customer account");
   const customerResult=await db.from("customers").select("id,customer_number").or("auth_user_id.eq."+userId+",user_id.eq."+userId).maybeSingle();
   if(customerResult.error)throw customerResult.error;
   const customer=customerResult.data,customerNumber=String(customer?.customer_number||"").trim();
   if(!customerNumber)throw new Error("Customer number is missing");
   let remoteResult:any=null,newLicenseId=String(binding.license_id||"");
   if(desired==="active"&&(remote!=="active"||!newLicenseId)){
    if(!order||!String(order.payment_status||"").toLowerCase().startsWith("paid")||String(order.status||"").toLowerCase()!=="active")throw new Error("Active license reconciliation requires a paid, active order");
    const ref=String(binding.order_id||order.id)+":"+String(binding.order_item_id||binding.id)+":reconcile";
    remoteResult=await masterIssue({product,customer_external_id:customerNumber,external_reference:ref,metadata:{billingOrderId:String(order.id),orderNumber:String(order.order_number||""),orderItemId:binding.order_item_id||null,customerId:customer?.id||null,customerNumber,licenseProductKey:product,source:"v2_billing_store_reconciliation"}});
    newLicenseId=masterId(remoteResult);
    if(!newLicenseId)throw new Error("License Master did not return a license id");
   }else if(desired==="suspended"||desired==="revoked"){
    if(!newLicenseId)throw new Error("Binding has no License Master license id");
    remoteResult=await masterControl(newLicenseId,{action:desired==="revoked"?"revoke":"suspend",actorRef:"billing_store_reconciliation"});
   }else if(desired){throw new Error("Unsupported desired license state: "+desired)}
   const now=new Date().toISOString(),state=desired==="active"?masterState(remoteResult,"active"):desired==="revoked"?"revoked":"suspended",key=masterKey(remoteResult);
   const patch:any={remote_state:state,last_synced_at:now,last_sync_error:null,updated_at:now};
   if(newLicenseId)patch.license_id=newLicenseId;if(key)patch.license_key_last4=key.slice(-4);
   if(desired==="active"){patch.archived_at=null;patch.archive_reason=null;patch.suspension_reason=null}
   const write=await db.from("license_bindings").update(patch).eq("id",bindingId);if(write.error)throw write.error;
   if(desired==="active"&&binding.fulfillment_id){const {error:fe}=await db.from("license_fulfillments").update({license_id:newLicenseId,state:"fulfilled",last_error:null,fulfilled_at:now,attempt_count:Number(binding.attempt_count||0)+1,updated_at:now,metadata:{...(binding.metadata||{}),reconciled:true,master_license_id:newLicenseId}}).eq("id",binding.fulfillment_id);if(fe)throw fe}
   if(desired==="active"&&newLicenseId&&newLicenseId!==String(binding.license_id||"")){const entitlementResult=await db.from("download_entitlements").select("id,metadata").eq("auth_user_id",userId).eq("order_item_id",binding.order_item_id||"").maybeSingle();if(entitlementResult.error)throw entitlementResult.error;if(entitlementResult.data){const metadata={...(entitlementResult.data.metadata||{}),license_id:newLicenseId,master_license_id:newLicenseId,reconciled:true,previous_license_id:binding.license_id||null};const {error:ee}=await db.from("download_entitlements").update({metadata,status:"active",revoked_at:null,reason:"License Master reconciliation"}).eq("id",entitlementResult.data.id);if(ee)throw ee}}
   results.push({kind:"binding",bindingId,licenseId:newLicenseId,desired,remoteState:state,status:"ok"});
  }catch(error:any){const message=String(error?.message||error).slice(0,1000);await db.from("license_bindings").update({last_sync_error:message,updated_at:new Date().toISOString()}).eq("id",bindingId);failures.push({kind:"binding",bindingId,licenseId:binding.license_id||null,error:message})}
 }
 return {ok:failures.length===0,processed:results.length,failed:failures.length,results,failures};
}