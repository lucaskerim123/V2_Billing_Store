import {licenseDb} from "@/lib/license-api";
import {masterControl,masterIssue,masterLicenses,masterProducts,masterRequest} from "@/lib/master-api";
import {getLicenseMasterAvailability} from "@/lib/license-master-availability";
import {deliverInitialLicenseKey} from "@/lib/license-key-delivery";

const ALIASES:Record<string,string>={orbitfs_panel:"orbitfs_base",orbitfs_sorter:"orbitfs_apex"};
const MAX_ITEMS=20;
function canonicalComponent(value:any){const key=String(value||"").trim().toLowerCase();return ALIASES[key]||key}

export async function syncPaidOrderToLicenseMaster(orderId:string,options:{manual?:boolean}={}){
  const authority=await getLicenseMasterAvailability();
  if(authority.effectiveMode==="manual"&&!options.manual){
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
  const {data:order,error:orderError}=await db.from("orders").select("id,order_number,auth_user_id,status,payment_status,fulfillment_status,updated_at").eq("id",id).maybeSingle();
  if(orderError)throw orderError;if(!order)return {ok:false,skipped:true,reason:"order_not_found"};
  const status=String(order.status||"").toLowerCase(),paid=String(order.payment_status||"").toLowerCase().startsWith("paid");
  if(!paid||status!=="active")return {ok:false,skipped:true,reason:status==="pending_approval"?"order_pending_approval":"order_not_accepted"};
  if(!order.auth_user_id)throw new Error("Paid order has no customer user id");
  const {data:customer,error:customerError}=await db.from("customers").select("id,user_id,auth_user_id,customer_number,email,name").or(`user_id.eq.${order.auth_user_id},auth_user_id.eq.${order.auth_user_id}`).maybeSingle();
  if(customerError)throw customerError;
  const customerId=String(customer?.id||"").trim(),customerNumber=String(customer?.customer_number||"").trim();
  if(!customerNumber)throw new Error("Billing Store customer number is missing for this paid order");
  const {data:items,error:itemError}=await db.from("order_items").select("id,product_id,product_name,license_product_key,quantity,configuration").eq("order_id",id).order("id").limit(MAX_ITEMS+1);
  if(itemError)throw itemError;if((items||[]).length>MAX_ITEMS)throw new Error(`Order exceeds fulfilment safety limit of ${MAX_ITEMS} line items`);
  const normalizedItems=(items||[]).map((item:any)=>({...item,license_product_key:canonicalComponent(item.license_product_key)}));
  let catalogue:any;
  try{
    catalogue=await masterProducts();
  }catch(catalogueError:any){
    const message="License Manager product catalogue request failed: "+String(catalogueError?.message||catalogueError).slice(0,900);
    const now=new Date().toISOString();
    for(const item of normalizedItems.filter((row:any)=>row.configuration?.gift!==true)){
      const {data:prior}=await db.from("license_fulfillments").select("id,attempt_count,metadata").eq("order_item_id",item.id).maybeSingle();
      const write=await db.from("license_fulfillments").upsert({
        id:prior?.id,
        order_id:id,
        order_item_id:item.id,
        auth_user_id:order.auth_user_id,
        state:"failed",
        attempt_count:Number(prior?.attempt_count||0)+1,
        last_error:message,
        metadata:{...(prior?.metadata||{}),license_product_key:item.license_product_key||null,customer_number:customerNumber,customer_id:customerId,preflight_failure:"license_manager_product_catalogue"}
      },{onConflict:"order_item_id"});
      if(write.error)console.error("Could not persist License Manager catalogue failure",{orderId:id,orderItemId:item.id,error:write.error});
    }
    await db.from("orders").update({fulfillment_status:"partial",service_status:"provisioning_error",updated_at:now}).eq("id",id);
    throw new Error(message);
  }
  const registeredProductEntries: [string, any][] = (
    Array.isArray(catalogue?.products) ? catalogue.products : []
  ).flatMap((p: any): [string, any][] =>
    [...new Set([p.code, p.product_code, p.slug]
      .map((value: any) => String(value || "").trim().toLowerCase())
      .filter(Boolean))]
      .map((identifier): [string, any] => [identifier, p])
  );
  const registeredProducts = new Map<string, any>(registeredProductEntries);
  const productRecord=(code:string)=>registeredProducts.get(String(code||"").trim().toLowerCase()) as any;
  const productCodeOf=(record:any)=>String(record?.code||record?.product_code||record?.slug||"").trim().toLowerCase();
  const productStrategy=(code:string)=>String(productRecord(code)?.validation_policy?.license_strategy||"standalone").trim().toLowerCase();
  const baseProductKeyFor=(code:string)=>{
    const configured=String(productRecord(code)?.validation_policy?.base_product_key||"").trim().toLowerCase();
    const baseRecord=productRecord(configured);
    return productCodeOf(baseRecord)||configured;
  };
  const componentKeyFor=(code:string)=>{
    const record=productRecord(code);
    return String(record?.componentKey||record?.component_key||record?.validation_policy?.component_key||productCodeOf(record)||code).trim().toLowerCase();
  };
  const productIds=[...new Set(normalizedItems.map((item:any)=>String(item.product_id||"")).filter(Boolean))];
  const localProductsResult=productIds.length
    ?await db.from("products").select("id,slug,name,description,license_product_key,license_api_enabled").in("id",productIds)
    :{data:[],error:null} as any;
  if(localProductsResult.error)throw localProductsResult.error;
  const localProductsById=new Map<string,{slug?:string;name?:string;description?:string;license_product_key?:string;license_api_enabled?:boolean}>((localProductsResult.data||[]).map((p:any):[string,{slug?:string;name?:string;description?:string;license_product_key?:string;license_api_enabled?:boolean}]=>[String(p.id),p]));
  const licenseEnabled=(item:any)=>localProductsById.get(String(item.product_id||""))?.license_api_enabled!==false;
  // The Billing Store product slug is the product-independent default API ID.
  // An explicit License Manager key always takes precedence.
  for(const item of normalizedItems){
    const local=localProductsById.get(String(item.product_id||""));
    if(!item.license_product_key){
      item.license_product_key=canonicalComponent(local?.license_product_key||local?.slug||"");
    }
  }
  const licensedItems=normalizedItems.filter((item:any)=>item.configuration?.gift!==true&&licenseEnabled(item)&&Boolean(item.license_product_key));
  // Register missing products centrally before issuing any licences. This keeps
  // product onboarding independent of OrbitFS-specific product configuration.
  const productsToRegister=[...new Set(licensedItems.map((item:any)=>String(item.license_product_key||"")).filter((code:string)=>code&&!registeredProducts.has(code)))];
  for(const code of productsToRegister){
    const item=licensedItems.find((row:any)=>String(row.license_product_key||"")===code);
    const local=localProductsById.get(String(item?.product_id||""));
    const payload={
      name:String(local?.name||item?.product_name||code),
      slug:code,
      description:local?.description||null,
      validation_policy:{max_installations:1,features:{},allowed_domains:[],minimum_version:"1.0.0",maximum_version:"999.999.999",allow_offline_grace:true,offline_grace_seconds:6000,license_strategy:"standalone"}
    };
    try{
      const created=await masterRequest<any>("/api/v1/products",{method:"POST",body:JSON.stringify(payload)});
      const record=created?.product||created;
      const identifiers=[record?.code,record?.product_code,record?.slug,code].map((value:any)=>String(value||"").trim().toLowerCase()).filter(Boolean);
      for(const identifier of identifiers)registeredProducts.set(identifier,record);
    }catch(registrationError:any){
      // A duplicate can mean another webhook registered it concurrently.
      if(Number(registrationError?.status)===409){
        const refreshed=await masterProducts();
        const record=(refreshed?.products||[]).find((p:any)=>[p.code,p.product_code,p.slug].some((value:any)=>String(value||"").trim().toLowerCase()===code));
        if(record){for(const identifier of [record.code,record.product_code,record.slug,code].map((value:any)=>String(value||"").trim().toLowerCase()).filter(Boolean))registeredProducts.set(identifier,record);continue;}
      }
      throw new Error("Could not register product "+code+" in License Manager: "+String(registrationError?.message||registrationError));
    }
  }
  for(const item of licensedItems){
    const product=String(item.license_product_key||"");
    const strategy=productStrategy(product);
    if(!["standalone","base","component"].includes(strategy))
      throw new Error("Product "+product+" has unsupported License Manager strategy "+strategy);
    if(strategy==="component"){
      const configured=String(productRecord(product)?.validation_policy?.base_product_key||"").trim().toLowerCase();
      const baseRecord=productRecord(configured);
      const baseCode=productCodeOf(baseRecord);
      if(!configured||!baseRecord||!baseCode||productStrategy(baseCode)!=="base")
        throw new Error("Component product "+product+" must reference a registered base product through validation_policy.base_product_key");
    }
  }
  const baseKeys=[...new Set(licensedItems.flatMap((item:any)=>{
    const product=String(item.license_product_key||"");
    const strategy=productStrategy(product);
    if(strategy==="base")return [productCodeOf(productRecord(product))||product];
    if(strategy==="component")return [baseProductKeyFor(product)].filter(Boolean);
    return [];
  }))];
  const baseBindingsResult=baseKeys.length
    ?await db.from("license_bindings").select("id,license_id,license_product_key,components,fulfillment_id,order_id,order_item_id,desired_state,remote_state,license_key_last4,label,api_source").eq("auth_user_id",order.auth_user_id).eq("admin_override",false).neq("desired_state","revoked").in("license_product_key",baseKeys).order("created_at",{ascending:true})
    :{data:[],error:null} as any;
  if(baseBindingsResult.error)throw baseBindingsResult.error;
  // Standalone products are issued directly and do not need a customer-wide
  // licence listing. Avoid making their fulfilment depend on the separate
  // licences.read permission; only base/component products need this snapshot
  // to find an existing base licence.
  const needsBaseSnapshot=licensedItems.some((item:any)=>["base","component"].includes(productStrategy(String(item.license_product_key||""))));
  const remoteSnapshot=needsBaseSnapshot?await masterLicenses():{licenses:[]};
  const remoteLicenseEntries: [string,string][] = (
    Array.isArray(remoteSnapshot?.licenses) ? remoteSnapshot.licenses : []
  ).map((license:any):[string,string]=>[
    String(license.id||license.license_id||""),
    String(license.canonical_status||license.effective_status||license.status||"").toLowerCase()
  ]);
  const remoteLicenses=new Map<string,string>(remoteLicenseEntries);
  const remoteLicenseActive=(licenseId:string)=>["active","locked"].includes(remoteLicenses.get(String(licenseId))||"");
  const baseBindings=new Map<string,any>();
  for(const binding of baseBindingsResult.data||[]){
    const key=String(binding.license_product_key||"").trim().toLowerCase();
    if(key&&binding.license_id&&remoteLicenseActive(String(binding.license_id))&&!baseBindings.has(key))
      baseBindings.set(key,binding);
  }
  // Claim the order with a conditional database update before calling the external
  // licence API. A competing request cannot acquire the same order concurrently.
  const priorState=String(order.fulfillment_status||"").toLowerCase();
  const staleBefore=new Date(Date.now()-10*60*1000).toISOString();
  if(priorState==="processing"&&String(order.updated_at||"")>=staleBefore)
    return {ok:true,skipped:true,reason:"already_processing",orderId:id};
  const claim=await db.from("orders")
    .update({fulfillment_status:"processing",updated_at:new Date().toISOString()})
    .eq("id",id)
    .eq("fulfillment_status",order.fulfillment_status)
    .eq("updated_at",order.updated_at)
    .select("id").maybeSingle();
  if(claim.error)throw claim.error;
  if(!claim.data)return {ok:true,skipped:true,reason:"already_processing",orderId:id};

  const results=[];let fulfilled=0,failed=0;
  const orderedItems=[...normalizedItems].sort((a:any,b:any)=>Number(productStrategy(b.license_product_key)==="base")-Number(productStrategy(a.license_product_key)==="base"));
  for(const item of orderedItems){
    if(item.configuration?.gift===true)continue;
    const product=String(item.license_product_key||"");
    if(!licenseEnabled(item)){
      results.push({product:product||null,orderItemId:item.id,state:"fulfilled",licensing:"disabled",skipped:true});
      fulfilled++;
      continue;
    }
    const ref=`${id}:${String(item.id)}`;
    const {data:existing}=await db.from("license_fulfillments").select("id,license_id,state,attempt_count,last_error,fulfilled_at,metadata").eq("order_item_id",item.id).maybeSingle();
    if(!product){
      const message="No License Manager product key is configured for this paid order item. Set the product's License Manager product API ID and register it in License Manager before retrying fulfilment.";
      failed++;
      await db.from("license_fulfillments").upsert({
        id:existing?.id,
        order_id:id,
        order_item_id:item.id,
        auth_user_id:order.auth_user_id,
        state:"failed",
        attempt_count:Number(existing?.attempt_count||0)+1,
        last_error:message,
        metadata:{...(existing?.metadata||{}),product_id:item.product_id||null,product_name:item.product_name||null,customer_number:customerNumber,customer_id:customerId}
      },{onConflict:"order_item_id"});
      results.push({product:null,orderItemId:item.id,state:"failed",error:message});
      continue;
    }
    if(!registeredProducts.has(product)){
      const error=new Error(`Product "${product}" is not registered and active in License Manager`);
      failed++;
      await db.from("license_fulfillments").upsert({id:existing?.id,order_id:id,order_item_id:item.id,auth_user_id:order.auth_user_id,state:"failed",attempt_count:Number(existing?.attempt_count||0)+1,last_error:error.message,metadata:{...(existing?.metadata||{}),license_product_key:product,customer_number:customerNumber,customer_id:customerId}},{onConflict:"order_item_id"});
      results.push({product,orderItemId:item.id,state:"failed",error:error.message});
      continue;
    }
    if(existing?.license_id&&existing.state==="fulfilled"&&remoteLicenseActive(String(existing.license_id))){
      if(productStrategy(product)==="base"){
        const {data:existingBinding}=await db.from("license_bindings").select("id,license_id,license_product_key,components,fulfillment_id,order_id,order_item_id,desired_state,remote_state,license_key_last4,label,api_source").eq("order_item_id",item.id).maybeSingle();
        if(existingBinding?.id){
          baseBindings.set(product,existingBinding);
        }else{
          const now=new Date().toISOString();
          const bindingRepair={order_id:id,order_item_id:item.id,auth_user_id:order.auth_user_id,fulfillment_id:existing.id,license_id:existing.license_id,license_product_key:product,desired_state:"active",remote_state:"active",components:{[product]:true},label:String(item.product_name||product),api_source:"license_master",admin_override:false,updated_at:now};
          let repairedBinding:any=null;
          for(let attempt=1;attempt<=3&&!repairedBinding;attempt++){
            const write=await db.from("license_bindings").insert(bindingRepair).select("id,license_id,license_product_key,components,fulfillment_id,order_id,order_item_id,desired_state,remote_state,license_key_last4,label,api_source").single();
            if(!write.error)repairedBinding=write.data;
            if(!repairedBinding&&attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*300));
          }
          if(!repairedBinding)throw new Error("Existing fulfilled base-product licence is missing its Billing Store binding and could not be repaired");
          baseBindings.set(product,repairedBinding);
        }
      }
      results.push({product,orderItemId:item.id,licenseId:existing.license_id,reused:true,attachedToBase:productStrategy(product)==="component",state:"fulfilled"});fulfilled++;continue
    }
    try{
      if(productStrategy(product)==="standalone"){
        const result=await masterIssue({product,customer_external_id:customerNumber,external_reference:ref,max_installations:Number(item.configuration?.max_installations||1),expires_at:item.configuration?.expires_at||null,features:item.configuration?.features&&typeof item.configuration.features==="object"?item.configuration.features:{},metadata:{billingOrderId:String(id),orderNumber:String(order.order_number||""),orderItemId:String(item.id),customerId,customerNumber,licenseProductKey:product,quantity:Number(item.quantity||1),source:"v2_billing_store"}});
        const licenseId=String(result?.id||result?.license_id||result?.license?.id||"");
        const licenseKey=String(result?.license_key||result?.licenseKey||result?.key||result?.license?.license_key||"");
        const alreadyIssued=Boolean(result?.already_issued||result?.license?.already_issued);
        if(!licenseId)throw new Error("License Manager did not return a licence ID");
        if(!licenseKey&&!alreadyIssued)throw new Error("License Manager returned a licence ID without the one-time licence key");
        if(!licenseKey&&alreadyIssued){const {data:priorDelivery,error:deliveryLookupError}=await db.from("license_key_deliveries").select("id").eq("license_id",licenseId).limit(1).maybeSingle();if(deliveryLookupError)throw deliveryLookupError;if(!priorDelivery)throw new Error("License Manager reused an existing licence, but Billing Store has no prior key-delivery record. Rotate the licence key before completing fulfilment.");}
        const now=new Date().toISOString();
        const remoteState=String(result?.storage_status||result?.license?.storage_status||result?.status||result?.license?.status||"active");
        const {data:upserted,error:upsertError}=await db.from("license_fulfillments").upsert({id:existing?.id,order_id:id,order_item_id:item.id,auth_user_id:order.auth_user_id,license_id:licenseId,state:"fulfilled",attempt_count:Number(existing?.attempt_count||0)+1,last_error:null,fulfilled_at:now,metadata:{...(existing?.metadata||{}),license_product_key:product,customer_number:customerNumber,customer_id:customerId,master_response:{id:licenseId,status:remoteState,license_key_last4:licenseKey?licenseKey.slice(-4):null,already_issued:Boolean(result?.already_issued||result?.license?.already_issued)}}},{onConflict:"order_item_id"}).select("id,license_id,state,fulfilled_at").single();
        if(upsertError)throw upsertError;
        const bindingPayload={order_id:id,order_item_id:item.id,auth_user_id:order.auth_user_id,fulfillment_id:upserted.id,license_id:licenseId,license_product_key:product,desired_state:"active",remote_state:remoteState,license_key_last4:licenseKey?licenseKey.slice(-4):null,label:String(item.product_name||product),api_source:"license_master",admin_override:false,updated_at:now};
        const {data:binding}=await db.from("license_bindings").select("id").eq("order_item_id",item.id).maybeSingle();
        const bindingWrite=binding?.id?await db.from("license_bindings").update(bindingPayload).eq("id",binding.id):await db.from("license_bindings").insert(bindingPayload);
        if(bindingWrite.error)throw bindingWrite.error;
        const {error:entitlementError}=await db.from("download_entitlements").upsert({auth_user_id:order.auth_user_id,order_id:id,order_item_id:item.id,product_id:item.product_id,status:"active",granted_at:now,revoked_at:null,reason:"License Manager product provisioning",metadata:{license_id:licenseId,license_product_key:product,customer_id:customerId,source:"license_master"},source_order_status:String(order.status||order.payment_status||"")},{onConflict:"auth_user_id,order_item_id"});
        if(entitlementError)throw entitlementError;
        let keyDelivery:any=null;
        if(licenseKey&&!alreadyIssued){
          try{
            if(!customer?.email)throw new Error("Customer email is missing; one-time licence-key email was not sent");
            keyDelivery=await deliverInitialLicenseKey({authUserId:String(order.auth_user_id),orderId:id,licenseId,licenseKey,recipient:String(customer.email),customerName:customer.name||null});
          }catch(deliveryError:any){keyDelivery={ok:false,error:String(deliveryError?.message||"Licence-key delivery failed")};}
        }
        results.push({product,orderItemId:item.id,licenseId,state:upserted.state,reused:alreadyIssued,keyDelivery});
        fulfilled++;
        continue;
      }
      if(productStrategy(product)==="component"){
        const requiredBaseKey=baseProductKeyFor(product);
        const baseBinding=baseBindings.get(requiredBaseKey);
        if(!requiredBaseKey||!baseBinding?.license_id||!baseBinding?.id)
          throw new Error("The required base product licence ("+requiredBaseKey+") is not linked to this customer");
        const componentKey=componentKeyFor(product);
        const now=new Date().toISOString();
        const result=await masterControl(String(baseBinding.license_id),{action:"set-component",component:componentKey,enabled:true,actorRef:"billing_store_fulfillment"});
        const components={...(result?.components||baseBinding.components||{}),[requiredBaseKey]:true,[componentKey]:true};
        const remoteState=String(result?.license?.storage_status||result?.storage_status||result?.license?.status||baseBinding.remote_state||"active");
        const {data:upserted,error:upsertError}=await db.from("license_fulfillments").upsert({id:existing?.id,order_id:id,order_item_id:item.id,auth_user_id:order.auth_user_id,license_id:String(baseBinding.license_id),state:"fulfilled",attempt_count:Number(existing?.attempt_count||0)+1,last_error:null,fulfilled_at:now,metadata:{...(existing?.metadata||{}),license_product_key:product,base_product_key:requiredBaseKey,component_key:componentKey,customer_number:customerNumber,customer_id:customerId,attached_to_base:true,base_binding_id:baseBinding.id,master_response:{id:String(baseBinding.license_id),status:remoteState}}},{onConflict:"order_item_id"}).select("id,license_id,state,fulfilled_at").single();
        if(upsertError)throw upsertError;
        const bindingUpdate=await db.from("license_bindings").update({components,remote_state:remoteState,updated_at:now}).eq("id",baseBinding.id);
        if(bindingUpdate.error)throw bindingUpdate.error;
        baseBindings.set(requiredBaseKey,{...baseBinding,components,remote_state:remoteState});
        const {error:entitlementError}=await db.from("download_entitlements").upsert({auth_user_id:order.auth_user_id,order_id:id,order_item_id:item.id,product_id:item.product_id,status:"active",granted_at:now,revoked_at:null,reason:"License Manager component entitlement",metadata:{license_id:String(baseBinding.license_id),license_product_key:product,base_product_key:requiredBaseKey,component_key:componentKey,base_binding_id:baseBinding.id,attached_to_base:true,customer_id:customerId,source:"license_master"},source_order_status:String(order.status||order.payment_status||"")},{onConflict:"auth_user_id,order_item_id"});
        if(entitlementError)throw entitlementError;
        results.push({product,orderItemId:item.id,licenseId:String(baseBinding.license_id),attachedToBase:true,baseProductKey:requiredBaseKey,state:upserted.state});
        fulfilled++;
        continue;
      }

      if(productStrategy(product)==="base"){
        const existingBase=baseBindings.get(product);
        if(existingBase?.license_id&&existingBase?.id){
          const now=new Date().toISOString();
          const components={...(existingBase.components||{}),[product]:true};
          await masterControl(String(existingBase.license_id),{action:"set-components",components,actorRef:"billing_store_fulfillment"});
          const {data:upserted,error:upsertError}=await db.from("license_fulfillments").upsert({id:existing?.id,order_id:id,order_item_id:item.id,auth_user_id:order.auth_user_id,license_id:String(existingBase.license_id),state:"fulfilled",attempt_count:Number(existing?.attempt_count||0)+1,last_error:null,fulfilled_at:now,metadata:{...(existing?.metadata||{}),license_product_key:product,customer_number:customerNumber,customer_id:customerId,reused_base:true,base_binding_id:existingBase.id}},{onConflict:"order_item_id"}).select("id,license_id,state,fulfilled_at").single();
          if(upsertError)throw upsertError;
          const bindingUpdate=await db.from("license_bindings").update({components,updated_at:now}).eq("id",existingBase.id);
          if(bindingUpdate.error)throw bindingUpdate.error;
          const {error:entitlementError}=await db.from("download_entitlements").upsert({auth_user_id:order.auth_user_id,order_id:id,order_item_id:item.id,product_id:item.product_id,status:"active",granted_at:now,revoked_at:null,reason:"License Manager base-product entitlement",metadata:{license_id:String(existingBase.license_id),license_product_key:product,base_binding_id:existingBase.id,reused_base:true,customer_id:customerId,source:"license_master"},source_order_status:String(order.status||order.payment_status||"")},{onConflict:"auth_user_id,order_item_id"});
          if(entitlementError)throw entitlementError;
          baseBindings.set(product,{...existingBase,components});
          results.push({product,orderItemId:item.id,licenseId:String(existingBase.license_id),reused:true,state:upserted.state});
          fulfilled++;
          continue;
        }

        const components={[product]:true};
        const result=await masterIssue({product_code:product,customer_external_id:customerNumber,external_reference:ref,components,metadata:{billingOrderId:String(id),orderNumber:String(order.order_number||""),orderItemId:String(item.id),customerId,customerNumber,licenseProductKey:product,quantity:Number(item.quantity||1),source:"v2_billing_store"}});
        const licenseId=String(result?.id||result?.license_id||result?.licence?.id||result?.license?.id||result?.binding?.id||"");
        const licenseKey=String(result?.license_key||result?.licenseKey||result?.licenceKey||result?.key||result?.licence?.licenseKey||"");
        const alreadyIssued=Boolean(result?.already_issued||result?.license?.already_issued||result?.licence?.already_issued);
        if(!licenseId)throw new Error("License Manager did not return a licence/binding id");
        if(!licenseKey&&!alreadyIssued)throw new Error("License Manager returned a licence ID without the one-time licence key");
        if(!licenseKey&&alreadyIssued){const {data:priorDelivery,error:deliveryLookupError}=await db.from("license_key_deliveries").select("id").eq("license_id",licenseId).limit(1).maybeSingle();if(deliveryLookupError)throw deliveryLookupError;if(!priorDelivery)throw new Error("License Manager reused an existing licence, but Billing Store has no prior key-delivery record. Rotate the licence key before completing fulfilment.");}
        const now=new Date().toISOString(),remoteState=String(result?.storage_status||result?.licence?.storage_status||result?.license?.storage_status||result?.binding?.storage_status||result?.status||result?.licence?.status||result?.license?.status||result?.binding?.status||"active");
        const {data:upserted,error:upsertError}=await db.from("license_fulfillments").upsert({id:existing?.id,order_id:id,order_item_id:item.id,auth_user_id:order.auth_user_id,license_id:licenseId,state:"fulfilled",attempt_count:Number(existing?.attempt_count||0)+1,last_error:null,fulfilled_at:now,metadata:{...(existing?.metadata||{}),license_product_key:product,customer_number:customerNumber,customer_id:customerId,master_response:{id:licenseId,status:remoteState,license_key_last4:licenseKey?licenseKey.slice(-4):null,idempotent:Boolean(result?.idempotent)}}},{onConflict:"order_item_id"}).select("id,license_id,state,fulfilled_at").single();
        if(upsertError)throw upsertError;
        const bindingPayload={order_id:id,order_item_id:item.id,auth_user_id:order.auth_user_id,fulfillment_id:upserted.id,license_id:licenseId,license_product_key:product,desired_state:"active",remote_state:remoteState,components,license_key_last4:licenseKey?licenseKey.slice(-4):null,label:String(item.product_name||product),api_source:"license_master",admin_override:false,updated_at:now};
        const {data:binding}=await db.from("license_bindings").select("id").eq("order_item_id",item.id).maybeSingle();
        let bindingWrite:any=null;
        for(let attempt=1;attempt<=3;attempt++){
          bindingWrite=binding?.id?await db.from("license_bindings").update(bindingPayload).eq("id",binding.id):await db.from("license_bindings").insert(bindingPayload);
          if(!bindingWrite.error)break;
          if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*300));
        }
        if(bindingWrite?.error)throw bindingWrite.error;
        const {data:newBaseBinding}=await db.from("license_bindings").select("id,license_id,license_product_key,components,fulfillment_id,order_id,order_item_id,desired_state,remote_state,license_key_last4,label,api_source").eq("order_item_id",item.id).maybeSingle();
        if(newBaseBinding)baseBindings.set(product,newBaseBinding);
        const {error:entitlementError}=await db.from("download_entitlements").upsert({auth_user_id:order.auth_user_id,order_id:id,order_item_id:item.id,product_id:item.product_id,status:"active",granted_at:now,revoked_at:null,reason:"License Manager provisioning",metadata:{license_id:licenseId,license_product_key:product,customer_id:customerId,source:"license_master"},source_order_status:String(order.status||order.payment_status||"")},{onConflict:"auth_user_id,order_item_id"});
        if(entitlementError)throw entitlementError;

        let keyDelivery:any=null;
        if(licenseKey&&!alreadyIssued){
          try{
            if(!customer?.email)throw new Error("Customer email is missing; one-time licence-key email was not sent");
            keyDelivery=await deliverInitialLicenseKey({authUserId:String(order.auth_user_id),orderId:id,licenseId,licenseKey,recipient:String(customer.email),customerName:customer.name||null});
          }catch(deliveryError:any){
            keyDelivery={ok:false,error:String(deliveryError?.message||"Licence-key delivery failed")};
          }
        }

        results.push({product,orderItemId:item.id,licenseId,state:upserted.state,reused:alreadyIssued,keyDelivery});
        fulfilled++;
        continue;
      }

      throw new Error("Unsupported licence strategy for product "+product);
    }catch(error:any){failed++;await db.from("license_fulfillments").upsert({id:existing?.id,order_id:id,order_item_id:item.id,auth_user_id:order.auth_user_id,state:"failed",attempt_count:Number(existing?.attempt_count||0)+1,last_error:String(error?.message||"License fulfilment failed").slice(0,1000),metadata:{...(existing?.metadata||{}),license_product_key:product,customer_number:customerNumber,customer_id:customerId}},{onConflict:"order_item_id"});results.push({product,orderItemId:item.id,state:"failed",error:String(error?.message||"License fulfilment failed")})}
  }
  const nextFulfillment=failed?"partial":fulfilled?"fulfilled":"pending";
  await db.from("orders").update({fulfillment_status:nextFulfillment,service_status:failed?"provisioning_error":"active",activated_at:fulfilled?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq("id",id);
  const licenseIssued=results.filter((result:any)=>Boolean(result.licenseId)).length;
  return {ok:failed===0&&licenseIssued>0,orderId:id,customerId,customerNumber,fulfilled,licenseIssued,failed,fulfillmentStatus:nextFulfillment,results};
}