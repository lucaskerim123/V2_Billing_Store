import {createClient} from "@supabase/supabase-js";
import {masterControl,masterIssue,masterLicenses} from "@/lib/master-api";
import {licenseDb} from "@/lib/license-api";

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const SUPABASE_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";

async function staff(req:Request){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token||!SUPABASE_URL||!SUPABASE_KEY)return null;
  const sb=createClient(SUPABASE_URL,SUPABASE_KEY,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await sb.auth.getUser(token);if(error||!user)return null;
  const {data}=await sb.rpc("get_my_staff_access");const row=Array.isArray(data)?data[0]:data,p=row?.permissions;
  const ok=p?.all===true||(Array.isArray(p)?["licenses.manage","license_api.manage","orders.activate","orders.override_payment","orders.view"].some(key=>p.includes(key)):Boolean(p?.["licenses.manage"]||p?.["license_api.manage"]||p?.["orders.activate"]||p?.["orders.override_payment"]||p?.["orders.view"]));
  return ok&&row?{user,sb,permissions:p}:null;
}

export async function GET(req:Request){
  try{
    const actor=await staff(req);if(!actor)return Response.json({error:"License management permission required"},{status:403});
    const url=new URL(req.url),orderId=String(url.searchParams.get("orderId")||"").trim(),orderIds=[...new Set(String(url.searchParams.get("orderIds")||"").split(",").map(x=>x.trim()).filter(Boolean))];
    const ids=orderId?[orderId]:orderIds;if(!ids.length||ids.length>100)return Response.json({error:"orderId or up to 100 orderIds is required"},{status:400});
    const {data:orders,error:orderError}=await actor.sb.from("orders").select("id").in("id",ids);
    if(orderError)throw orderError;if((orders||[]).length!==ids.length)return Response.json({error:"One or more orders were not found"},{status:404});
    const {data:bindings,error:bindingError}=await licenseDb().from("license_bindings").select("id,order_id,order_item_id,license_id,license_product_key,remote_state,desired_state,archived_at,last_synced_at,last_sync_error").in("order_id",ids).is("archived_at",null).order("created_at",{ascending:false});
    if(bindingError)throw bindingError;
    let masterRows:any[]=[];let masterReadError:string|null=null;try{const snapshot=await masterLicenses();masterRows=Array.isArray(snapshot?.licenses)?snapshot.licenses:[]}catch(error:any){masterReadError=String(error?.message||"License Manager status request failed")}
    const checkedAt=new Date().toISOString();
    const result=(bindings||[]).map((binding:any)=>{const license=masterRows.find((row:any)=>String(row.id||row.license_id||"")===String(binding.license_id||""));const masterStatus=String(license?.canonical_status||license?.effective_status||license?.status||"").trim().toLowerCase();return {order_id:binding.order_id,order_item_id:binding.order_item_id,license_id:binding.license_id,product:binding.license_product_key,status:masterStatus||String(binding.remote_state||binding.desired_state||"unknown").toLowerCase(),status_source:masterStatus?"license_manager":"last_confirmed_binding",checked_at:checkedAt,last_synced_at:binding.last_synced_at,last_sync_error:binding.last_sync_error,archived_at:binding.archived_at}});
    const orderStates=ids.map(id=>{const rows=result.filter((binding:any)=>binding.order_id===id);const statuses=rows.map((binding:any)=>binding.status);const status=statuses.length&&statuses.every((value:string)=>value==="active")?"active":statuses.includes("suspended")||statuses.includes("restricted")?"suspended":statuses.length&&statuses.every((value:string)=>["revoked","terminated","expired"].includes(value))?"terminated":statuses.includes("active")?"partial":"pending";return {order_id:id,status,binding_count:rows.length,checked_at:checkedAt}});
    return Response.json({ok:true,orderId:orderId||null,bindings:result,orders:orderStates,masterReadError},{headers:{"cache-control":"no-store"}});
  }catch(e:any){return Response.json({error:e?.message||"Could not read License Manager order status"},{status:e?.status||502,headers:{"cache-control":"no-store"}})}
}

