import {createClient} from "@supabase/supabase-js";
import {syncBillingRemoteStaff} from "@/modules/mail-configuration/billing-sync";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||"";

export async function POST(req:Request){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\\s+/i,"");
  if(!token||!url||!publicKey||!serviceKey)return Response.json({error:"Authentication required."},{status:401});
  const auth=createClient(url,publicKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await auth.auth.getUser(token);
  if(error||!user)return Response.json({error:"Invalid session."},{status:401});
  const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:staff,error:staffError}=await service.from("staff_members").select("user_id,status").eq("user_id",user.id).maybeSingle();
  if(staffError)return Response.json({error:"Could not verify activated staff access."},{status:500});
  if(!staff||staff.status!=="active")return Response.json({error:"Active staff membership is required."},{status:403});
  try{
    const result=await syncBillingRemoteStaff(user.id);
    return Response.json({ok:true,result});
  }catch(error:any){return Response.json({error:error?.message||"Remote Staff sync failed."},{status:502});}
}
