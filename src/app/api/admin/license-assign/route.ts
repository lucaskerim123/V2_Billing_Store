import {createClient as createSupabaseClient} from "@supabase/supabase-js";
import {masterIssue,masterProducts} from "@/lib/master-api";
import {licenseDb} from "@/lib/license-api";
const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const SUPABASE_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
async function staff(req:Request){
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
 if(!token||!SUPABASE_URL||!SUPABASE_KEY)return null;
 const sb=createSupabaseClient(SUPABASE_URL,SUPABASE_KEY,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error}=await sb.auth.getUser(token);if(error||!user)return null;
 const {data}=await sb.rpc("get_my_staff_access");const row=Array.isArray(data)?data[0]:data,p=row?.permissions;
 const ok=p?.all===true||(Array.isArray(p)?p.includes("licenses.manage")||p.includes("license_api.manage"):Boolean(p?.["licenses.manage"]||p?.["license_api.manage"]));
 return ok?{user,sb}:null;
}
export async function POST(req:Request){
 try{
  const actor=await staff(req);if(!actor)return Response.json({error:"License management permission required"},{status:403});
  const body=await req.json().catch(()=>({})),customerId=String(body.customerId||"").trim(),requestedProduct=String(body.product||body.product_code||"").trim().toLowerCase();
  const allowMultiple=body.allowMultiple===true||body.customerOverride===true||body.customer_override===true;
  if(!customerId)return Response.json({error:"Customer is required"},{status:400});
  if(!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(requestedProduct))return Response.json({error:"A registered product API ID is required"},{status:400});
  const catalogue=await masterProducts(),products=Array.isArray(catalogue?.products)?catalogue.products:[];
  const record=products.find((p:any)=>[p.code,p.product_code,p.slug].some((v:any)=>String(v||"").trim().toLowerCase()===requestedProduct));
  if(!record)return Response.json({error:"Product is not registered in License Manager"},{status:404});
  if(String(record.status||"active").toLowerCase()!=="active")return Response.json({error:"Product is not active in License Manager"},{status:409});
  const strategy=String(record.validation_policy?.license_strategy||"standalone").trim().toLowerCase();
  if(strategy==="component")return Response.json({error:"Component products are entitlements on their configured base product licence and cannot be issued as standalone licences.",base_product_key:record.validation_policy?.base_product_key||null},{status:409});
  if(!["standalone","base"].includes(strategy))return Response.json({error:"Unsupported licence strategy: "+strategy},{status:409});
  const product=String(record.code||record.product_code||record.slug||requestedProduct).trim().toLowerCase(),label=String(body.label||record.name||product).trim()||product;
  const {data:customer,error:customerError}=await actor.sb.from("customers").select("id,auth_user_id,user_id,customer_number,name,email").eq("id",customerId).maybeSingle();
  if(customerError)throw customerError;if(!customer)return Response.json({error:"Customer not found"},{status:404});
  const userId=String(customer.auth_user_id||customer.user_id||"").trim(),customerNumber=String(customer.customer_number||"").trim();
  if(!userId)return Response.json({error:"Customer has no linked account"},{status:400});
  if(!customerNumber)return Response.json({error:"Customer has no Billing Store customer number"},{status:400});
  const maxInstallations=Number(body.maxInstallations??1);
  if(!Number.isInteger(maxInstallations)||maxInstallations<1||maxInstallations>1000)return Response.json({error:"Installation limit must be between 1 and 1000"},{status:400});
  const expiresAt=body.expiresAt?new Date(String(body.expiresAt)):null;
  if(expiresAt&&Number.isNaN(expiresAt.getTime()))return Response.json({error:"Invalid expiry date"},{status:400});
  const supplied=body.components&&typeof body.components==="object"&&!Array.isArray(body.components)?body.components:null,components=supplied||(strategy==="base"?{[product]:true}:undefined);
  const orderRef=String(body.orderRef||("admin:"+customerNumber+":"+Date.now()));
  const result=await masterIssue({product_code:product,customer_external_id:customerNumber,customer_override:allowMultiple,external_reference:orderRef,expires_at:expiresAt?.toISOString()||null,components,max_installations:maxInstallations,metadata:{source:"billing_store_admin",issuance_mode:allowMultiple?"admin_multiple_license_override":"admin_issue",customerId:customer.id,customerRecordId:String(customer.id),customerNumber,customerEmail:customer.email||null,label}});
  const licenseId=String(result?.id||result?.license_id||result?.licence?.id||result?.license?.id||result?.binding?.id||"");if(!licenseId)throw new Error("License Manager did not return a licence ID");
  const key=String(result?.license_key||result?.licenseKey||result?.licenceKey||result?.key||result?.licence?.licenseKey||""),remoteState=String(result?.storage_status||result?.licence?.storage_status||result?.license?.storage_status||result?.binding?.storage_status||result?.status||result?.licence?.status||result?.license?.status||result?.binding?.status||"active");
  const db=licenseDb(),now=new Date().toISOString();
  const {data:existing,error:readError}=await db.from("license_bindings").select("id,auth_user_id").eq("license_id",licenseId).is("archived_at",null).maybeSingle();
  if(readError)throw readError;if(existing&&String(existing.auth_user_id)!==userId)return Response.json({error:"This licence is already linked to another customer."},{status:409});
  const payload={auth_user_id:userId,license_id:licenseId,license_product_key:product,desired_state:remoteState,remote_state:remoteState,components:components||{},license_key_last4:key?key.slice(-4):null,expires_at:result?.expires_at||expiresAt?.toISOString()||null,label,api_source:"license_master",admin_override:allowMultiple,updated_at:now};
  const write=existing?.id?await db.from("license_bindings").update(payload).eq("id",existing.id):await db.from("license_bindings").insert(payload).select("id").single();
  if(write.error)throw write.error;
  return Response.json({ok:true,licenseId,customerId:customer.id,customerNumber,status:remoteState,licenseKey:key||null,allowMultiple,alreadyIssued:Boolean(result?.already_issued||result?.alreadyIssued||result?.idempotent)});
 }catch(e:any){return Response.json({error:e?.message||"License assignment failed",code:e?.code||"LICENSE_ASSIGN_FAILED"},{status:e?.status||500});}
}
