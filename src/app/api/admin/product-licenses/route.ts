import {createClient} from "@supabase/supabase-js";
import {masterControl,masterIssue,masterLicenses,masterProducts,masterRequest,masterUpdateLicense} from "@/lib/master-api";
import {licenseDb} from "@/lib/license-api";

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const SUPABASE_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";

async function staff(req:Request){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token||!SUPABASE_URL||!SUPABASE_KEY)return null;
  const sb=createClient(SUPABASE_URL,SUPABASE_KEY,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await sb.auth.getUser(token);if(error||!user)return null;
  const {data}=await sb.rpc("get_my_staff_access");const row=Array.isArray(data)?data[0]:data,p=row?.permissions;
  const ok=p?.all===true||(Array.isArray(p)?p.includes("licenses.manage")||p.includes("license_api.manage"):Boolean(p?.["licenses.manage"]||p?.["license_api.manage"]));
  return ok?{user,sb}:null;
}

const slugOk=(value:string)=>/^[a-z0-9][a-z0-9._-]{0,79}$/.test(value);
const licenseId=(row:any)=>String(row?.id||row?.license_id||row?.license?.id||"").trim();

export async function GET(req:Request){
  try{
    const actor=await staff(req);if(!actor)return Response.json({error:"License management permission required"},{status:403});
    const [productsResult,licensesResult,customersResult]=await Promise.all([
      masterProducts(),masterLicenses(),actor.sb.from("customers").select("id,auth_user_id,user_id,customer_number,name,email").order("created_at",{ascending:false}).limit(500)
    ]);
    if(customersResult.error)throw customersResult.error;
    return Response.json({
      products:(Array.isArray(productsResult?.products)?productsResult.products:Array.isArray(productsResult)?productsResult:[]).filter((p:any)=>String(p.status||"active").toLowerCase()==="active"),
      licenses:Array.isArray(licensesResult?.licenses)?licensesResult.licenses:[],
      customers:customersResult.data||[]
    },{headers:{"cache-control":"no-store"}});
  }catch(e:any){return Response.json({error:e?.message||"Could not load product licences",code:e?.code||"PRODUCT_LICENSES_LOAD_FAILED"},{status:e?.status||500});}
}

