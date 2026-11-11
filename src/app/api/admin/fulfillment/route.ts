import {createClient as createSupabaseClient} from "@supabase/supabase-js";
import {licenseDb} from "@/lib/license-api";
import {masterLicenses,masterProducts} from "@/lib/master-api";
import {syncPaidOrderToLicenseMaster} from "@/lib/license-master-sync";
import {canonicalLicenseStatus,isCanonicalLicenseUsable} from "@/lib/license-status";

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const SUPABASE_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
const canonical=(v:any)=>({orbitfs_panel:"orbitfs_base",orbitfs_sorter:"orbitfs_apex"} as Record<string,string>)[String(v||"").toLowerCase()]||String(v||"").toLowerCase();
const licenseId=(x:any)=>String(x?.id||x?.license_id||x?.licenseId||"").trim();

async function staff(req:Request){
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
 if(!token||!SUPABASE_URL||!SUPABASE_KEY)return null;
 const sb=createSupabaseClient(SUPABASE_URL,SUPABASE_KEY,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error}=await sb.auth.getUser(token);if(error||!user)return null;
 const {data}=await sb.rpc("get_my_staff_access");const row=Array.isArray(data)?data[0]:data,p=row?.permissions;
 const ok=p?.all===true||(Array.isArray(p)?p.includes("licenses.manage")||p.includes("license_api.manage"):Boolean(p?.["licenses.manage"]||p?.["license_api.manage"]));
 return ok?{user,sb}:null;
}

function authoritativeComponents(license:any){
 const raw=license?.components||license?.metadata?.license_policy?.components||{};
 return raw&&typeof raw==="object"&&!Array.isArray(raw)?raw:{};
}
function componentEnabled(components:any,key:string){const value=components?.[key];return value===true||value==="active"||value?.enabled===true||String(value?.status||"").toLowerCase()==="active";}
const productCodeOf=(product:any)=>String(product?.code||product?.product_code||product?.slug||"").trim().toLowerCase();

async function buildQueue(){
 const db=licenseDb();
 const {data:fulfillments,error}=await db.from("license_fulfillments").select("*").order("updated_at",{ascending:false}).limit(300);
 if(error)throw error;
 const rows=fulfillments||[];
 const orderIds=[...new Set(rows.map((x:any)=>String(x.order_id)).filter(Boolean))];
 const itemIds=[...new Set(rows.map((x:any)=>String(x.order_item_id)).filter(Boolean))];
 const [ordersResult,itemsResult,customersResult,masterResult,productsResult]=await Promise.all([
  orderIds.length?db.from("orders").select("id,order_number,auth_user_id,status,payment_status,fulfillment_status,service_status,metadata,created_at").in("id",orderIds):Promise.resolve({data:[],error:null} as any),
  itemIds.length?db.from("order_items").select("id,order_id,product_id,product_name,license_product_key,quantity").in("id",itemIds):Promise.resolve({data:[],error:null} as any),
  db.from("customers").select("id,auth_user_id,user_id,customer_number,name,email"),
  masterLicenses().catch(()=>({licenses:[]})),
  masterProducts().catch(()=>({products:[]}))
 ]);
 if(ordersResult.error)throw ordersResult.error;if(itemsResult.error)throw itemsResult.error;if(customersResult.error)throw customersResult.error;
 const orders=new Map((ordersResult.data||[]).map((x:any)=>[String(x.id),x]));
 const items=new Map((itemsResult.data||[]).map((x:any)=>[String(x.id),x]));
 const customers=customersResult.data||[];
 const customerByUser=new Map(customers.flatMap((c:any)=>[c.auth_user_id,c.user_id].filter(Boolean).map((id:any)=>[String(id),c])));
 const master=Array.isArray((masterResult as any)?.licenses)?(masterResult as any).licenses:[];
 const products=Array.isArray((productsResult as any)?.products)?(productsResult as any).products:[];
 const productMap=new Map<string,any>(products.flatMap((p:any)=>[p.code,p.product_code,p.slug].map((value:any)=>String(value||"").trim().toLowerCase()).filter(Boolean).map((key:string)=>[key,p] as [string,any])));
 return rows.map((f:any)=>{
  const order:any=orders.get(String(f.order_id))||{};
  const item:any=items.get(String(f.order_item_id))||{};
  const customer:any=customerByUser.get(String(f.auth_user_id||order.auth_user_id))||{};
  const remote=master.find((x:any)=>licenseId(x)===String(f.license_id||""));
  const product=productMap.get(canonical(item.license_product_key||f.metadata?.license_product_key||""));
  const strategy=String(product?.validation_policy?.license_strategy||"standalone").trim().toLowerCase();
  const configuredBase=String(product?.validation_policy?.base_product_key||"").trim().toLowerCase();
  const baseRecord=productMap.get(configuredBase);
  const targetRecord=strategy==="component"?baseRecord:product;
  const targetKey=canonical(productCodeOf(targetRecord)||configuredBase||item.license_product_key||"");
  const manualLicenseKey=strategy==="standalone"?String(item.id||""):targetKey;
  return {...f,order,item,customer,remote,productRecord:product,productStrategy:strategy,baseProductKey:configuredBase,manualLicenseKey,manualLicenseProductKey:targetKey,manualLicenseProductName:String(targetRecord?.name||targetKey||item.product_name||"Product"),mode:f.metadata?.fulfillment_mode||f.metadata?.mode||null};
 });
}

