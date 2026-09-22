import {createClient} from "@supabase/supabase-js";
import {masterControl,masterIssue} from "@/lib/master-api";
import {licenseDb} from "@/lib/license-api";

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";

async function staff(req:Request){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token||!SUPABASE_URL||!SUPABASE_KEY)return null;
  const sb=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await sb.auth.getUser(token);if(error||!user)return null;
  const {data}=await sb.rpc("get_my_staff_access");const row=Array.isArray(data)?data[0]:data,p=row?.permissions;
  const ok=p?.all===true||(Array.isArray(p)?p.includes("licenses.manage")||p.includes("license_api.manage"):Boolean(p?.["licenses.manage"]||p?.["license_api.manage"]));
  return ok?{user,sb}:null;
}

export async function POST(req:Request){
  try{
    const actor=await staff(req);if(!actor)return Response.json({error:"License management permission required"},{status:403});
    const body=await req.json().catch(()=>({}));
    const orderId=String(body.orderId||body.order_id||"").trim();
    const action=String(body.action||"").trim().toLowerCase();
    if(!orderId)return Response.json({error:"orderId is required"},{status:400});
    if(!["activate","reprovision","suspend","unsuspend","terminate"].includes(action))return Response.json({error:"Unsupported order license action"},{status:400});

    const {data:order,error:oe}=await actor.sb.from("orders").select("id,auth_user_id,order_number").eq("id",orderId).maybeSingle();
    if(oe)throw oe;if(!order)return Response.json({error:"Order not found"},{status:404});
    const {data:customer,error:ce}=await actor.sb.from("customers").select("id,customer_number").eq("auth_user_id",order.auth_user_id).maybeSingle();
    if(ce)throw ce;
    const customerNumber=String(customer?.customer_number||"").trim();
    if(!customerNumber)return Response.json({error:"Customer number is missing for this order"},{status:409});

    const {data:bindings,error:be}=await licenseDb().from("license_bindings").select("*").eq("order_id",orderId).order("created_at",{ascending:false});
    if(be)throw be;
    const {data:items,error:ie}=await actor.sb.from("order_items").select("id,product_name,license_product_key").eq("order_id",orderId).order("id");
    if(ie)throw ie;

    const results:any[]=[];const failures:any[]=[];
    for(const binding of bindings||[]){
      const licenseId=String(binding.license_id||"").trim();
      if(!licenseId){failures.push({bindingId:binding.id,error:"Binding has no License Master license id"});continue;}
      try{
        let remote:any;
        if(action==="reprovision" || (action==="activate" && String(binding.remote_state||"").toLowerCase()==="revoked")){
          const product=String(binding.license_product_key||"").trim().toLowerCase();
          if(!product)throw new Error("License binding has no product key");
          const item=(items||[]).find((x:any)=>String(x.license_product_key||"").toLowerCase()===product);
          remote=await masterIssue({
            product,
            customer_external_id:customerNumber,
            external_reference:`${orderId}:${item?.id||binding.order_item_id||binding.id}`,
            metadata:{billingOrderId:orderId,orderNumber:order.order_number||"",orderItemId:item?.id||binding.order_item_id||null,customerId:customer?.id||null,customerNumber,source:"v2_billing_store_order_control"}
          });
          const newId=String(remote?.id||remote?.license_id||remote?.license?.id||remote?.licence?.id||"").trim();
          if(!newId)throw new Error("License Master did not return a license id");
          const key=String(remote?.license_key||remote?.licenseKey||remote?.key||remote?.license?.license_key||remote?.licence?.license_key||"");
          const patch={license_id:newId,remote_state:String(remote?.status||remote?.license?.status||"active"),desired_state:"active",archived_at:null,license_key_last4:key?key.slice(-4):binding.license_key_last4||null,updated_at:new Date().toISOString()};
          const {error}=await licenseDb().from("license_bindings").update(patch).eq("id",binding.id);if(error)throw error;
          results.push({bindingId:binding.id,previousLicenseId:licenseId,licenseId:newId,action,status:"ok",rotated:false,reprovisioned:true});
        }else{
          const masterAction=action==="terminate"?"revoke":action==="unsuspend"?"activate":action;
          remote=await masterControl(licenseId,{action:masterAction,actorRef:"billing_store_order_control"});
          const remoteState=masterAction==="revoke"?"revoked":masterAction==="suspend"?"suspended":"active";
          const patch:any={remote_state:remoteState,desired_state:remoteState,updated_at:new Date().toISOString()};
          if(masterAction==="revoke")patch.archived_at=new Date().toISOString();
          const {error}=await licenseDb().from("license_bindings").update(patch).eq("id",binding.id);if(error)throw error;
          results.push({bindingId:binding.id,licenseId,action,status:"ok"});
        }
      }catch(e:any){failures.push({bindingId:binding.id,licenseId,error:String(e?.message||"License Master action failed")});}
    }
    return Response.json({ok:failures.length===0,orderId,action,results,failures},{headers:{"cache-control":"no-store"}});
  }catch(e:any){return Response.json({error:e?.message||"Order license control failed",code:e?.code||"ORDER_LICENSE_CONTROL_FAILED"},{status:e?.status||500});}
}
