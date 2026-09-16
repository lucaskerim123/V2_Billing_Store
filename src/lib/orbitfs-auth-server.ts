import {createHash,randomBytes} from "node:crypto";
import {cookies} from "next/headers";
import {createClient} from "@supabase/supabase-js";
import {hashCustomerPassword,verifyCustomerPassword} from "@/lib/customer-auth-server";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SESSION_COOKIE="orbitfs_session";
const SESSION_DAYS=30;
const db=()=>createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const hashToken=(token:string)=>createHash("sha256").update(token).digest("hex");

export type OrbitUser={id:string;email:string;username:string|null;displayName:string;status:string;customerId:string|null;staff:boolean;staffRole:string|null;permissions:Record<string,boolean>};

export async function createOrbitSession(userId:string,request?:Request){
 const raw=randomBytes(48).toString("base64url"),now=new Date(),expires=new Date(now.getTime()+SESSION_DAYS*86400000);
 const {error}=await db().from("customer_sessions").insert({user_id:userId,token_hash:hashToken(raw),expires_at:expires.toISOString(),ip_address:(request?.headers.get("x-forwarded-for")||"").split(",")[0].trim()||null,user_agent:request?.headers.get("user-agent")||null});
 if(error)throw error;
 const jar=await cookies();
 jar.set(SESSION_COOKIE,raw,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",expires});
 return raw;
}
export async function clearOrbitSession(){const jar=await cookies(),token=jar.get(SESSION_COOKIE)?.value;if(token)await db().from("customer_sessions").update({revoked_at:new Date().toISOString()}).eq("token_hash",hashToken(token)).is("revoked_at",null);jar.delete(SESSION_COOKIE);}
export async function getOrbitUser():Promise<OrbitUser|null>{
 const jar=await cookies(),token=jar.get(SESSION_COOKIE)?.value;if(!token)return null;
 const client=db(),now=new Date().toISOString();
 const {data:session,error:sessionError}=await client.from("customer_sessions").select("user_id,expires_at,revoked_at").eq("token_hash",hashToken(token)).maybeSingle();
 if(sessionError||!session||session.revoked_at||String(session.expires_at)<=now)return null;
 const {data:user}=await client.from("users").select("id,email,username,display_name,first_name,status,email_verified_at").eq("id",session.user_id).maybeSingle();
 if(!user||user.status!=="active")return null;
 const {data:customer}=await client.from("customers").select("id").eq("user_id",user.id).maybeSingle();
 const {data:staff}=await client.from("staff_access").select("enabled,role,permissions").eq("user_id",user.id).maybeSingle();
 await client.from("customer_sessions").update({last_seen_at:now}).eq("token_hash",hashToken(token)).is("revoked_at",null);
 return {id:user.id,email:String(user.email),username:user.username||null,displayName:String(user.display_name||user.first_name||user.email),status:String(user.status),customerId:customer?.id?String(customer.id):null,staff:!!staff?.enabled,staffRole:staff?.enabled?String(staff.role):null,permissions:(staff?.enabled&&staff.permissions&&typeof staff.permissions==="object"?staff.permissions:{}) as Record<string,boolean>};
}
export async function authenticateOrbitUser(email:string,password:string){const client=db(),normalized=email.trim().toLowerCase();const {data:user}=await client.from("users").select("id,email,username,display_name,first_name,status,email_verified_at").ilike("email",normalized).maybeSingle();if(!user||user.status!=="active")return null;const {data:credential}=await client.from("customer_credentials").select("password_hash").eq("user_id",user.id).maybeSingle();if(!credential?.password_hash||!verifyCustomerPassword(password,String(credential.password_hash)))return null;return user;}
export async function setOrbitPassword(userId:string,password:string){const now=new Date().toISOString(),client=db(),passwordHash=hashCustomerPassword(password);const {error}=await client.from("customer_credentials").upsert({user_id:userId,password_hash:passwordHash,password_changed_at:now,updated_at:now},{onConflict:"user_id"});if(error)throw error;await client.from("customer_sessions").update({revoked_at:now}).eq("user_id",userId).is("revoked_at",null);}
export async function requireOrbitUser(){const user=await getOrbitUser();if(!user)throw Object.assign(new Error("Authentication required."),{status:401});return user;}
export async function requireOrbitStaff(){const user=await requireOrbitUser();if(!user.staff)throw Object.assign(new Error("Staff access required."),{status:403});return user;}
