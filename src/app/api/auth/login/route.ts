import {createClient} from "@supabase/supabase-js";
import {authenticateOrbitUser,createOrbitSession} from "@/lib/orbitfs-auth-server";
import {setCustomerCredentialPassword} from "@/lib/customer-auth-server";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY!;
const service=()=>createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

export const runtime="nodejs";

export async function POST(req:Request){
 const body=await req.json().catch(()=>({}));
 const email=String(body.email||"").trim().toLowerCase(),password=String(body.password||"");
 if(!email||!password)return Response.json({error:"Enter your email and password."},{status:400});

 let user=await authenticateOrbitUser(email,password);
 if(!user){
  // One-time compatibility bridge for existing staff/customer accounts. The application
  // identity is still created in public.users and the password is copied into Store-owned
  // customer_credentials. New logins do not use Supabase Auth.
  const legacy=service();
  const {data:legacyLogin}=await legacy.auth.signInWithPassword({email,password});
  if(legacyLogin?.user){
   const legacyUser=legacyLogin.user;
   const {data:existingById}=await legacy.from("users").select("id,email,username,display_name,first_name,status,email_verified_at").eq("id",legacyUser.id).maybeSingle();
   const {data:existingByEmail}=existingById?{data:null}:{data:await legacy.from("users").select("id,email,username,display_name,first_name,status,email_verified_at").ilike("email",email).maybeSingle()};
   const existing=existingById||existingByEmail?.data||null;
   if(existing){
    user=existing;
   }else{
    const {data:customer}=await legacy.from("customers").select("email,username,display_name,name,first_name,status,email_verified_at").eq("auth_user_id",legacyUser.id).maybeSingle();
    const {data:created,error}=await legacy.from("users").insert({
     id:legacyUser.id,email:email,username:customer?.username||legacyUser.user_metadata?.username||null,
     display_name:customer?.display_name||customer?.name||legacyUser.user_metadata?.display_name||email,
     first_name:customer?.first_name||null,status:customer?.status||"active",email_verified_at:customer?.email_verified_at||new Date().toISOString()
    }).select("id,email,username,display_name,first_name,status,email_verified_at").single();
    if(error){
     if(error.code==="23505"){
      const {data:recovered}=await legacy.from("users").select("id,email,username,display_name,first_name,status,email_verified_at").ilike("email",email).maybeSingle();
      if(!recovered)return Response.json({error:"Could not migrate the existing account into the OrbitFS user system."},{status:500});
      user=recovered;
     }else{
      return Response.json({error:"Could not migrate the existing account into the OrbitFS user system."},{status:500});
     }
    }else{
     user=created;
    }
   }
   const {data:customerForLink}=await legacy.from("customers").select("id,user_id,auth_user_id").or(`user_id.eq.${user.id},auth_user_id.eq.${legacyUser.id}`).maybeSingle();
   if(customerForLink?.id&&customerForLink.user_id!==user.id){
    await legacy.from("customers").update({user_id:user.id,updated_at:new Date().toISOString()}).eq("id",customerForLink.id);
   }
   const migrated=await setCustomerCredentialPassword(user.id,password);
   if(!migrated.ok){
    console.error("[auth/login] legacy account migration failed",migrated.error);
    return Response.json({error:"Could not migrate the existing account into the OrbitFS user system.",detail:migrated.error},{status:500});
   }
   await legacy.auth.signOut();
  }
 }
 if(!user)return Response.json({error:"Invalid email or password."},{status:401});
 if(!user.email_verified_at)return Response.json({error:"Verify your email address before signing in."},{status:403});
 await createOrbitSession(user.id,req);
 return Response.json({ok:true,user:{id:user.id,email:user.email,display_name:user.display_name||user.first_name||user.email}});
}
