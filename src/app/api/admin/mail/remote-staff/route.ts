import {createClient} from "@supabase/supabase-js";
import {listBillingRemoteStaff,syncBillingRemoteStaff,terminateBillingRemoteStaff} from "@/modules/mail-configuration/billing-sync";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
async function context(req:Request){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\\s+/i,"");
  if(!token||!url||!publicKey)return null;
  const db=createClient(url,publicKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await db.auth.getUser(token);
  if(error||!user)return null;
  const {data:access,error:accessError}=await db.rpc("get_my_staff_access");
  if(accessError)return {error:"Unable to verify staff permissions.",status:403} as const;
  const permissions=access?.permissions||{};
  if(permissions.all!==true&&permissions["communications.mail.manage"]!==true)
    return {error:"Mail configuration management permission required.",status:403} as const;
  return {user} as const;
}
export async function GET(req:Request){
  const ctx=await context(req);
  if(!ctx)return Response.json({error:"Authentication required."},{status:401});
  if("error" in ctx)return Response.json({error:ctx.error},{status:ctx.status});
  try{return Response.json({staff:await listBillingRemoteStaff()},{headers:{"cache-control":"no-store"}})}
  catch(error:any){return Response.json({error:error?.message||"Could not load Billing staff."},{status:500})}
}
export async function POST(req:Request){
  const ctx=await context(req);
  if(!ctx)return Response.json({error:"Authentication required."},{status:401});
  if("error" in ctx)return Response.json({error:ctx.error},{status:ctx.status});
  const body=await req.json().catch(()=>({}));
  const userId=typeof body.external_user_id==="string"?body.external_user_id:"";
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId))
    return Response.json({error:"A valid Billing staff identity is required."},{status:400});
  try{
    if(body.action==="sync"){
      const result=await syncBillingRemoteStaff(userId);
      return Response.json({ok:true,result});
    }
    if(body.action==="terminate"){
      const staff=(await listBillingRemoteStaff()).find(x=>x.external_user_id===userId);
      if(staff?.status==="active")return Response.json({error:"Disable or remove this staff member in Billing before terminating the Remote User."},{status:409});
      const result=await terminateBillingRemoteStaff(userId,typeof body.reason==="string"?body.reason.slice(0,500):"Billing staff access removed");
      return Response.json({ok:true,result});
    }
    return Response.json({error:"Unknown Remote Staff action."},{status:400});
  }catch(error:any){return Response.json({error:error?.message||"Remote Staff operation failed."},{status:502})}
}
