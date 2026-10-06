import {httpError,requireOrbitUser,requireSetupSystem} from "@/lib/orbitfs-deployment";
import {licenseDb} from "@/lib/license-api";
import {masterLicenses} from "@/lib/master-api";
import {serviceRpc} from "@/lib/paymentServer";
import {canonicalLicenseStatus,isCanonicalLicenseUsable} from "@/lib/license-status";
import {billingCustomerUserFilter} from "@/lib/billing-customer-identity.mjs";

export async function POST(req:Request){
  try{
    const {user}=await requireOrbitUser(req);
    await requireSetupSystem();
    const body=await req.json().catch(()=>({}));
    const bindingId=String(body?.bindingId||body?.binding_id||"").trim();
    if(!bindingId)throw Object.assign(new Error("An active OrbitFS licence is required"),{status:400});

    const db=licenseDb();
    const [{data:binding,error:bindingError},{data:customer,error:customerError},master]=await Promise.all([
      db.from("license_bindings").select("id,license_id,auth_user_id,archived_at").eq("id",bindingId).eq("auth_user_id",user.id).is("archived_at",null).maybeSingle(),
      db.from("customers").select("customer_number").or(billingCustomerUserFilter(user.id)).limit(1).maybeSingle(),
      masterLicenses()
    ]);
    if(bindingError)throw bindingError;
    if(customerError)throw customerError;
    if(!binding)throw Object.assign(new Error("OrbitFS licence binding not found"),{status:404});

    const customerNumber=String(customer?.customer_number||"").trim();
    const authoritative=(Array.isArray(master?.licenses)?master.licenses:[]).find((row:any)=>
      String(row?.id||"")===String(binding.license_id||"")&&
      (!customerNumber||String(row?.customer_external_id||"").trim()===customerNumber)
    );
    if(!authoritative)throw Object.assign(new Error("License Manager does not recognize this licence for the current account"),{status:403,code:"LICENCE_NOT_AUTHORIZED"});
    const status=canonicalLicenseStatus(authoritative);
    if(!isCanonicalLicenseUsable(status))throw Object.assign(new Error(`This OrbitFS licence is ${status}`),{status:403,code:"LICENCE_NOT_ACTIVE"});

    const product=String(authoritative.product||authoritative.product_code||"").trim().toLowerCase();
    const components=authoritative.components&&typeof authoritative.components==="object"?authoritative.components:{};
    const baseComponent=(components as any).orbitfs_base??(components as any).orbitfs_panel;
    const hasBaseEntitlement=product==="orbitfs_base"||baseComponent===true||baseComponent?.allowed===true||["enabled","active","licensed"].includes(String(baseComponent?.state||"").toLowerCase());
    if(!hasBaseEntitlement)throw Object.assign(new Error("An active OrbitFS Base licence is required before starting Base deployment"),{status:403,code:"BASE_LICENSE_REQUIRED"});

    // Base deployment is authorized by the Base licence. Add-on entitlements are
    // evaluated separately by License Manager and never gate access to this flow.
    const installation=await serviceRpc("service_ensure_orbitfs_inner_installation",{
      p_auth_user_id:user.id,
      p_binding_id:bindingId
    });
    return Response.json({ok:true,installation},{headers:{"cache-control":"no-store"}});
  }catch(error){return httpError(error)}
}
