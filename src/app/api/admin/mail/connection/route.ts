import {createClient} from "@supabase/supabase-js";
import {verifyMailSystemConnection} from "@/modules/mail-configuration/client";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";

export async function GET(req:Request){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\\s+/i,"");
  if(!token||!url||!publicKey)return Response.json({error:"Authentication required."},{status:401});
  const db=createClient(url,publicKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await db.auth.getUser(token);
  if(error||!user)return Response.json({error:"Invalid administrator session."},{status:401});
  const {data:access,error:accessError}=await db.rpc("get_my_staff_access");
  if(accessError)return Response.json({error:"Unable to verify staff permissions."},{status:403});
  const permissions=access?.permissions||{};
  if(permissions.all!==true&&permissions["communications.mail.manage"]!==true)
    return Response.json({error:"Mail configuration management permission required."},{status:403});
  const result=await verifyMailSystemConnection();
  return Response.json(result,{headers:{"cache-control":"no-store"}});
}
