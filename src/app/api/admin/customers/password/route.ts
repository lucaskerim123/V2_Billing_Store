import {createClient} from "@supabase/supabase-js";
import {setCustomerPasswordByAdmin} from "@/lib/password-reset-server";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req:Request){
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)return Response.json({error:"Authentication required."},{status:401});
 const db=createClient(url,publicKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
 const {data:{user}}=await db.auth.getUser(token);if(!user)return Response.json({error:"Invalid session."},{status:401});
 const {data:access,error:accessError}=await db.rpc("get_my_staff_access");
 const row:any=Array.isArray(access)?access[0]:access;
 const role=String(row?.primary_role||row?.role||"").toLowerCase();
 if(accessError||role!=="superadmin")return Response.json({error:"Superadmin access required."},{status:403});

 const body=await req.json().catch(()=>({})),userId=String(body.userId||""),password=String(body.password??"");
 if(!uuid.test(userId))return Response.json({error:"Valid customer ID required."},{status:400});
 if(password.length<8)return Response.json({error:"Password must be at least 8 characters."},{status:400});
 if(password.length>128)return Response.json({error:"Password must be 128 characters or fewer."},{status:400});

 const result=await setCustomerPasswordByAdmin(userId,password,user.id);
 if("error" in result){
  const error=String(result.error||"Could not update customer password.");
  return Response.json({error},{status:error==="Customer account not found."?404:400});
 }
 return Response.json({ok:true,message:`Password updated for ${result.email}.`});
}
