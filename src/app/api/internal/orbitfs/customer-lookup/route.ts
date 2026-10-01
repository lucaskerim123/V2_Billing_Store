import crypto from "node:crypto";
import {masterLicenses} from "@/lib/master-api";
import {licenseDb} from "@/lib/license-api";

function safeEqual(a:string,b:string){
 const aa=Buffer.from(a),bb=Buffer.from(b);
 return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);
}
function authorized(req:Request){
 const expected=String(process.env.DEV_PANEL_EVENT_SECRET||"").trim();
 const supplied=String(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim()||String(req.headers.get("x-orbitfs-event-secret")||"").trim();
 return Boolean(expected&&supplied&&safeEqual(supplied,expected));
}
const norm=(v:any)=>String(v??"").trim().toLowerCase();
const licenseId=(x:any)=>String(x?.id||x?.license_id||x?.licenseId||"").trim();
function matchReason(x:any,c:any,orders:any[]){
 const number=norm(c.customer_number),id=norm(c.id),auth=norm(c.auth_user_id||c.user_id),email=norm(c.email);
 const refs=new Set((orders||[]).flatMap((o:any)=>[o.id,o.order_number]).filter(Boolean).map(norm));
 const m=x?.metadata||{};
 const vals=[x?.customer_external_id,x?.customer_ref,x?.external_customer_id,x?.customer_id,m.customerNumber,m.customerId,m.customerRecordId,m.customer_external_id,x?.external_reference,x?.order_ref,m.orderRef,m.order_number].map(norm).filter(Boolean);
 if(number&&vals.includes(number))return "customer number";
 if(id&&vals.includes(id))return "customer record";
 if(auth&&vals.includes(auth))return "account id";
 if(email&&[norm(x?.customer_email),norm(x?.email),norm(m.customerEmail),norm(m.email)].includes(email))return "email";
 if(vals.some(v=>refs.has(v)))return "order";
 return "";
}
async function findCustomer(identity:string){
 const db=licenseDb(),value=identity.trim();
 if(!value)return null;
 if(value.includes("@")){
  const r=await db.from("customers").select("id,auth_user_id,user_id,customer_number,name,email,status,created_at,updated_at").ilike("email",value).limit(2);
  if(r.error)throw r.error; return (r.data||[])[0]||null;
 }
 let r=await db.from("customers").select("id,auth_user_id,user_id,customer_number,name,email,status,created_at,updated_at").eq("customer_number",value).limit(2);
 if(r.error)throw r.error;if(r.data?.length)return r.data[0];
 if(/^[0-9a-f-]{36}$/i.test(value)){
  r=await db.from("customers").select("id,auth_user_id,user_id,customer_number,name,email,status,created_at,updated_at").or("id.eq."+value+",auth_user_id.eq."+value+",user_id.eq."+value).limit(2);
  if(r.error)throw r.error;if(r.data?.length)return r.data[0];
 }
 return null;
}
async function snapshot(identity:string){
 const db=licenseDb(),customer=await findCustomer(identity);
 if(!customer)return {customer:null,profile:null,orders:[],bindings:[],installations:[]};
 const userId=String(customer.auth_user_id||customer.user_id||"").trim();
 if(!userId)return {customer,profile:null,orders:[],bindings:[],installations:[]};
 const [profile,orders,bindings,installations]=await Promise.all([
  db.from("user_profiles").select("*").eq("id",userId).maybeSingle(),
  db.from("orders").select("id,order_number,status,payment_status,total_cents,currency,created_at,updated_at").eq("auth_user_id",userId).order("created_at",{ascending:false}).limit(50),
  db.from("license_bindings").select("*").eq("auth_user_id",userId).is("archived_at",null).order("created_at",{ascending:false}),
  db.from("orbitfs_installations").select("*").eq("auth_user_id",userId).order("created_at",{ascending:false})
 ]);
 for(const row of [profile,orders,bindings,installations])if(row.error)throw row.error;
 return {customer,profile:profile.data||null,orders:orders.data||[],bindings:bindings.data||[],installations:installations.data||[]};
}

export async function GET(req:Request){
 if(!authorized(req))return Response.json({error:"UNAUTHORIZED"},{status:401});
 try{
  const identity=String(new URL(req.url).searchParams.get("identity")||"").trim();
  if(!identity)return Response.json({error:"IDENTITY_REQUIRED"},{status:400});
  const data=await snapshot(identity);
  if(!data.customer)return Response.json({ok:true,found:false,identity,...data},{headers:{"cache-control":"no-store"}});
  return Response.json({ok:true,found:true,identity,...data},{headers:{"cache-control":"no-store"}});
 }catch(error){
  return Response.json({error:error instanceof Error?error.message:"Customer lookup failed"},{status:500});
 }
}

export async function POST(req:Request){
 if(!authorized(req))return Response.json({error:"UNAUTHORIZED"},{status:401});
 try{
  const body:any=await req.json().catch(()=>({}));
  const action=String(body.action||"").trim().toLowerCase();
  const identity=String(body.identity||body.email||body.customer||"").trim();
  if(action!=="link_license")return Response.json({error:"UNSUPPORTED_ACTION"},{status:400});
  if(!identity)return Response.json({error:"IDENTITY_REQUIRED"},{status:400});
  const data=await snapshot(identity),customer=data.customer;
  if(!customer)return Response.json({error:"CUSTOMER_NOT_FOUND"},{status:404});
  const userId=String(customer.auth_user_id||customer.user_id||"").trim();
  if(!userId)return Response.json({error:"CUSTOMER_ACCOUNT_NOT_LINKED"},{status:409});
  const master=await masterLicenses(),licenses=Array.isArray(master?.licenses)?master.licenses:[];
  const mode=String(body.mode||"manual").toLowerCase();
  let selected:any=null,reason="";
  if(mode==="auto"){
   const matches=licenses.map((x:any)=>({...x,_match:matchReason(x,customer,data.orders)})).filter((x:any)=>x._match);
   const strong=matches.filter((x:any)=>["customer number","customer record","account id"].includes(x._match));
   selected=strong.length===1?strong[0]:matches.length===1?matches[0]:null;
   reason=selected?selected._match:"";
   if(!selected)return Response.json({error:"LICENSE_LINK_AMBIGUOUS",matches:matches.map((x:any)=>({id:licenseId(x),product:x.product_code||x.product||null,reason:x._match,status:x.status||null}))},{status:409});
  }else{
   const wanted=String(body.license_id||body.licenseId||"").trim();
   if(!wanted)return Response.json({error:"LICENSE_ID_REQUIRED"},{status:400});
   selected=licenses.find((x:any)=>licenseId(x)===wanted);
   if(!selected)return Response.json({error:"LICENSE_NOT_FOUND"},{status:404});
  }
  const selectedId=licenseId(selected),product=String(selected.product_code||selected.product||selected.license_product_key||"").toLowerCase();
  if(product!=="orbitfs_base")return Response.json({error:"ONLY_BASE_LICENSE_CAN_BE_LINKED"},{status:400});
  if(["revoked","expired"].includes(String(selected.status||"").toLowerCase()))return Response.json({error:"TERMINAL_LICENSE_CANNOT_BE_LINKED"},{status:409});
  const db=licenseDb();
  const owner=await db.from("license_bindings").select("id,auth_user_id").eq("license_id",selectedId).is("archived_at",null).neq("auth_user_id",userId).limit(1).maybeSingle();
  if(owner.error)throw owner.error;if(owner.data)return Response.json({error:"LICENSE_ALREADY_LINKED_TO_ANOTHER_CUSTOMER"},{status:409});
  const existing=await db.from("license_bindings").select("id,label").eq("auth_user_id",userId).eq("license_id",selectedId).is("archived_at",null).maybeSingle();
  if(existing.error)throw existing.error;
  const key=String(selected.license_key||selected.licenseKey||selected.key||"");
  const matchedOrder=(data.orders||[]).find((o:any)=>[o.id,o.order_number].map(norm).includes(norm(selected.external_reference||selected.order_ref||"")));
  const payload:any={auth_user_id:userId,license_id:selectedId,license_product_key:"orbitfs_base",desired_state:String(selected.status||"active"),remote_state:String(selected.status||"active"),license_key_last4:key?key.slice(-4):selected.license_key_last4||null,expires_at:selected.expires_at||null,label:existing.data?.label||selected.product_name||selected.product_code||selected.product||"OrbitFS Base",api_source:"license_master",admin_override:selected.customer_override===true,updated_at:new Date().toISOString()};
  if(matchedOrder?.id)payload.order_id=matchedOrder.id;
  const write=existing.data?.id?await db.from("license_bindings").update(payload).eq("id",existing.data.id):await db.from("license_bindings").insert(payload).select("id").single();
  if(write.error)throw write.error;
  return Response.json({ok:true,linked:true,customer,licenseId:selectedId,bindingId:existing.data?.id||write.data?.id||null,matchReason:reason||"manual"});
 }catch(error){
  return Response.json({error:error instanceof Error?error.message:"Customer licence link failed"},{status:500});
 }
}
