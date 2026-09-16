import {licenseDb} from "@/lib/license-api";
import {masterIssue} from "@/lib/master-api";

function canonicalComponent(value:any){const key=String(value||"").trim().toLowerCase();if(key==="orbitfs_panel")return "orbitfs_base";if(key==="orbitfs_sorter")return "orbitfs_apex";return key}

export async function syncPaidOrderToLicenseMaster(orderId:string){
  const db=licenseDb();
  const {data:order,error:orderError}=await db.from("orders").select("id,order_number,auth_user_id,status,payment_status,fulfillment_status").eq("id",orderId).maybeSingle();
  if(orderError)throw orderError;
  if(!order)return {ok:false,skipped:true,reason:"order_not_found"};
  if(!["paid","active"].includes(String(order.payment_status||order.status||"").toLowerCase())&&String(order.status||"").toLowerCase()!=="active")return {ok:false,skipped:true,reason:"order_not_paid"};
  const {data:items,error:itemError}=await db.from("order_items").select("id,product_id,license_product_key,configuration").eq("order_id",orderId).order("id");
  if(itemError)throw itemError;
  const components:Record<string,boolean>={};
  for(const item of items||[]){const key=canonicalComponent(item.license_product_key);if(key.startsWith("orbitfs_"))components[key]=true;}
  if(!Object.keys(components).length)return {ok:true,skipped:true,reason:"no_orbitfs_entitlement"};
  if(components.orbitfs_apex||components.orbitfs_mcp||components.orbitfs_studio)components.orbitfs_base=true;

  // Use the exact field names accepted by License Master's public issue API.
  // external_reference is also the idempotency anchor on the Master side.
  const result=await masterIssue({
    product_code:"orbitfs_base",
    customer_external_id:String(order.auth_user_id||""),
    external_reference:String(order.id),
    metadata:{
      billingOrderId:String(order.id),
      orderNumber:String(order.order_number||""),
      source:"v2_billing_store",
      components
    }
  });

  const masterLicense=result?.license||result?.licence||null;
  return {
    ok:true,
    orderId:String(order.id),
    licenseKey:result?.license_key||masterLicense?.license_key||masterLicense?.key||null,
    licenseId:result?.license_id||result?.id||masterLicense?.id||null,
    masterLicense,
    result
  };
}
