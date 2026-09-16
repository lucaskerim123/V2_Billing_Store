import {createClient} from "@/lib/supabase";
import {masterIssue} from "@/lib/master-api";
import {licenseDb} from "@/lib/license-api";

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const SUPABASE_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";

async function staff(req:Request){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token||!SUPABASE_URL||!SUPABASE_KEY)return null;
  const sb=createClient(SUPABASE_URL,SUPABASE_KEY,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
  const {data:{user},error}=await sb.auth.getUser(token);if(error||!user)return null;
  const {data}=await sb.rpc("get_my_staff_access");
  const row=Array.isArray(data)?data[0]:data,p=row?.permissions;
  const ok=p?.all===true||(Array.isArray(p)?p.includes("licenses.manage")||p.includes("license_api.manage"):Boolean(p?.["licenses.manage"]||p?.["license_api.manage"]));
  return ok?{user,sb}:null;
}

export async function POST(req:Request){
  try{
    const actor=await staff(req);if(!actor)return Response.json({error:"License management permission required"},{status:403});
    const body=await req.json().catch(()=>({}));
    const customerId=String(body.customerId||"").trim();
    const product=String(body.product||"orbitfs_base").trim().toLowerCase();
    const label=String(body.label||"OrbitFS licence").trim()||"OrbitFS licence";
    if(!customerId)return Response.json({error:"Customer is required"},{status:400});
    const {data:customer,error:customerError}=await actor.sb.from("customers").select("id,auth_user_id,name,email").eq("id",customerId).maybeSingle();
    if(customerError)throw customerError;
    if(!customer?.auth_user_id)return Response.json({error:"Customer has no linked account"},{status:400});
    const orderRef=String(body.orderRef||`admin:${customer.id}:${Date.now()}`);
    const result=await masterIssue({product_code:product,customer_external_id:String(customer.auth_user_id),external_reference:orderRef,expires_at:body.expiresAt||null,components:body.components||{orbitfs_base:product==="orbitfs_base"},max_installations:Number(body.maxInstallations||1),metadata:{source:"billing_store_admin",customerId:String(customer.id),customerEmail:customer.email||null,label}});
    const licenseId=String(result?.id||result?.license_id||result?.licence?.id||result?.license?.id||result?.binding?.id||"");
    if(!licenseId)throw new Error("License Master did not return a license ID");
    const key=String(result?.license_key||result?.licenseKey||result?.licenceKey||result?.key||"");
    const remoteState=String(result?.status||result?.licence?.status||result?.license?.status||"active");
    const db=licenseDb();
    const now=new Date().toISOString();
    const {data:existing}=await db.from("license_bindings").select("id").eq("auth_user_id",customer.auth_user_id).eq("license_id",licenseId).maybeSingle();
    const payload={auth_user_id:customer.auth_user_id,license_id:licenseId,license_product_key:product,desired_state:"active",remote_state:remoteState,license_key_last4:key?key.slice(-4):null,label,api_source:"license_master",admin_override:true,updated_at:now};
    const write=existing?.id?await db.from("license_bindings").update(payload).eq("id",existing.id):await db.from("license_bindings").insert(payload).select("id").single();
    if(write.error)throw write.error;
    return Response.json({ok:true,licenseId,customerId:customer.id,status:remoteState,licenseKey:key||null,alreadyIssued:Boolean(result?.alreadyIssued||result?.idempotent)});
  }catch(e:any){return Response.json({error:e?.message||"License assignment failed",code:e?.code||"LICENSE_ASSIGN_FAILED"},{status:e?.status||500});}
}