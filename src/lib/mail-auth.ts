import {createClient} from "@supabase/supabase-js";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://bealqgenrcytjzjoikmk.supabase.co";
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";

export async function requireMailUser(req:Request){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return {error:Response.json({error:"Authentication required."},{status:401})};
  const db=createClient(url,publicKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
  const {data:{user},error}=await db.auth.getUser(token);
  if(error||!user)return {error:Response.json({error:"Invalid session."},{status:401})};
  const {data:authCtx,error:ctxError}=await db.rpc("mail_auth_context");
  if(ctxError)return {error:Response.json({error:ctxError.message},{status:500})};
  const role=authCtx?.role||"user";
  const permissions=authCtx?.permissions||{};
  const anyMail=permissions.all||permissions["mail.view"]||permissions["mail.admin"]||permissions["mail.admin.send"]||permissions["mail.settings"]||permissions["mail.templates"]||permissions["mail.queue.view"]||permissions["mail.queue.manage"];
  if(!anyMail)return {error:Response.json({error:"Mail access denied."},{status:403})};
  return {user,db,service:db,role,permissions};
}

export async function canUseMailbox(ctx:any,address:string,send=false){
  const {data,error}=await ctx.db.rpc("mail_can_use_address",{p_address:address,p_send:send});
  return !error&&data===true;
}

export function isMailAdmin(ctx:any,permission="mail.admin"){
  if(ctx.permissions.all)return true;
  if(permission==="mail.admin")return !!ctx.permissions["mail.admin"];
  return !!ctx.permissions[permission];
}
