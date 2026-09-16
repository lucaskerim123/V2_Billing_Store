import {createHash,randomBytes} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {sendAutomation} from "@/lib/transactional-server";
import {orbitfsStoreOrigin} from "@/lib/site-origin";
import {setCustomerCredentialPassword} from "@/lib/customer-auth-server";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY!;
const service=()=>createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const hash=(token:string)=>createHash("sha256").update(token).digest("hex");

export async function resolveResetUser(email:string){
 const db=service(),normalized=email.trim().toLowerCase();
 const {data:user,error}=await db.from("users").select("id,email,display_name,first_name,username,email_verified_at,status").ilike("email",normalized).maybeSingle();
 if(error||!user?.id||!user.email)return null;
 const {data:customer}=await db.from("customers").select("id").eq("user_id",user.id).maybeSingle();
 if(!customer?.id)return null;
 return {id:String(user.id),email:String(user.email),name:String(user.display_name||user.first_name||user.username||"Customer")};
}

export async function issuePasswordReset(user:{id:string,email:string,name:string},origin:string,requestedBy?:string|null,requestIp?:string|null){
 const db=service(),expiresMinutes=30;
 if(!requestedBy){
  const {data:recent}=await db.from("orbitfs_password_reset_tokens").select("created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(recent?.created_at&&Date.now()-new Date(recent.created_at).getTime()<60_000)return {ok:true,throttled:true};
 }
 const token=randomBytes(32).toString("base64url"),tokenHash=hash(token),now=new Date().toISOString();
 await db.from("orbitfs_password_reset_tokens").update({used_at:now}).eq("user_id",user.id).is("used_at",null);
 const {error}=await db.from("orbitfs_password_reset_tokens").insert({user_id:user.id,token_hash:tokenHash,expires_at:new Date(Date.now()+expiresMinutes*60_000).toISOString(),requested_by:requestedBy||null,request_ip:requestIp||null});
 if(error)throw error;
 const site=await orbitfsStoreOrigin(origin);
 const resetUrl=`${site}/reset-password?token=${encodeURIComponent(token)}`;
 // OrbitFS Mail owns the account recovery message. Resend is only the transport provider.
 await sendAutomation("account.password_reset",user.email,{customer_name:user.name,reset_url:resetUrl,expires_minutes:String(expiresMinutes)},"account",user.id);
 return {ok:true};
}

export async function completePasswordReset(token:string,password:string){
 const db=service(),tokenHash=hash(token);
 const {data:row,error}=await db.from("orbitfs_password_reset_tokens").select("id,user_id,expires_at,used_at").eq("token_hash",tokenHash).maybeSingle();
 if(error||!row||row.used_at||new Date(row.expires_at).getTime()<Date.now())return {ok:false,error:"This reset link is invalid or has expired."};
 const updated=await setCustomerCredentialPassword(String(row.user_id),password);
 if(!updated.ok)return {ok:false,error:updated.error};
 const now=new Date().toISOString();
 await db.from("orbitfs_password_reset_tokens").update({used_at:now}).eq("id",row.id);
 await db.from("users").update({email_verified_at:now,updated_at:now}).eq("id",row.user_id).is("email_verified_at",null);
 await db.from("customers").update({email_verified_at:now,updated_at:now}).eq("user_id",row.user_id).is("email_verified_at",null);
 await db.from("user_profiles").update({email_verified_at:now,updated_at:now}).eq("user_id",row.user_id).is("email_verified_at",null);
 try{await db.from("admin_audit_log").insert({actor_id:null,action:"account.password_reset_completed",target_type:"customer",target_id:row.user_id,detail:{source:"orbitfs_reset",credential_store:"orbitfs",mail_system:"orbitfs_mail"}})}catch{}
 return {ok:true};
}

export async function setCustomerPasswordByAdmin(userId:string,password:string,actorId:string){
 const db=service(),updated=await setCustomerCredentialPassword(userId,password);
 if(!updated.ok)return updated;
 await db.from("orbitfs_password_reset_tokens").update({used_at:new Date().toISOString()}).eq("user_id",updated.userId).is("used_at",null);
 try{await db.from("admin_audit_log").insert({actor_id:actorId,action:"customer.password_set_by_superadmin",target_type:"customer",target_id:updated.userId,detail:{customer_id:updated.customerId,customer_email:updated.email,source:"admin_customer_security",credential_store:"orbitfs",mail_system:"orbitfs_mail"}})}catch{}
 return {ok:true,email:updated.email};
}
