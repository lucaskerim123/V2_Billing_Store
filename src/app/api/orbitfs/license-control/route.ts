import {createClient as createSupabaseClient} from "@supabase/supabase-js";
import {masterControl,masterLicenses} from "@/lib/master-api";
import {errorMessage} from "@/lib/error-message";
import {billingCustomerUserFilter} from "@/lib/billing-customer-identity.mjs";

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const SUPABASE_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
const CUSTOMER_ACTIONS=new Set(["rotate","unlock"]);

export async function POST(req:Request){
  try{
    const auth=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
    if(!auth)return Response.json({error:"Authentication required"},{status:401});
    if(!SUPABASE_URL||!SUPABASE_KEY)return Response.json({error:"Billing Store authentication is not configured"},{status:503});

    const sb=createSupabaseClient(SUPABASE_URL,SUPABASE_KEY,{
      global:{headers:{Authorization:"Bearer "+auth}},
      auth:{persistSession:false,autoRefreshToken:false}
    });
    const {data:{user},error:userError}=await sb.auth.getUser(auth);
    if(userError||!user)return Response.json({error:"Authentication expired"},{status:401});

    const body=await req.json().catch(()=>({}));
    const licenseId=String(body.licenseId||"").trim();
    const action=String(body.action||"").trim().toLowerCase();
    if(!licenseId||!CUSTOMER_ACTIONS.has(action))return Response.json({error:"That licence action is not available to customers"},{status:400});

    const [{data:customer},{data:orders}]=await Promise.all([
      sb.from("customers").select("id,auth_user_id,user_id,customer_number").or(billingCustomerUserFilter(user.id)).limit(1).maybeSingle(),
      sb.from("orders").select("id,order_number").eq("auth_user_id",user.id)
    ]);
    const refs=new Set<string>();
    for(const order of orders||[]){
      if(order.id)refs.add(String(order.id));
      if(order.order_number)refs.add(String(order.order_number));
    }

    const master=await masterLicenses();
    const licence=(master?.licenses||[]).find((candidate:any)=>
      String(candidate.id||candidate.license_id)===licenseId&&
      (
        String(candidate.customer_external_id||candidate.customer_ref||"")===String(customer?.customer_number||"")||
        refs.has(String(candidate.external_reference||candidate.order_ref||""))
      )
    );
    if(!licence)return Response.json({error:"Licence not found for this account"},{status:404});

    const bindingResult=await sb.from("license_bindings").select("id,order_item_id").eq("auth_user_id",user.id).eq("license_id",licenseId).is("archived_at",null).maybeSingle();
    if(bindingResult.error)throw bindingResult.error;
    const binding=bindingResult.data;
    if(!binding?.id)return Response.json({error:"Licence binding not found for this account"},{status:404});

    let installationId=String(body.installationId||"").trim();
    let installation:any=null;
    if(installationId){
      const installResult=await sb.from("orbitfs_installations").select("id,installation_id,state,metadata").eq("auth_user_id",user.id).eq("license_binding_id",binding.id).eq("installation_id",installationId).maybeSingle();
      if(installResult.error)throw installResult.error;
      installation=installResult.data||null;
    }

    if(action==="unlock"){
      if(!installationId)return Response.json({error:"Installation is required to unlock a licence."},{status:400});
      if(!installation)return Response.json({error:"Installation is not registered for this licence"},{status:404});
      installationId=String(installation.installation_id);
    }

    const masterAction=action==="unlock"?"customer-unlock":action;
    const result=await masterControl(licenseId,{
      action:masterAction,
      installation_id:installationId||null,
      actorRef:"billing_store_customer_portal"
    });
    const key=result?.key||result?.license?.key||result?.license_key||result?.licenseKey||null;

    if(action==="rotate"){
      const rotatedId=String(result?.license?.id||result?.id||result?.license_id||licenseId).trim();
      if(rotatedId!==licenseId)throw Object.assign(new Error("License Master returned an unexpected replacement license id during in-place rotation"),{status:502});

      const now=new Date().toISOString();
      const mirrorWarnings:string[]=[];
      const update={
        license_key_last4:key?String(key).slice(-4):null,
        remote_state:String(result?.license?.storage_status||result?.storage_status||result?.license?.status||result?.status||"active"),
        desired_state:"active",
        api_source:"license_master",
        last_synced_at:now,
        last_sync_error:null,
        updated_at:now
      };
      const bindingUpdate=await sb.from("license_bindings").update(update).eq("id",binding.id);
      if(bindingUpdate.error)mirrorWarnings.push("Billing licence mirror did not refresh: "+bindingUpdate.error.message);

      if(binding.order_item_id){
        const entitlement=await sb.from("download_entitlements").select("id,metadata").eq("auth_user_id",user.id).eq("order_item_id",binding.order_item_id).maybeSingle();
        if(entitlement.error)mirrorWarnings.push("Download entitlement did not refresh: "+entitlement.error.message);
        else if(entitlement.data){
          const metadata={
            ...(entitlement.data.metadata||{}),
            license_id:licenseId,
            license_key_last4:key?String(key).slice(-4):entitlement.data.metadata?.license_key_last4||null,
            rotated_at:now
          };
          const entitlementUpdate=await sb.from("download_entitlements").update({
            metadata,
            status:"active",
            revoked_at:null,
            reason:"License key rotation"
          }).eq("id",entitlement.data.id);
          if(entitlementUpdate.error)mirrorWarnings.push("Download entitlement mirror did not refresh: "+entitlementUpdate.error.message);
        }
      }

      if(installation?.id){
        const metadata=installation.metadata&&typeof installation.metadata==="object"?{...installation.metadata}:{};
        const pending=metadata.pendingBaseForceReinstall&&typeof metadata.pendingBaseForceReinstall==="object"?{...metadata.pendingBaseForceReinstall}:null;
        if(pending){
          pending.status="waiting_new_key";
          pending.rotationCompletedAt=now;
          pending.rotatedKeyLast4=key?String(key).slice(-4):null;
          metadata.pendingBaseForceReinstall=pending;
          const installationUpdate=await sb.from("orbitfs_installations").update({metadata,updated_at:now}).eq("id",installation.id);
          if(installationUpdate.error)mirrorWarnings.push("Base reinstall status did not refresh: "+installationUpdate.error.message);
        }
      }

      (result as any).billingMirrorWarnings=mirrorWarnings;
    }

    const pendingReinstall=Boolean(installation?.metadata?.pendingBaseForceReinstall);
    const message=key&&action==="rotate"
      ?pendingReinstall
        ?"Licence rotated. Save the new key now, then return to Base Deployment and enter it to continue the pending Base reinstall."
        :"Licence rotated. Save the new key now."
      :`Licence ${action} request completed.`;

    const warnings=Array.isArray((result as any).billingMirrorWarnings)?(result as any).billingMirrorWarnings:[];
    return Response.json({...result,...(key?{key}:{}),message,warnings});
  }catch(error:any){
    return Response.json({error:errorMessage(error,"License Master unavailable")},{status:error?.status||502});
  }
}
