import {randomUUID,scrypt,timingSafeEqual} from "node:crypto";
import {promisify} from "node:util";
const scryptAsync=promisify(scrypt);
import {createClient} from "@supabase/supabase-js";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY!;
const service=()=>createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

export type OrbitCustomerIdentity={customerId:string;userId:string;email:string;name:string};

export async function hashCustomerPassword(password:string){
 const salt=randomUUID().replaceAll("-","");
 const digest=(await scryptAsync(password,salt,64,{maxmem:64*1024*1024})).toString("hex");
 return `scrypt${salt}${digest}`;
}

export async function verifyCustomerPassword(password:string,encoded:string){
 try{
  const [scheme,salt,expectedHex]=String(encoded||"").split("$");
  if(scheme!=="scrypt"||!salt||!expectedHex)return false;
  const actual=(await scryptAsync(password,salt,64,{maxmem:64*1024*1024})),expected=Buffer.from(expectedHex,"hex");
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
 }catch{return false;}
}

export async function resolveCustomerIdentity(userOrCustomerId:string):Promise<OrbitCustomerIdentity|null>{
 const db=service();
 const first=await db.from("customers").select("id,user_id,email,name,display_name,first_name").eq("user_id",userOrCustomerId).maybeSingle();
 if(first.error)return null;
 let customer=first.data;
 if(!customer){
  const byId=await db.from("customers").select("id,user_id,email,name,display_name,first_name").eq("id",userOrCustomerId).maybeSingle();
  if(byId.error)return null;
  customer=byId.data;
 }
 if(!customer?.user_id)return null;
 return {customerId:String(customer.id),userId:String(customer.user_id),email:String(customer.email||""),name:String(customer.name||customer.display_name||customer.first_name||"Customer")};
}

export async function setCustomerCredentialPassword(userOrCustomerId:string,password:string){
 const db=service(),identity=await resolveCustomerIdentity(userOrCustomerId);
 if(!identity)return {ok:false as const,error:"Customer account not found."};
 const now=new Date().toISOString(),passwordHash=await hashCustomerPassword(password);
 const {error}=await db.from("customer_credentials").upsert({user_id:identity.userId,password_hash:passwordHash,password_changed_at:now,updated_at:now},{onConflict:"user_id"});
 if(error)return {ok:false as const,error:error.message};
 await db.from("customer_sessions").update({revoked_at:now}).eq("user_id",identity.userId).is("revoked_at",null);
 return {ok:true as const,...identity};
}

export async function verifyCustomerCredential(email:string,password:string){
 const db=service(),normalized=email.trim().toLowerCase();
 const {data:user}=await db.from("users").select("id,email,status,email_verified_at,display_name,first_name").ilike("email",normalized).maybeSingle();
 if(!user)return null;
 const {data:customer}=await db.from("customers").select("id,status,email_verified_at,name,display_name,first_name").eq("user_id",user.id).maybeSingle();
 if(!customer)return null;
 const {data:credential}=await db.from("customer_credentials").select("password_hash").eq("user_id",user.id).maybeSingle();
 if(!credential?.password_hash||!(await verifyCustomerPassword(password,String(credential.password_hash))))return null;
 return {customerId:String(customer.id),userId:String(user.id),email:String(user.email),name:String(customer.name||customer.display_name||user.display_name||user.first_name||"Customer"),status:String(user.status||customer.status||"active"),emailVerifiedAt:user.email_verified_at||customer.email_verified_at||null};
}
