import {createClient} from "@supabase/supabase-js";
import {syncAccountEnforcementNow} from "@/lib/account-enforcement-sync";
import {accountEnforcementAllowsExpiry,canReactivateAccountEnforcement,normalizeAccountEnforcementState} from "@/lib/account-enforcement-state";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
const validId=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function permissionValue(access:any,key:string){
  const row=Array.isArray(access)?access[0]:access;
  const permissions=row?.permissions;
  if(permissions?.all===true)return true;
  if(Array.isArray(permissions))return permissions.includes(key);
  return Boolean(permissions?.[key]);
}

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  if(!validId.test(id))return Response.json({error:"Invalid customer ID."},{status:400});

  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token||!url||!publicKey)return Response.json({error:"Authentication required."},{status:401});
  const db=createClient(url,publicKey,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError}=await db.auth.getUser(token);
  if(userError||!user)return Response.json({error:"Invalid administrator session."},{status:401});
  const {data:access,error:accessError}=await db.rpc("get_my_staff_access");
  if(accessError||!permissionValue(access,"customers.enforce"))return Response.json({error:"Customer enforcement permission required."},{status:403});

  const body=await req.json().catch(()=>({}));
  const state=normalizeAccountEnforcementState(body?.state);
  const reason=String(body?.reason||"").trim();
  const expiresAt=body?.expires_at?String(body.expires_at):null;
  if(state!=="active"&&!reason)return Response.json({error:"Enforcement reason is required."},{status:400});
  if(expiresAt){
    const parsed=new Date(expiresAt);
    if(Number.isNaN(parsed.getTime())||parsed.getTime()<=Date.now())return Response.json({error:"Expiry must be a future date/time."},{status:400});
    if(!accountEnforcementAllowsExpiry(state))return Response.json({error:"Terminated accounts cannot use automatic expiry. Use Suspended for a temporary account block."},{status:400});
  }

  if(state==="active"){
    const {data:current,error:currentError}=await db.rpc("account_enforcement_status",{target_user:id});
    if(currentError)return Response.json({error:currentError.message||"Could not verify current account enforcement."},{status:400});
    const currentState=normalizeAccountEnforcementState(current?.state);
    if(!canReactivateAccountEnforcement(currentState)){
      return Response.json({error:currentState==="terminated"?"Terminated accounts require explicit licence recovery/reactivation. Generic account reactivation is blocked because terminated licences burn their old keys.":"This account is not suspended."},{status:409});
    }
  }

  const legacyState=state==="terminated"?"banned":state;
  const {data:local,error:localError}=await db.rpc("admin_set_account_enforcement_v2",{
    target_user:id,
    new_state:legacyState,
    why:state==="active"?null:reason,
    expires_at:state==="active"?null:expiresAt
  });
  if(localError)return Response.json({error:localError.message||"Account enforcement failed."},{status:400});

  const authority=await syncAccountEnforcementNow({
    authUserId:id,
    state,
    reason,
    actorRef:"billing_store_account_enforcement:"+user.id
  }).catch((error:any)=>({ok:false,state,processed:0,failed:1,skipped:0,results:[],failures:[{error:String(error?.message||error)}],skippedBindings:[]}));

  const authoritySynced=authority.ok===true;
  return Response.json({
    ok:true,
    state,
    local,
    authoritySynced,
    retryQueued:!authoritySynced,
    authority,
    message:authoritySynced
      ?state==="active"?"Account reactivated and License Manager restored immediately.":state==="terminated"?"Account terminated and License Manager licences terminated immediately.":"Account suspended and License Manager licences suspended immediately."
      :"Account enforcement was applied in Billing. License Manager sync failed for one or more licences and remains queued for retry."
  },{status:authoritySynced?200:202,headers:{"cache-control":"no-store"}});
}
