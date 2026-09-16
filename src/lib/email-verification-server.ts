import {createHash,randomBytes} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {sendAutomation} from "@/lib/transactional-server";
import {orbitfsStoreOrigin} from "@/lib/site-origin";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY!;
const service=()=>createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const hash=(token:string)=>createHash("sha256").update(token).digest("hex");

export async function issueEmailVerification(user:{id:string,email:string,name:string},origin:string,requestIp?:string|null){
 const db=service(),expiresHours=24;
 const {data:recent}=await db.from("orbitfs_email_verification_tokens").select("created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(1).maybeSingle();
 if(recent?.created_at&&Date.now()-new Date(recent.created_at).getTime()<60_000)return {ok:true,throttled:true};
 const token=randomBytes(32).toString("base64url"),tokenHash=hash(token),now=new Date().toISOString();
 await db.from("orbitfs_email_verification_tokens").update({used_at:now}).eq("user_id",user.id).is("used_at",null);
 const {error}=await db.from("orbitfs_email_verification_tokens").insert({user_id:user.id,token_hash:tokenHash,expires_at:new Date(Date.now()+expiresHours*3600_000).toISOString(),request_ip:requestIp||null});
 if(error)throw error;
 const site=await orbitfsStoreOrigin(origin),verificationUrl=`${site}/verify-email?token=${encodeURIComponent(token)}`;
 await sendAutomation("account.email_verification",user.email,{customer_name:user.name,verification_url:verificationUrl,expires_hours:String(expiresHours)},"customer",user.id);
 return {ok:true};
}

export async function completeEmailVerification(token:string){
 const db=service(),tokenHash=hash(token);
 const {data:row,error}=await db.from("orbitfs_email_verification_tokens").select("id,user_id,expires_at,used_at").eq("token_hash",tokenHash).maybeSingle();
 if(error||!row||row.used_at||new Date(row.expires_at).getTime()<Date.now())return {ok:false,error:"This verification link is invalid or has expired."};
 const verifiedAt=new Date().toISOString();
 const {error:updateUser}=await db.from("users").update({email_verified_at:verifiedAt,status:"active",updated_at:verifiedAt}).eq("id",row.user_id);
 if(updateUser)return {ok:false,error:updateUser.message};
 await db.from("customers").update({email_verified_at:verifiedAt,updated_at:verifiedAt}).eq("user_id",row.user_id);
 await db.from("user_profiles").update({email_verified_at:verifiedAt,updated_at:verifiedAt}).eq("user_id",row.user_id);
 await db.from("orbitfs_email_verification_tokens").update({used_at:verifiedAt}).eq("id",row.id);
 return {ok:true};
}

export async function resolveVerificationUser(email:string){
 const db=service(),normalized=email.trim().toLowerCase();
 const {data:u}=await db.from("users").select("id,email,display_name,first_name,email_verified_at").ilike("email",normalized).maybeSingle();
 if(!u?.email||u.email_verified_at)return null;
 return {id:String(u.id),email:String(u.email),name:String(u.display_name||u.first_name||"Customer")};
}