export async function POST(req:Request){
  try{
    const actor=await staff(req);if(!actor)return Response.json({error:"License management permission required"},{status:403});
    const body=await req.json().catch(()=>({}));
    const action=String(body.action||"").trim().toLowerCase();
    const id=String(body.licenseId||body.license_id||"").trim();
    if(action==="issue"){
      const requestedProduct=String(body.product||body.product_code||"").trim().toLowerCase();
      const customerId=String(body.customerId||body.customer_id||"").trim();
      if(!slugOk(requestedProduct))return Response.json({error:"A valid product API ID is required"},{status:400});
      const catalogue=await masterProducts();
      const registeredRows=Array.isArray(catalogue?.products)?catalogue.products:Array.isArray(catalogue)?catalogue:[];
      const productRecord=registeredRows.find((p:any)=>[p.code,p.product_code,p.slug].some((value:any)=>String(value||"").trim().toLowerCase()===requestedProduct));
      if(!productRecord)return Response.json({error:"Product is not registered in License Manager"},{status:404});
      if(String(productRecord.status||"active").toLowerCase()!=="active")return Response.json({error:"Product is not active in License Manager"},{status:409});
      const strategy=String(productRecord.validation_policy?.license_strategy||"standalone").trim().toLowerCase();
      if(strategy==="component")return Response.json({error:"This product is a component entitlement. Issue or manage the licence for its configured base product instead.",base_product_key:productRecord.validation_policy?.base_product_key||null},{status:409});
      if(!["standalone","base"].includes(strategy))return Response.json({error:"Product has an unsupported License Manager licence strategy: "+strategy},{status:409});
      const product=String(productRecord.code||productRecord.product_code||productRecord.slug||requestedProduct).trim().toLowerCase();
      if(!customerId)return Response.json({error:"Customer is required"},{status:400});
      const {data:customer,error}=await actor.sb.from("customers").select("id,auth_user_id,user_id,customer_number,name,email").eq("id",customerId).maybeSingle();
      if(error)throw error;if(!customer)return Response.json({error:"Customer not found"},{status:404});
      const userId=String(customer.auth_user_id||customer.user_id||"").trim();
      const customerNumber=String(customer.customer_number||"").trim();
      if(!userId||!customerNumber)return Response.json({error:"Customer must have a linked account and customer number"},{status:409});
      const maxInstallations=Number(body.max_installations??1);
      if(!Number.isInteger(maxInstallations)||maxInstallations<1||maxInstallations>1000)return Response.json({error:"Installation limit must be between 1 and 1000"},{status:400});
      const expiresAt=body.expires_at?new Date(String(body.expires_at)):null;
      if(expiresAt&&Number.isNaN(expiresAt.getTime()))return Response.json({error:"Invalid expiry date"},{status:400});
      const features=body.features&&typeof body.features==="object"&&!Array.isArray(body.features)?body.features:{};
      const reference=String(body.external_reference||`billing-manual:${crypto.randomUUID()}`).trim();
      const remote=await masterIssue({product,customer_external_id:customerNumber,external_reference:reference,expires_at:expiresAt?.toISOString()||null,max_installations:maxInstallations,features,metadata:{source:"v2_billing_store_product_license",customerId:customer.id,customerNumber,issuedBy:actor.user.id}});
      const newId=licenseId(remote);
      if(!newId)throw new Error("License Manager did not return a licence ID");
      const key=String(remote?.license_key||remote?.licenseKey||remote?.key||remote?.license?.license_key||"");
      const components=remote?.components&&typeof remote.components==="object"?remote.components:remote?.license?.components&&typeof remote.license.components==="object"?remote.license.components:{};
      const remoteState=String(remote?.storage_status||remote?.license?.storage_status||remote?.status||remote?.license?.status||"active").toLowerCase();
      const {error:bindingError}=await licenseDb().from("license_bindings").insert({
        auth_user_id:userId,license_id:newId,license_product_key:product,desired_state:remoteState,remote_state:remoteState,
        components,expires_at:remote?.expires_at||expiresAt?.toISOString()||null,license_key_last4:key?key.slice(-4):null,label:String(body.label||productRecord.name||product),api_source:"license_master",admin_override:false,updated_at:new Date().toISOString()
      });
      if(bindingError)throw bindingError;
      return Response.json({ok:true,license:remote.license||remote,key,licenseId:newId},{status:201,headers:{"cache-control":"no-store"}});
    }
    if(!id)return Response.json({error:"licenseId is required"},{status:400});
    if(action==="update"){
      const input:any={};
      for(const key of ["customer_external_id","external_reference","expires_at","max_installations","features","metadata"])
        if(Object.prototype.hasOwnProperty.call(body,key))input[key]=body[key];
      const result=await masterUpdateLicense(id,input);
      return Response.json({ok:true,...result},{headers:{"cache-control":"no-store"}});
    }
    if(!["suspend","activate","terminate","rotate"].includes(action))return Response.json({error:"Unsupported licence action"},{status:400});
    const controlAction=action==="suspend"?"restrict":action==="terminate"?"terminate":action;
    const result=await masterControl(id,{action:controlAction,reason:String(body.reason||"").trim()||"Billing Store administrator action",actorRef:"billing_store_product_license"});
    const remoteState=action==="suspend"?"suspended":action==="terminate"?"revoked":"active";
    const patch:any={remote_state:remoteState,desired_state:remoteState,updated_at:new Date().toISOString(),last_synced_at:new Date().toISOString(),last_sync_error:null};
    if(action==="terminate"){patch.archived_at=new Date().toISOString();patch.archive_reason=String(body.reason||"Terminated from Billing Store");}
    const {error:bindingError}=await licenseDb().from("license_bindings").update(patch).eq("license_id",id);
    if(bindingError)throw bindingError;
    const key=String(result?.key||result?.license?.key||result?.license?.license_key||"");
    return Response.json({ok:true,...result,...(key?{key}:{})},{headers:{"cache-control":"no-store"}});
  }catch(e:any){return Response.json({error:e?.message||"Product licence action failed",code:e?.code||"PRODUCT_LICENSE_ACTION_FAILED"},{status:e?.status||500});}
}

export async function PATCH(req:Request){
  try{
    const actor=await staff(req);if(!actor)return Response.json({error:"License management permission required"},{status:403});
    const body=await req.json().catch(()=>({}));
    const slug=String(body.product_slug||body.productSlug||"").trim().toLowerCase();
    const name=String(body.product_name||body.productName||"").trim();
    const description=body.description==null?null:String(body.description);
    const groupId=body.group_id===null||body.group_id===""?null:String(body.group_id||"").trim();
    if(!slug||!name||!slugOk(slug))return Response.json({error:"A valid Billing Store product name and licence product key are required"},{status:400});
    const {products=[]}=await masterProducts();
    const product=products.find((p:any)=>[p.code,p.product_code,p.slug].some((value:any)=>String(value||"").trim().toLowerCase()===slug));
    const payload:any={
      name,
      slug:product?.slug||slug,
      description,
      group_id:groupId,
      validation_policy:product?.validation_policy||{}
    };
    const result=product
      ?await masterRequest("/api/v1/products",{method:"PATCH",body:JSON.stringify({...payload,product_id:product.id})})
      :await masterRequest("/api/v1/products",{method:"POST",body:JSON.stringify(payload)});
    return Response.json({ok:true,product:result.product||result},{headers:{"cache-control":"no-store"}});
  }catch(e:any){
    return Response.json({error:e?.message||"Could not assign product group",code:e?.code||"PRODUCT_GROUP_ASSIGNMENT_FAILED"},{status:e?.status||500});
  }
}
