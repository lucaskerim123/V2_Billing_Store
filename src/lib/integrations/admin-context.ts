import {createClient} from "@supabase/supabase-js";

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const SUPABASE_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";

export type IntegrationAccess={
  permissions?:Record<string,boolean>|string[];
  all?:boolean;
  is_staff?:boolean;
};

export function hasIntegrationPermission(access:IntegrationAccess|undefined,key:string){
  const permissions=access?.permissions;
  if(access?.all===true)return true;
  if(Array.isArray(permissions))return permissions.includes("*")||permissions.includes(key);
  return !!permissions?.all||!!permissions?.[key];
}

export async function requireIntegrationAdmin(req:Request,required:string[]=["integrations.view"]){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token)throw Object.assign(new Error("Authentication required."),{status:401});
  if(!SUPABASE_URL||!SUPABASE_KEY)throw Object.assign(new Error("Billing Store Supabase configuration is missing."),{status:503});
  const db=createClient(SUPABASE_URL,SUPABASE_KEY,{
    global:{headers:{Authorization:`Bearer ${token}`}},
    auth:{persistSession:false,autoRefreshToken:false}
  });
  const {data:{user},error}=await db.auth.getUser(token);
  if(error||!user)throw Object.assign(new Error("Invalid administrator session."),{status:401});
  const {data,error:accessError}=await db.rpc("get_my_staff_access");
  if(accessError)throw Object.assign(new Error(accessError.message),{status:403});
  const access=(Array.isArray(data)?data[0]:data)||{};
  if(!required.some(key=>hasIntegrationPermission(access,key))){
    throw Object.assign(new Error("Integration Manager permission required."),{status:403});
  }
  return {db,user,access,token};
}

export function integrationErrorResponse(error:unknown,fallback:string){
  const e=error as {message?:string;status?:number};
  return Response.json({error:e?.message||fallback},{status:e?.status||500,headers:{"cache-control":"no-store"}});
}