export async function POST(req:Request){
  try{
    const actor=await staff(req);if(!actor)return Response.json({error:"License management permission required"},{status:403});
    const body=await req.json().catch(()=>({}));
    const orderId=String(body.orderId||body.order_id||"").trim();
    const action=String(body.action||"").trim().toLowerCase();
    if(!orderId)return Response.json({error:"orderId is required"},{status:400});
    if(!["activate","fulfill","reprovision","suspend","unsuspend","terminate"].includes(action))return Response.json({error:"Unsupported order license action"},{status:400});
    const permission=(key:string)=>actor.permissions?.all===true||(Array.isArray(actor.permissions)?actor.permissions.includes(key):Boolean(actor.permissions?.[key]));
    const allowed=action==="activate"
      ?permission("licenses.manage")||permission("license_api.manage")||permission("orders.activate")||permission("orders.override_payment")
      :action==="fulfill"
        ?permission("licenses.manage")||permission("license_api.manage")||permission("orders.activate")
        :permission("licenses.manage")||permission("license_api.manage");
    if(!allowed)return Response.json({error:action==="activate"?"Order activation permission required":"License management permission required"},{status:403});

    const {data:order,error:oe}=await actor.sb.from("orders").select("id,auth_user_id,order_number").eq("id",orderId).maybeSingle();
    if(oe)throw oe;if(!order)return Response.json({error:"Order not found"},{status:404});
    const {data:customer,error:ce}=await actor.sb.from("customers").select("id,customer_number").or("auth_user_id.eq."+order.auth_user_id+",user_id.eq."+order.auth_user_id).maybeSingle();
    if(ce)throw ce;
    const customerNumber=String(customer?.customer_number||"").trim();

    const {data:bindings,error:be}=await licenseDb().from("license_bindings").select("*").eq("order_id",orderId).order("created_at",{ascending:false});
    if(be)throw be;
    const {data:items,error:ie}=await actor.sb.from("order_items").select("id,product_name,license_product_key").eq("order_id",orderId).order("id");
    if(ie)throw ie;

    if(action==="fulfill"){
      const {syncPaidOrderToLicenseMaster}=await import("@/lib/license-master-sync");
      const result=await syncPaidOrderToLicenseMaster(orderId,{manual:true});
      return Response.json({ok:result?.ok!==false,orderId,action,fulfillment:result,error:result?.ok===false?"License Manager did not confirm fulfilment.":undefined},{status:result?.ok===false?502:200,headers:{"cache-control":"no-store"}});
    }
    if(!customerNumber)return Response.json({error:"Customer number is missing for this order"},{status:409});

    // Approval may create a pending fulfillment before any license binding exists.
    // Issue the purchased product through the same License Manager API used by OrbitFS.
    if(action==="activate"){
      const {syncPaidOrderToLicenseMaster}=await import("@/lib/license-master-sync");
      const result=await syncPaidOrderToLicenseMaster(orderId,{manual:false});
      if(result?.skipped&&["already_fulfilled","manual_fulfillment_queue","fulfillment_on_hold"].includes(result.reason)){
        return Response.json({ok:true,orderId,action,results:[],fulfillment:result},{headers:{"cache-control":"no-store"}});
      }
      if(result?.skipped){
        return Response.json({ok:false,orderId,action,results:[],failures:[{error:`License was not issued: ${String(result.reason||"fulfillment skipped")}`}],fulfillment:result},{status:503,headers:{"cache-control":"no-store"}});
      }
      if(result?.ok!==true||Number(result?.licenseIssued||0)<1||Number(result?.failed||0)>0){
        return Response.json({ok:false,orderId,action,results:result?.results||[],failures:[{error:"License Manager did not confirm successful product fulfilment."}],fulfillment:result},{status:502,headers:{"cache-control":"no-store"}});
      }
      return Response.json({ok:true,orderId,action,results:result.results||[],fulfillment:result},{headers:{"cache-control":"no-store"}});
    }

    const masterSnapshot=await masterLicenses();
    const masterRows=Array.isArray(masterSnapshot?.licenses)?masterSnapshot.licenses:[];
    const results:any[]=[];const failures:any[]=[];
    for(const binding of bindings||[]){
      const licenseId=String(binding.license_id||"").trim();
      try{
        let remote:any;
        const currentMaster=licenseId?masterRows.find((x:any)=>String(x.id||x.license_id||"")===licenseId):null;
        const authoritativeState=String(currentMaster?.canonical_status||currentMaster?.effective_status||currentMaster?.status||"").trim().toLowerCase();
        const shouldIssue=action==="reprovision" || (action==="activate" && (!licenseId || authoritativeState==="terminated" || authoritativeState==="revoked" || authoritativeState==="expired"));
        if(shouldIssue){
          const product=String(binding.license_product_key||"").trim().toLowerCase();
          if(!product)throw new Error("License binding has no product key");
          const item=(items||[]).find((x:any)=>String(x.id)===String(binding.order_item_id))||(items||[]).find((x:any)=>String(x.license_product_key||"").toLowerCase()===product);
          remote=await masterIssue({product,customer_external_id:customerNumber,external_reference:String(orderId)+":"+String(item?.id||binding.order_item_id||binding.id),metadata:{billingOrderId:orderId,orderNumber:order.order_number||"",orderItemId:item?.id||binding.order_item_id||null,customerId:customer?.id||null,customerNumber,source:"v2_billing_store_order_control"}});
          const newId=String(remote?.id||remote?.license_id||remote?.license?.id||remote?.licence?.id||"").trim();
          if(!newId)throw new Error("License Master did not return a license id");
          const key=String(remote?.license_key||remote?.licenseKey||remote?.key||remote?.license?.license_key||remote?.licence?.license_key||"");
          const now=new Date().toISOString();
          const patch={license_id:newId,remote_state:String(remote?.storage_status||remote?.license?.storage_status||remote?.status||remote?.license?.status||"active"),desired_state:"active",archived_at:null,archive_reason:null,license_key_last4:key?key.slice(-4):binding.license_key_last4||null,last_synced_at:now,last_sync_error:null,updated_at:now};
          const {error}=await licenseDb().from("license_bindings").update(patch).eq("id",binding.id);if(error)throw error;
          if(binding.fulfillment_id){const {error:fe}=await licenseDb().from("license_fulfillments").update({license_id:newId,state:"fulfilled",last_error:null,fulfilled_at:now,updated_at:now,metadata:{...(binding.metadata||{}),master_license_id:newId,reprovisioned:true}}).eq("id",binding.fulfillment_id);if(fe)throw fe}
          const entitlementResult=await licenseDb().from("download_entitlements").select("id,metadata").eq("auth_user_id",order.auth_user_id).eq("order_item_id",binding.order_item_id||"").maybeSingle();
          if(entitlementResult.error)throw entitlementResult.error;
          if(entitlementResult.data){const metadata={...(entitlementResult.data.metadata||{}),license_id:newId,master_license_id:newId,reprovisioned:true,previous_license_id:licenseId||null};const {error:ee}=await licenseDb().from("download_entitlements").update({metadata,status:"active",revoked_at:null,reason:"License Master reprovisioning"}).eq("id",entitlementResult.data.id);if(ee)throw ee}
          results.push({bindingId:binding.id,previousLicenseId:licenseId||null,licenseId:newId,action,status:"ok",reprovisioned:true});
        }else{
          if(!licenseId)throw new Error("Binding has no License Master license id");
          const masterAction=action==="terminate"?"terminate":action==="unsuspend"?"activate":action==="suspend"?"restrict":action;
          remote=await masterControl(licenseId,{action:masterAction,reason:String(body.reason||"").trim()||null,actorRef:"billing_store_order_control"});
          const remoteState=masterAction==="terminate"?"revoked":masterAction==="restrict"?"suspended":"active";
          const now=new Date().toISOString();
          const patch:any={remote_state:remoteState,desired_state:remoteState,last_synced_at:now,last_sync_error:null,updated_at:now};
          if(masterAction==="terminate"){patch.archived_at=now;patch.archive_reason=String(body.reason||"Order service termination")}
          const {error}=await licenseDb().from("license_bindings").update(patch).eq("id",binding.id);if(error)throw error;
          results.push({bindingId:binding.id,licenseId,action,status:"ok"});
        }
      }catch(e:any){failures.push({bindingId:binding.id,licenseId:licenseId||null,error:String(e?.message||"License Master action failed")})}
    }
    return Response.json({ok:failures.length===0,orderId,action,results,failures},{headers:{"cache-control":"no-store"}});
  }catch(e:any){return Response.json({error:e?.message||"Order license control failed",code:e?.code||"ORDER_LICENSE_CONTROL_FAILED"},{status:e?.status||500});}
}
