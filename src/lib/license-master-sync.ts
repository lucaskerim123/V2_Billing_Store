import {licenseDb} from "@/lib/license-api";
import {masterIssue} from "@/lib/master-api";

const CANONICAL=new Set(["orbitfs_base","orbitfs_apex","orbitfs_mcp","orbitfs_studio"]);
const ALIASES:Record<string,string>={orbitfs_panel:"orbitfs_base",orbitfs_sorter:"orbitfs_apex"};
const MAX_ITEMS=20;
const REQUEST_TIMEOUT_MS=10000;

function canonicalComponent(value:any){const key=String(value||"").trim().toLowerCase();return ALIASES[key]||key}

function timeout(ms=REQUEST_TIMEOUT_MS){const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);return {signal:c.signal,clear:()=>clearTimeout(t)}}

export async function syncPaidOrderToLicenseMaster(orderId:string){
  const id=String(orderId||"").trim();if(!id)throw new Error("Order ID is required");
  const db=licenseDb();
  const {data:order,error:orderError}=await db.from("orders").select("id,order_number,auth_user_id,status,payment_status,fulfillment_status").eq("id",id).maybeSingle();
  if(orderError)throw orderError;
  if(!order)return {ok:false,skipped:true,reason:"order_not_found"};
  const paid=String(order.payment_status||"").toLowerCase().startsWith("paid")||String(order.status||"").toLowerCase()==="active";
  if(!paid)return {ok:false,skipped:true,reason:"order_not_paid"};
  if(!order.auth_user_id)throw new Error("Paid order has no customer user id");

  const {data:items,error:itemError}=await db.from("order_items").select("id,product_id,product_name,license_product_key,quantity,configuration").eq("order_id",id).order("id").limit(MAX_ITEMS);
  if(itemError)throw itemError;
  if((items||[]).length>=MAX_ITEMS)throw new Error(`Order exceeds fulfilment safety limit of ${MAX_ITEMS} line items`);

  const results=[];let fulfilled=0;let failed=0;
  for(const item of items||[]){
    if(item.configuration?.gift===true)continue;
    const product=canonicalComponent(item.license_product_key);
    if(!CANONICAL.has(product))continue;
    const ref=`${id}:${String(item.id)}`;
    const {data:existing}=await db.from("license_fulfillments").select("id,license_id,state,attempt_count,last_error,fulfilled_at,metadata").eq("order_item_id",item.id).maybeSingle();
    if(existing?.license_id&&existing.state==="fulfilled"){
      results.push({product,orderItemId:item.id,licenseId:existing.license_id,reused:true,state:"fulfilled"});fulfilled++;continue;
    }
    try{
      const result=await masterIssue({product_code:product,customer_external_id:String(order.auth_user_id),external_reference:ref,metadata:{billingOrderId:String(id),orderNumber:String(order.order_number||""),orderItemId:String(item.id),licenseProductKey:product,quantity:Number(item.quantity||1),source:"v2_billing_store"}});
      const licenseId=String(result?.id||result?.license_id||"");
      if(!licenseId)throw new Error("License Master did not return a license id");
      const now=new Date().toISOString();
      const {data:upserted,error:upsertError}=await db.from("license_fulfillments").upsert({id:existing?.id,order_id:id,order_item_id:item.id,auth_user_id:order.auth_user_id,license_id:licenseId,state:"fulfilled",attempt_count:Number(existing?.attempt_count||0)+1,last_error:null,fulfilled_at:now,metadata:{...(existing?.metadata||{}),license_product_key:product,master_response:{id:licenseId,status:result?.status||null,alreadyIssued:Boolean(result?.already_issued)}}},{onConflict:"order_item_id"}).select("id,license_id,state,fulfilled_at").single();
      if(upsertError)throw upsertError;
      results.push({product,orderItemId:item.id,licenseId,licenseKey:result?.license_key||null,state:upserted.state,reused:Boolean(result?.already_issued)});fulfilled++;
    }catch(error:any){
      failed++;await db.from("license_fulfillments").upsert({id:existing?.id,order_id:id,order_item_id:item.id,auth_user_id:order.auth_user_id,state:"failed",attempt_count:Number(existing?.attempt_count||0)+1,last_error:String(error?.message||"License fulfilment failed").slice(0,1000),metadata:{...(existing?.metadata||{}),license_product_key:product}},{onConflict:"order_item_id"});
      results.push({product,orderItemId:item.id,state:"failed",error:String(error?.message||"License fulfilment failed")});
    }
  }

  const nextFulfillment=failed?"partial":fulfilled?"fulfilled":"pending";
  await db.from("orders").update({fulfillment_status:nextFulfillment,service_status:failed?"provisioning_error":"active",activated_at:fulfilled?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq("id",id);
  return {ok:failed===0,orderId:id,fulfilled,failed,fulfillmentStatus:nextFulfillment,results};
}