export async function GET(req:Request){
 try{
  const actor=await staff(req);if(!actor)return Response.json({error:"License management permission required"},{status:403});
  const rows=await buildQueue();
  return Response.json({rows},{headers:{"cache-control":"no-store"}});
 }catch(e:any){return Response.json({error:e?.message||"Could not load fulfilment queue"},{status:e?.status||500});}
}

export async function POST(req:Request){
 try{
  const actor=await staff(req);if(!actor)return Response.json({error:"License management permission required"},{status:403});
  const body=await req.json().catch(()=>({}));
  const action=String(body.action||"").trim().toLowerCase();
  const db=licenseDb();

  if(action==="retry"){
   const orderId=String(body.orderId||"").trim();if(!orderId)return Response.json({error:"orderId is required"},{status:400});
   const result=await syncPaidOrderToLicenseMaster(orderId,{manual:true});
   return Response.json(result,{headers:{"cache-control":"no-store"}});
  }

  if(action==="sync-authority-links"){
   const [masterResult,customersResult,productsResult]=await Promise.all([
    masterLicenses(),
    db.from("customers").select("id,auth_user_id,user_id,customer_number,name,email"),
    masterProducts()
   ]);
   if(customersResult.error)throw customersResult.error;
   const customers=customersResult.data||[],master=Array.isArray(masterResult?.licenses)?masterResult.licenses:[];
   const products=Array.isArray(productsResult?.products)?productsResult.products:[];
   const registered=new Map<string,any>(products.flatMap((p:any)=>[p.code,p.product_code,p.slug]
    .map((value:any)=>String(value||"").trim().toLowerCase()).filter(Boolean).map((key:string)=>[key,p] as [string,any])));
   const byNumber=new Map(customers.filter((c:any)=>c.customer_number).map((c:any)=>[String(c.customer_number).toLowerCase(),c]));
   const results:any[]=[];
   for(const remote of master){
    const id=licenseId(remote),product=canonical(remote.product_code||remote.product||"");
    if(!id||!product||!registered.has(product)||["terminated","expired"].includes(canonicalLicenseStatus(remote)))continue;
    const registeredProduct=registered.get(product);
    const strategy=String(registeredProduct?.validation_policy?.license_strategy||"standalone").toLowerCase();
    if(!["standalone","base"].includes(strategy))continue;
    const customer=byNumber.get(String(remote.customer_external_id||"").toLowerCase()) as any;
    if(!customer)continue;
    const userId=String(customer.auth_user_id||customer.user_id||"");if(!userId)continue;
    const components=authoritativeComponents(remote),now=new Date().toISOString();
    const owner=await db.from("license_bindings").select("id,auth_user_id").eq("license_id",id).is("archived_at",null).limit(1).maybeSingle();
    if(owner.error)throw owner.error;
    const storageState=String(remote.storage_status||remote.status||"active").toLowerCase();
    const payload:any={auth_user_id:userId,license_id:id,license_product_key:product,desired_state:storageState,remote_state:storageState,components,license_key_last4:remote.license_key_last4||null,expires_at:remote.expires_at||null,label:remote.product_name||remote.product||product,api_source:"license_master",admin_override:remote.customer_override===true,last_sync_error:null,last_synced_at:now,updated_at:now};
    let bindingId=owner.data?.id||null;
    if(bindingId){
      const write=await db.from("license_bindings").update(payload).eq("id",bindingId);if(write.error)throw write.error;
      if(product==="orbitfs_base"&&String(owner.data?.auth_user_id||"")!==userId){const moved=await db.from("orbitfs_installations").update({auth_user_id:userId,updated_at:now}).eq("license_binding_id",bindingId);if(moved.error)throw moved.error;}
    }else{
      const write=await db.from("license_bindings").insert(payload).select("id").single();if(write.error)throw write.error;bindingId=write.data?.id||null;
    }
    results.push({licenseId:id,product,bindingId,customerId:customer.id,customerNumber:customer.customer_number,components});
   }
   return Response.json({ok:true,synced:results.length,results});
  }

  if(action==="link-manual"){
   const orderId=String(body.orderId||"").trim();
   const suppliedIds=body.licenseIds&&typeof body.licenseIds==="object"&&!Array.isArray(body.licenseIds)?body.licenseIds:{};
   const legacyId=String(body.licenseId||"").trim();
   if(!orderId)return Response.json({error:"orderId is required"},{status:400});
   const [orderResult,itemsResult,masterResult,productsResult]=await Promise.all([
    db.from("orders").select("id,order_number,auth_user_id,status,payment_status,metadata").eq("id",orderId).maybeSingle(),
    db.from("order_items").select("id,product_id,product_name,license_product_key,quantity,configuration").eq("order_id",orderId).order("id"),
    masterLicenses(),masterProducts()
   ]);
   if(orderResult.error)throw orderResult.error;if(itemsResult.error)throw itemsResult.error;
   const order=orderResult.data;if(!order)return Response.json({error:"Order not found"},{status:404});
   if(String(order.payment_status||"").toLowerCase()!=="paid"||String(order.status||"").toLowerCase()!=="active")return Response.json({error:"Only paid active orders can be fulfilled"},{status:409});
   const {data:customer,error:customerError}=await db.from("customers").select("id,auth_user_id,user_id,customer_number,name,email").or("auth_user_id.eq."+order.auth_user_id+",user_id.eq."+order.auth_user_id).maybeSingle();
   if(customerError)throw customerError;if(!customer?.customer_number)return Response.json({error:"Billing customer number is missing"},{status:409});
   const master=Array.isArray(masterResult?.licenses)?masterResult.licenses:[],products=Array.isArray(productsResult?.products)?productsResult.products:[];
   const productMap=new Map<string,any>(products.flatMap((p:any)=>[p.code,p.product_code,p.slug].map((v:any)=>String(v||"").trim().toLowerCase()).filter(Boolean).map((key:string)=>[key,p] as [string,any])));
   const items=(itemsResult.data||[]).filter((item:any)=>item.configuration?.gift!==true);
   if(!items.length)return Response.json({error:"This order has no licence products to fulfil"},{status:409});
   const strategies=items.map((item:any)=>{
    const product=canonical(item.license_product_key),record=productMap.get(product);
    if(!record)return {item,product,strategy:"unregistered"};
    const strategy=String(record.validation_policy?.license_strategy||"standalone").trim().toLowerCase();
    const configuredBase=String(record.validation_policy?.base_product_key||"").trim().toLowerCase(),baseRecord=configuredBase?productMap.get(configuredBase):null;
    if(strategy==="component"&&(!configuredBase||!baseRecord||String(baseRecord.validation_policy?.license_strategy||"").toLowerCase()!=="base"))return {item,product,strategy,invalidPolicy:true};
    if(!["standalone","base","component"].includes(strategy))return {item,product,strategy,invalidPolicy:true};
    const targetRecord=strategy==="component"?baseRecord:record,targetProduct=canonical(productCodeOf(targetRecord)||"");
    const manualKey=strategy==="standalone"?String(item.id):targetProduct;
    const componentKey=String(record.componentKey||record.component_key||record.validation_policy?.component_key||product).trim().toLowerCase();
    return {item,product,record,strategy,configuredBase,targetProduct,manualKey,componentKey,manualLicenseProductName:String(targetRecord?.name||targetProduct||product)};
   });
   if(strategies.some((x:any)=>x.strategy==="unregistered"))return Response.json({error:"One or more purchased products are not registered in License Manager"},{status:409});
   if(strategies.some((x:any)=>x.invalidPolicy))return Response.json({error:"A purchased product has an invalid licence strategy or missing base_product_key policy"},{status:409});
   const requiredKeys=[...new Set(strategies.map((x:any)=>x.manualKey).filter(Boolean))];
   const selected=strategies.map((x:any)=>({...x,selectedId:String(suppliedIds[x.manualKey]||suppliedIds[x.item.id]||suppliedIds[x.targetProduct]||(requiredKeys.length===1?legacyId:"")).trim()}));
   const missing=selected.filter((x:any)=>!x.selectedId).map((x:any)=>({key:x.manualKey,product:x.manualLicenseProductName||x.targetProduct||x.product}));
   if(missing.length)return Response.json({error:"Enter a matching License Manager licence ID for every required product licence.",requiredLicences:requiredKeys,missing},{status:400});
   const userId=String(customer.auth_user_id||customer.user_id||order.auth_user_id),now=new Date().toISOString();
   const bindingByLicenseId=new Map<string,any>(),selectedByKey=new Map<string,any>();
   for(const entry of selected){
    const remote=master.find((x:any)=>licenseId(x)===entry.selectedId);
    if(!remote)return Response.json({error:"License Manager licence not found: "+entry.selectedId},{status:404});
    if(String(remote.customer_external_id||"").toLowerCase()!==String(customer.customer_number).toLowerCase())return Response.json({error:"Licence customer ID does not match this Billing customer. Transfer/edit it in License Manager first."},{status:409});
    if(!isCanonicalLicenseUsable(remote))return Response.json({error:"Only an Active or Locked licence can fulfil an order"},{status:409});
    const remoteProduct=canonical(remote.product_code||remote.product||remote.license_product_key||"");
    if(remoteProduct!==entry.targetProduct)return Response.json({error:"Selected licence "+entry.selectedId+" is for "+remoteProduct+", not "+entry.targetProduct},{status:409});
    const components=authoritativeComponents(remote);
    if(entry.strategy==="component"&&!componentEnabled(components,entry.componentKey))return Response.json({error:"The selected base licence does not contain component entitlement "+entry.componentKey},{status:409});
    const prior=selectedByKey.get(entry.manualKey);
    if(prior&&prior.selectedId!==entry.selectedId)return Response.json({error:"The same base product family must use one licence ID for its component entitlements."},{status:409});
    selectedByKey.set(entry.manualKey,entry);
    if(!bindingByLicenseId.has(entry.selectedId)){
     const owner=await db.from("license_bindings").select("id,auth_user_id,license_product_key").eq("license_id",entry.selectedId).is("archived_at",null).limit(1).maybeSingle();
     if(owner.error)throw owner.error;
     if(owner.data&&String(owner.data.auth_user_id)!==userId)return Response.json({error:"This License Manager licence is already linked to another customer."},{status:409});
     if(owner.data?.license_product_key&&canonical(owner.data.license_product_key)!==entry.targetProduct)return Response.json({error:"This licence is already linked to a different product."},{status:409});
     const baseItem=items.find((item:any)=>canonical(item.license_product_key)===entry.targetProduct&&String(productMap.get(canonical(item.license_product_key))?.validation_policy?.license_strategy||"").toLowerCase()==="base");
     const payload:any={auth_user_id:userId,order_id:orderId,license_id:entry.selectedId,license_product_key:entry.targetProduct,desired_state:String(remote.storage_status||remote.status||"active").toLowerCase(),remote_state:String(remote.storage_status||remote.status||"active").toLowerCase(),components,license_key_last4:remote.license_key_last4||null,expires_at:remote.expires_at||null,label:remote.product_name||remote.product||entry.targetProduct,api_source:"license_master",admin_override:remote.customer_override===true,last_sync_error:null,last_synced_at:now,updated_at:now};
     if(baseItem?.id)payload.order_item_id=baseItem.id;else if(entry.strategy==="standalone")payload.order_item_id=entry.item.id;
     const write=owner.data?.id?await db.from("license_bindings").update(payload).eq("id",owner.data.id):await db.from("license_bindings").insert(payload).select("id").single();
     if(write.error)throw write.error;
     bindingByLicenseId.set(entry.selectedId,{id:owner.data?.id||write.data?.id||null,license_id:entry.selectedId,license_product_key:entry.targetProduct,components});
    }
   }
   for(const entry of selected){
    const binding=bindingByLicenseId.get(entry.selectedId),attachedToBase=entry.strategy==="component";
    const fulfillment=await db.from("license_fulfillments").upsert({order_id:orderId,order_item_id:entry.item.id,auth_user_id:userId,license_id:entry.selectedId,state:"fulfilled",attempt_count:1,last_error:null,fulfilled_at:now,metadata:{license_product_key:entry.product,base_product_key:attachedToBase?entry.targetProduct:null,component_key:attachedToBase?entry.componentKey:null,authority:"license_master",fulfillment_mode:"manual",manual_linked:true,base_binding_id:binding?.id||null,attached_to_base:attachedToBase,linked_by:actor.user.id}},{onConflict:"order_item_id"});
    if(fulfillment.error)throw fulfillment.error;
    const entitlement=await db.from("download_entitlements").upsert({auth_user_id:userId,order_id:orderId,order_item_id:entry.item.id,product_id:entry.item.product_id,status:"active",granted_at:now,revoked_at:null,reason:"Manual License Manager fulfilment",metadata:{license_id:entry.selectedId,license_product_key:entry.product,base_product_key:attachedToBase?entry.targetProduct:null,component_key:attachedToBase?entry.componentKey:null,base_binding_id:binding?.id||null,attached_to_base:attachedToBase,source:"license_master",fulfillment_mode:"manual"},source_order_status:String(order.status||order.payment_status||"")},{onConflict:"auth_user_id,order_item_id"});
    if(entitlement.error)throw entitlement.error;
   }
   const licenseMap=Object.fromEntries([...selectedByKey.entries()].map(([key,value])=>[key,value.selectedId]));
   const orderWrite=await db.from("orders").update({fulfillment_status:"fulfilled",service_status:"active",activated_at:now,metadata:{...(order.metadata||{}),fulfillment_mode:"manual",manual_license_ids:licenseMap,manual_fulfilled_at:now},updated_at:now}).eq("id",orderId);
   if(orderWrite.error)throw orderWrite.error;
   return Response.json({ok:true,orderId,licenseIds:licenseMap,products:strategies.map((x:any)=>x.product),fulfilled:true});
  }

  return Response.json({error:"Unsupported fulfilment action"},{status:400});
 }catch(e:any){return Response.json({error:e?.message||"Fulfilment action failed"},{status:e?.status||500,headers:{"cache-control":"no-store"}});}
}
