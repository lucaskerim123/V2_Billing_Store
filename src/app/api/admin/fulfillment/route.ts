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

async function buildQueue(){
 const db=licenseDb();
 const {data:fulfillments,error}=await db.from("license_fulfillments").select("*").order("updated_at",{ascending:false}).limit(300);
 if(error)throw error;
 const rows=fulfillments||[];
 const orderIds=[...new Set(rows.map((x:any)=>String(x.order_id)).filter(Boolean))];
 const itemIds=[...new Set(rows.map((x:any)=>String(x.order_item_id)).filter(Boolean))];
 const [ordersResult,itemsResult,customersResult,masterResult]=await Promise.all([
  orderIds.length?db.from("orders").select("id,order_number,auth_user_id,status,payment_status,fulfillment_status,service_status,metadata,created_at").in("id",orderIds):Promise.resolve({data:[],error:null} as any),
  itemIds.length?db.from("order_items").select("id,order_id,product_id,product_name,license_product_key,quantity").in("id",itemIds):Promise.resolve({data:[],error:null} as any),
  db.from("customers").select("id,auth_user_id,user_id,customer_number,name,email"),
  masterLicenses().catch(()=>({licenses:[]}))
 ]);
 if(ordersResult.error)throw ordersResult.error;if(itemsResult.error)throw itemsResult.error;if(customersResult.error)throw customersResult.error;
 const orders=new Map((ordersResult.data||[]).map((x:any)=>[String(x.id),x]));
 const items=new Map((itemsResult.data||[]).map((x:any)=>[String(x.id),x]));
 const customers=customersResult.data||[];
 const customerByUser=new Map(customers.flatMap((c:any)=>[c.auth_user_id,c.user_id].filter(Boolean).map((id:any)=>[String(id),c])));
 const master=Array.isArray((masterResult as any)?.licenses)?(masterResult as any).licenses:[];
 return rows.map((f:any)=>{
  const order:any=orders.get(String(f.order_id))||{};
  const item:any=items.get(String(f.order_item_id))||{};
  const customer:any=customerByUser.get(String(f.auth_user_id||order.auth_user_id))||{};
  const remote=master.find((x:any)=>licenseId(x)===String(f.license_id||""));
  return {...f,order,item,customer,remote,mode:f.metadata?.fulfillment_mode||f.metadata?.mode||null};
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
   const orderId=String(body.orderId||"").trim(),wanted=String(body.licenseId||"").trim();
   if(!orderId||!wanted)return Response.json({error:"orderId and licenseId are required"},{status:400});
   const [orderResult,itemsResult,masterResult,productsResult]=await Promise.all([
    db.from("orders").select("id,order_number,auth_user_id,status,payment_status,metadata").eq("id",orderId).maybeSingle(),
    db.from("order_items").select("id,product_id,product_name,license_product_key,quantity,configuration").eq("order_id",orderId).order("id"),
    masterLicenses(),
    masterProducts()
   ]);
   if(orderResult.error)throw orderResult.error;if(itemsResult.error)throw itemsResult.error;
   const order=orderResult.data;if(!order)return Response.json({error:"Order not found"},{status:404});
   if(String(order.payment_status||"").toLowerCase()!=="paid"||String(order.status||"").toLowerCase()!=="active")return Response.json({error:"Only paid active orders can be fulfilled"},{status:409});
   const {data:customer,error:ce}=await db.from("customers").select("id,auth_user_id,user_id,customer_number,name,email").or("auth_user_id.eq."+order.auth_user_id+",user_id.eq."+order.auth_user_id).maybeSingle();
   if(ce)throw ce;if(!customer?.customer_number)return Response.json({error:"Billing customer number is missing"},{status:409});
   const master=Array.isArray(masterResult?.licenses)?masterResult.licenses:[],remote=master.find((x:any)=>licenseId(x)===wanted);
   if(!remote)return Response.json({error:"License Manager licence not found"},{status:404});
   if(String(remote.customer_external_id||"").toLowerCase()!==String(customer.customer_number).toLowerCase())return Response.json({error:"Licence customer ID does not match this Billing customer. Transfer/edit it in License Manager first."},{status:409});
   if(!isCanonicalLicenseUsable(remote))return Response.json({error:"Only an Active or Locked licence can fulfil an order"},{status:409});
   const products=Array.isArray(productsResult?.products)?productsResult.products:[];
   const productMap=new Map<string,any>(products.flatMap((p:any)=>[p.code,p.product_code,p.slug]
    .map((value:any)=>String(value||"").trim().toLowerCase()).filter(Boolean).map((key:string)=>[key,p] as [string,any])));
   const items=(itemsResult.data||[]).filter((item:any)=>item.configuration?.gift!==true);
   if(!items.length)return Response.json({error:"This order has no licence products to fulfil"},{status:409});
   const remoteProduct=canonical(remote.product_code||remote.product||"");
   const strategies=items.map((item:any)=>{
    const product=canonical(item.license_product_key),record=productMap.get(product);
    if(!record)return {item,product,strategy:"unregistered",baseProductCode:""};
    const strategy=String(record.validation_policy?.license_strategy||"standalone");
    const configuredBase=canonical(record.validation_policy?.base_product_key||"");
    const baseRecord=productMap.get(configuredBase);
    const baseProductCode=canonical(baseRecord?.code||baseRecord?.product_code||baseRecord?.slug||configuredBase);
    return {item,product,strategy,baseProductCode};
   });
   if(strategies.some((entry:any)=>entry.strategy==="unregistered"))return Response.json({error:"One or more purchased products are not registered in License Manager"},{status:409});
   const expectedRemoteProducts=[...new Set(strategies.map((entry:any)=>entry.strategy==="component"?entry.baseProductCode:entry.product))];
   if(expectedRemoteProducts.length!==1||!expectedRemoteProducts[0]||remoteProduct!==expectedRemoteProducts[0]){
    return Response.json({error:"The selected licence does not match the purchased product policy. A single manual licence can only fulfil products covered by that same licence."},{status:409});
   }
   const components=authoritativeComponents(remote);
   const missingComponents=strategies.filter((entry:any)=>entry.strategy==="component"&&!components[entry.product]).map((entry:any)=>entry.product);
   if(missingComponents.length)return Response.json({error:"The selected licence is missing purchased components: "+missingComponents.join(", "),missingComponents},{status:409});
   const userId=String(customer.auth_user_id||customer.user_id||order.auth_user_id),now=new Date().toISOString();
   const owner=await db.from("license_bindings").select("id,auth_user_id").eq("license_id",wanted).is("archived_at",null).limit(1).maybeSingle();if(owner.error)throw owner.error;
   let bindingId=owner.data?.id||null;
   const storageState=String(remote.storage_status||remote.status||"active").toLowerCase();
   const bindingPayload:any={auth_user_id:userId,license_id:wanted,license_product_key:remoteProduct,desired_state:storageState,remote_state:storageState,components,license_key_last4:remote.license_key_last4||null,expires_at:remote.expires_at||null,label:remote.product_name||remote.product||remoteProduct,api_source:"license_master",admin_override:remote.customer_override===true,last_sync_error:null,last_synced_at:now,updated_at:now};
   if(bindingId){
    const w=await db.from("license_bindings").update(bindingPayload).eq("id",bindingId);if(w.error)throw w.error;
    if(remoteProduct==="orbitfs_base"&&String(owner.data?.auth_user_id||"")!==userId){const moved=await db.from("orbitfs_installations").update({auth_user_id:userId,updated_at:now}).eq("license_binding_id",bindingId);if(moved.error)throw moved.error;}
   }else{
    const w=await db.from("license_bindings").insert(bindingPayload).select("id").single();if(w.error)throw w.error;bindingId=w.data?.id||null;
   }
   for(const entry of strategies){
    const product=entry.product,item=entry.item,attachedToBase=entry.strategy==="component";
    const fulfillment=await db.from("license_fulfillments").upsert({order_id:orderId,order_item_id:item.id,auth_user_id:userId,license_id:wanted,state:"fulfilled",attempt_count:1,last_error:null,fulfilled_at:now,metadata:{license_product_key:product,authority:"license_master",fulfillment_mode:"manual",manual_linked:true,base_binding_id:bindingId,attached_to_base:attachedToBase,linked_by:actor.user.id}},{onConflict:"order_item_id"});
    if(fulfillment.error)throw fulfillment.error;
    const entitlement=await db.from("download_entitlements").upsert({auth_user_id:userId,order_id:orderId,order_item_id:item.id,product_id:item.product_id,status:"active",granted_at:now,revoked_at:null,reason:"Manual License Manager fulfilment",metadata:{license_id:wanted,license_product_key:product,base_binding_id:bindingId,attached_to_base:attachedToBase,source:"license_master",fulfillment_mode:"manual"},source_order_status:String(order.status||order.payment_status||"")},{onConflict:"auth_user_id,order_item_id"});
    if(entitlement.error)throw entitlement.error;
   }
   const ow=await db.from("orders").update({fulfillment_status:"fulfilled",service_status:"active",activated_at:now,metadata:{...(order.metadata||{}),fulfillment_mode:"manual",manual_license_id:wanted,manual_fulfilled_at:now},updated_at:now}).eq("id",orderId);if(ow.error)throw ow.error;
   return Response.json({ok:true,orderId,licenseId:wanted,bindingId,products:strategies.map((entry:any)=>entry.product),components,fulfilled:true});
  }

  return Response.json({error:"Unsupported fulfilment action"},{status:400});
 }catch(e:any){return Response.json({error:e?.message||"Fulfilment action failed"},{status:e?.status||500,headers:{"cache-control":"no-store"}});}
}
