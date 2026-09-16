import {issueEmailVerification} from "@/lib/email-verification-server";
import {createClient} from "@supabase/supabase-js";
import {setOrbitPassword} from "@/lib/orbitfs-auth-server";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db=()=>createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const validUsername=(value:string)=>/^[A-Za-z0-9._-]{3,32}$/.test(value);

export async function POST(req:Request){
 const body=await req.json().catch(()=>({}));
 const email=String(body.email||"").trim().toLowerCase(),password=String(body.password||""),username=String(body.username||"").trim();
 if(!validUsername(username))return Response.json({error:"Username must be 3–32 characters using letters, numbers, dots, underscores or hyphens."},{status:400});
 if(!email||!email.includes("@")||password.length<8)return Response.json({error:"Enter a valid email and a password with at least 8 characters."},{status:400});
 const client=db(),now=new Date().toISOString();
 const {data:existing}=await client.from("users").select("id,email,username,display_name,first_name,status,email_verified_at").ilike("email",email).maybeSingle();
 if(existing){
  const {data:customer}=await client.from("customers").select("id").eq("user_id",existing.id).maybeSingle();
  if(customer)return Response.json({error:"An OrbitFS account already exists for that email address."},{status:409});
  const {data:credential}=await client.from("customer_credentials").select("user_id").eq("user_id",existing.id).maybeSingle();
  if(!credential)return Response.json({error:"This email already belongs to an OrbitFS staff account. Sign in with the existing account or have a staff administrator enable its customer profile."},{status:409});
  const {data:createdCustomer,error}=await client.from("customers").insert({
   user_id:existing.id,email,name:existing.display_name||existing.first_name||username,
   username:existing.username||username,display_name:existing.display_name||existing.first_name||username,status:"active",
   email_verified_at:existing.email_verified_at,metadata:{registration_source:"public_existing_user"},updated_at:now
  }).select("id").single();
  if(error||!createdCustomer)return Response.json({error:error?.message||"Could not attach the customer profile."},{status:500});
  return Response.json({ok:true,user_id:existing.id,customer_id:createdCustomer.id,message:"Your existing OrbitFS account is now enabled as a customer account."});
 }

 const {data:user,error:userError}=await client.from("users").insert({email,username,display_name:username,status:"pending",updated_at:now}).select("id").single();
 if(userError||!user)return Response.json({error:userError?.message||"Could not create account."},{status:500});
 try{
  await setOrbitPassword(user.id,password);
  const {error:customerError}=await client.from("customers").insert({
   user_id:user.id,email,name:username,username,display_name:username,status:"active",
   email_verified_at:null,metadata:{registration_source:"public"},updated_at:now
  });
  if(customerError)throw customerError;
  await client.from("users").update({status:"active",updated_at:now}).eq("id",user.id);
  const ip=(req.headers.get("x-forwarded-for")||"").split(",")[0].trim()||null;
  await issueEmailVerification({id:user.id,email,name:username},new URL(req.url).origin,ip);
  try{await client.from("admin_audit_log").insert({actor_id:null,action:"customer.registered",target_type:"customer",target_id:user.id,detail:{email,username,verification:"orbitfs"}})}catch{}
  return Response.json({ok:true,user_id:user.id,message:"Account created. Check your email for the OrbitFS verification link before signing in."});
 }catch(e:any){
  await client.from("customer_sessions").delete().eq("user_id",user.id);
  await client.from("customer_credentials").delete().eq("user_id",user.id);
  await client.from("customers").delete().eq("user_id",user.id);
  await client.from("users").delete().eq("id",user.id);
  console.error("OrbitFS registration failed",e);
  return Response.json({error:e?.message||"Could not create OrbitFS account."},{status:500});
 }
}
