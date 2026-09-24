import {createClient} from "@supabase/supabase-js";
import {issuePasswordReset,resolveResetUser} from "@/lib/password-reset-server";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";

export async function POST(req:Request){
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)return Response.json({error:"Authentication required."},{status:401});
 const db=createClient(url,publicKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
 const {data:{user}}=await db.auth.getUser(token);if(!user)return Response.json({error:"Invalid session."},{status:401});
 const {data:access}=await db.rpc("get_my_staff_access"),p:any=access?.permissions||{};
 if(!p.all&&!p["customers.password_reset"]&&!p["customers.edit"])return Response.json({error:"Permission denied."},{status:403});
 const body=await req.json().catch(()=>({}));
 let email=String(body.email||"").trim().toLowerCase();
 if(!email&&body.userId){const {data:e}=await db.rpc("admin_get_customer_email",{p_user_id:String(body.userId)});email=String(e||"").trim().toLowerCase()}
 if(!email)return Response.json({error:"Customer email unavailable."},{status:400});
 const target=await resolveResetUser(email);if(!target)return Response.json({error:"Customer account not found."},{status:404});
 await issuePasswordReset(target,new URL(req.url).origin,user.id,(req.headers.get("x-forwarded-for")||"").split(",")[0].trim()||null);
 return Response.json({ok:true,email:target.email,message:`Password reset email sent to ${target.email}.`});
}
