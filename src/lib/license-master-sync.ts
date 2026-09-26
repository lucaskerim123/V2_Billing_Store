import {licenseDb} from "@/lib/license-api";
import {masterControl,masterIssue} from "@/lib/master-api";
import {getLicenseMasterAvailability} from "@/lib/license-master-availability";

const CANONICAL=new Set(["orbitfs_base","orbitfs_apex","orbitfs_mcp","orbitfs_studio"]);
const ALIASES:Record<string,string>={orbitfs_panel:"orbitfs_base",orbitfs_sorter:"orbitfs_apex"};
const MAX_ITEMS=20;
function canonicalComponent(value:any){const key=String(value||"").trim().toLowerCase();return ALIASES[key]||key}

export async function syncPaidOrderToLicenseMaster(orderId:string,options:{manual?:boolean}={}){
  const authority=await getLicenseMasterAvailability();
  if(authority.effectiveMode==="manual"){
    const db=licenseDb();
    const id=String(orderId||"").trim();
    if(id){
      const now=new Date().toISOString();
      const {data:order}=await db.from("orders").select("metadata").eq("id",id).maybeSingle();
      await db.from("orders").update({
        fulfillment_status:"pending",
        service_status:"pending",
        metadata:{...(order?.metadata||{}),fulfillment_hold_reason:"manual_fulfillment",fulfillment_mode:"manual",license_master_restricted:false,license_master_reachable:authority.reachable},
        updated_at:now
      }).eq("id",id);
    }
    return {ok:true,skipped:true,reason:"manual_fulfillment_queue",authority};
  }
  const allowed=options.manual?authority.manualFulfillmentAllowed:authority.automaticFulfillmentAllowed;
  if(!allowed){
    const db=licenseDb();
    const id=String(orderId||"").trim();
    if(id){
      const now=new Date().toISOString();
      const {data:order}=await db.from("orders").select("metadata").eq("id",id).maybeSingle();
      await db.from("orders").update({
        fulfillment_status:"pending",
        service_status:"pending",
        metadata:{...(order?.metadata||{}),fulfillment_hold_reason:authority.reason,fulfillment_mode:authority.effectiveMode,license_master_restricted:true,license_master_reachable:authority.reachable},
        updated_at:now
      }).eq("id",id);
    }
    return {ok:true,skipped:true,reason:"fulfillment_on_hold",authority};
  }
  const id=String(orderId||"").trim();if(!id)throw new Error("Order ID is required");
  const db=licenseDb();
  const {data:order,error:orderError}=await db.from("orders").select("id,order_number,auth_user_id,status,payment_status,fulfillment_status").eq("id",id).maybeSingle();
  if(orderError)throw orderError;if(!order)return {ok:false,skipped:true,reason:"order_not_found"};
  const status=String(order.status||"").toLowerCase(),paid=String(order.payment_status||"").toLowerCase().startsWith("paid");
  if(!paid||status!=="active")return {ok:false,skipped:true,reason:status==="pending_approval"?"order_pending_approval":"order_not_accepted"};
  if(!order.auth_user_id)throw new Error("Paid order has no customer user id");
  const {data:customer,error:customerError}=await db.from("customers").select("id,user_id,auth_user_id,customer_number").or(`user_id.eq.${order.auth_user_id},auth_user_id.eq.${order.auth_user_id}`).maybeSingle();
  if(customerError)throw customerError;
  const customerId=String(customer?.id||"").trim(),customerNumber=String(customer?.customer_number||"").trim();
  if(!customerNumber)throw new Error("Billing Store customer number is missing for this paid order");
  const {data:items,error:itemError}=await db.from("order_items").select("id,product_id,product_name,license_product_key,quantity,configuration").eq("order_id",id).order("id").limit(MAX_ITEMS+1);
  if(itemError)throw itemError;if((items||[]).length>MAX_ITEMS)throw new Error(`Order exceeds fulfilment safety limit of ${MAX_ITEMS} line items`);
  const normalizedItems=(items||[]).map((item:any)=>({...item,license_product_key:canonicalComponent(item.license_product_key)}));
  const hasBase=normalizedItems.some((item:any)=>item.configuration?.gift!==true&&item.license_product_key==="orbitfs_base");
  const hasAddon=normalizedItems.some((item:any)=>item.configuration?.gift!==true&&["orbitfs_apex","orbitfs_mcp","orbitfs_studio"].includes(item.license_product_key));
  const {data:existingBaseBinding,error:baseBindingError}=await db.from("license_bindings").select("id,license_id,components,fulfillment_id,order_id,order_item_id,desired_state,remote_state,license_key_last4,label,api_source").eq("auth_user_id",order.auth_user_id).eq("license_product_key","orbitfs_base").neq("desired_state","revoked").order("created_at",{ascending:true}).limit(1).maybeSingle();
  if(baseBindingError)throw baseBindingError;
  let baseBinding:any=existingBaseBinding||null;
  if(hasAddon&&!hasBase&&!baseBinding?.license_id)throw new Error("OrbitFS Base is required before any OrbitFS add-on can be fulfilled");
  const results=[];let fulfilled=0,failed=0;
  const orderedItems=[...normalizedItems].sort((a:any,b:any)=>Number(b.license_product_key==="orbitfs_base")-Number(a.license_product_key==="orbitfs_base"));
  for(const item of orderedItems){
    if(item.configuration?.gift===true)continue;
    const product=String(item.license_product_key||"");if(!CANONICAL.has(product))continue;
    const ref=`${id}:${String(item.id)}`;
    const {data:existing}=await db.from("license_fulfillments").select("id,license_id,state,attempt_count,last_error,fulfilled_at,metadata").eq("order_item_id",item.id).maybeSingle();
    if(existing?.license_id&&existing.state==="fulfilled"){
      if(product==="orbitfs_base"){
        const {data:existingBinding}=await db.from("license_bindings").select("id,license_id,components,fulfillment_id,order_id,order_item_id,desired_state,remote_state,license_key_last4,label,api_source").eq("order_item_id",item.id).maybeSingle();
        if(!existingBinding?.id){
          const now=new Date().toISOString();
          const bindingRepair={order_id:id,order_item_id:item.id,auth_user_id:order.auth_user_id,fulfillment_id:existing.id,license_id:existing.license_id,license_product_key:product,desired_state:"active",remote_state:"active",components:{orbitfs_base:true},label:String(item.product_name||product),api_source:"license_master",updated_at:now};
          let repaired=false;
          for(let attempt=1;attempt<=3&&!repaired;attempt++){
            const write=await db.from("license_bindings").insert(bindingRepair);
            repaired=!write.error;
            if(!repaired&&attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*300));
          }
          if(!repaired)throw new Error("Existing fulfilled Base licence is missing its Billing Store binding and could not be repaired");
          baseBinding={...bindingRepair,id:undefined};
        } else baseBinding=existingBinding;
      }
      results.push({product,orderItemId:item.id,licenseId:existing.license_id,reused:true,attachedToBase:product!=="orbitfs_base",state:"fulfilled"});fulfilled++;continue
    }
    try{
      if(product!=="orbitfs_base"){
        if(!baseBinding?.license_id)throw new Error("OrbitFS Base licence binding is missing");
        const now=new Date().toISOString();
        const components={...(baseBinding.components||{}),orbitfs_base:true,[product]:true};
        const result=await masterControl(String(baseBinding.license_id),{action:"set-components",components,actorRef:"billing_store_fulfillment"});
        const remoteState=String(result?.license?.status||baseBinding.remote_state||"active");
        const {data:upserted,error:upsertError}=await db.from("license_fulfillments").upsert({id:existing?.id,order_id:id,order_item_id:item.id,auth_user_id:order.auth_user_id,license_id:String(baseBinding.license_id),state:"fulfilled",attempt_count:Number(existing?.attempt_count||0)+1,last_error:null,fulfilled_at:now,metadata:{...(existing?.metadata||{}),license_product_key:product,customer_number:customerNumber,customer_id:customerId,attached_to_base:true,base_binding_id:baseBinding.id,master_response:{id:String(baseBinding.license_id),status:remoteState}}},{onConflict:"order_item_id"}).select("id,license_id,state,fulfilled_at").single();
        if(upsertError)throw upsertError;
        const bindingUpdate=await db.from("license_bindings").update({components,remote_state:remoteState,updated_at:now}).eq("id",baseBinding.id);
        if(bindingUpdate.error)throw bindingUpdate.error;
        baseBinding={...baseBinding,components,remote_state:remoteState};
        const {error:entitlementError}=await db.from("download_entitlements").upsert({auth_user_id:order.auth_user_id,order_id:id,order_item_id:item.id,product_id:item.product_id,status:"active",granted_at:now,revoked_at:null,reason:"License Master component entitlement",metadata:{license_id:String(baseBinding.license_id),license_product_key:product,base_binding_id:baseBinding.id,attached_to_base:true,customer_id:customerId,source:"license_master"},source_order_status:String(order.status||order.payment_status||"")},{onConflict:"auth_user_id,order_item_id"});
        if(entitlementError)throw entitlementError;
        results.push({product,orderItemId:item.id,licenseId:String(baseBinding.license_id),attachedToBase:true,state:upserted.state});
        fulfilled++;
        continue;
      }

      if(baseBinding?.license_id){
        const now=new Date().toISOString();
        const components={...(baseBinding.components||{}),orbitfs_base:true};
        await masterControl(String(baseBinding.license_id),{action:"set-components",components,actorRef:"billing_store_fulfillment"});
        const {data:upserted,error:upsertError}=await db.from("license_fulfillments").upsert({id:existing?.id,order_id:id,order_item_id:item.id,auth_user_id:order.auth_user_id,license_id:String(baseBinding.license_id),state:"fulfilled",attempt_count:Number(existing?.attempt_count||0)+1,last_error:null,fulfilled_at:now,metadata:{...(existing?.metadata||{}),license_product_key:product,customer_number:customerNumber,customer_id:customerId,reused_base:true,base_binding_id:baseBinding.id}},{onConflict:"order_item_id"}).select("id,license_id,state,fulfilled_at").single();
        if(upsertError)throw upsertError;
        await db.from("license_bindings").update({components,updated_at:now}).eq("id",baseBinding.id);
        const {error:entitlementError}=await db.from("download_entitlements").upsert({auth_user_id:order.auth_user_id,order_id:id,order_item_id:item.id,product_id:item.product_id,status:"active",granted_at:now,revoked_at:null,reason:"License Master Base entitlement",metadata:{license_id:String(baseBinding.license_id),license_product_key:product,base_binding_id:baseBinding.id,reused_base:true,customer_id:customerId,source:"license_master"},source_order_status:String(order.status||order.payment_status||"")},{onConflict:"auth_user_id,order_item_id"});
        if(entitlementError)throw entitlementError;
        baseBinding={...baseBinding,components};
        results.push({product,orderItemId:item.id,licenseId:String(baseBinding.license_id),reused:true,state:upserted.state});
        fulfilled++;
        continue;
      }

      const components={orbitfs_base:true};
      const result=await masterIssue({product_code:product,customer_external_id:customerNumber,external_reference:ref,components,metadata:{billingOrderId:String(id),orderNumber:String(order.order_number||""),orderItemId:String(item.id),customerId,customerNumber,licenseProductKey:product,quantity:Number(item.quantity||1),source:"v2_billing_store"}});
      const licenseId=String(result?.id||result?.license_id||result?.licence?.id||result?.license?.id||result?.binding?.id||"");
      const licenseKey=String(result?.license_key||result?.licenseKey||result?.licenceKey||result?.key||result?.licence?.licenseKey||"");
      if(!licenseId)throw new Error("License Master did not return a licence/binding id");
      const now=new Date().toISOString(),remoteState=String(result?.status||result?.licence?.status||result?.license?.status||result?.binding?.status||"active");
      const {data:upserted,error:upsertError}=await db.from("license_fulfillments").upsert({id:existing?.id,order_id:id,order_item_id:item.id,auth_user_id:order.auth_user_id,license_id:licenseId,state:"fulfilled",attempt_count:Number(existing?.attempt_count||0)+1,last_error:null,fulfilled_at:now,metadata:{...(existing?.metadata||{}),license_product_key:product,customer_number:customerNumber,customer_id:customerId,master_response:{id:licenseId,status:remoteState,license_key_last4:licenseKey?licenseKey.slice(-4):null,idempotent:Boolean(result?.idempotent)}}},{onConflict:"order_item_id"}).select("id,license_id,state,fulfilled_at").single();
      if(upsertError)throw upsertError;
      const bindingPayload={order_id:id,order_item_id:item.id,auth_user_id:order.auth_user_id,fulfillment_id:upserted.id,license_id:licenseId,license_product_key:product,desired_state:"active",remote_state:remoteState,license_key_last4:licenseKey?licenseKey.slice(-4):null,label:String(item.product_name||product),api_source:"license_master",updated_at:now};
      const {data:binding}=await db.from("license_bindings").select("id").eq("order_item_id",item.id).maybeSingle();
      let bindingWrite:any=null;
      for(let attempt=1;attempt<=3;attempt++){
        bindingWrite=binding?.id?await db.from("license_bindings").update(bindingPayload).eq("id",binding.id):await db.from("license_bindings").insert(bindingPayload);
        if(!bindingWrite.error)break;
        if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*300));
      }
      if(bindingWrite?.error)throw bindingWrite.error;
      const {data:newBaseBinding}=await db.from("license_bindings").select("id,license_id,components,fulfillment_id,order_id,order_item_id,desired_state,remote_state,license_key_last4,label,api_source").eq("order_item_id",item.id).maybeSingle();
      if(newBaseBinding)baseBinding={...newBaseBinding,components};
      const {error:entitlementError}=await db.from("download_entitlements").upsert({auth_user_id:order.auth_user_id,order_id:id,order_item_id:item.id,product_id:item.product_id,status:"active",granted_at:now,revoked_at:null,reason:"License Master provisioning",metadata:{license_id:licenseId,license_product_key:product,customer_id:customerId,source:"license_master"},source_order_status:String(order.status||order.payment_status||"")},{onConflict:"auth_user_id,order_item_id"});if(entitlementError)throw entitlementError;
      results.push({product,orderItemId:item.id,licenseId,licenseKey:licenseKey||null,state:upserted.state,reused:Boolean(result?.idempotent)});fulfilled++;
    }catch(error:any){failed++;await db.from("license_fulfillments").upsert({id:existing?.id,order_id:id,order_item_id:item.id,auth_user_id:order.auth_user_id,state:"failed",attempt_count:Number(existing?.attempt_count||0)+1,last_error:String(error?.message||"License fulfilment failed").slice(0,1000),metadata:{...(existing?.metadata||{}),license_product_key:product,customer_number:customerNumber,customer_id:customerId}},{onConflict:"order_item_id"});results.push({product,orderItemId:item.id,state:"failed",error:String(error?.message||"License fulfilment failed")})}
  }
  const nextFulfillment=failed?"partial":fulfilled?"fulfilled":"pending";
  await db.from("orders").update({fulfillment_status:nextFulfillment,service_status:failed?"provisioning_error":"active",activated_at:fulfilled?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq("id",id);
  return {ok:failed===0,orderId:id,customerId,customerNumber,fulfilled,failed,fulfillmentStatus:nextFulfillment,results};
}