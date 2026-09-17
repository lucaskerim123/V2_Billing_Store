import {NextRequest,NextResponse} from "next/server";

const clean=(v:any,n=250)=>String(v??"").slice(0,n);
function clientInfo(ua:string){const s=ua||"";const browser=/Edg\//.test(s)?"Edge":/Chrome\//.test(s)?"Chrome":/Firefox\//.test(s)?"Firefox":/Safari\//.test(s)&&!/Chrome\//.test(s)?"Safari":"Other";const os=/Windows/.test(s)?"Windows":/Android/.test(s)?"Android":/iPhone|iPad|iOS/.test(s)?"iOS":/Mac OS X/.test(s)?"macOS":/Linux/.test(s)?"Linux":"Other";const device=/Mobile|Android|iPhone/.test(s)?"mobile":/iPad|Tablet/.test(s)?"tablet":"desktop";return {browser,os,device}}

export async function POST(req:NextRequest){
 const auth=req.headers.get("authorization")||"";if(!auth.startsWith("Bearer "))return NextResponse.json({error:"Unauthorized"},{status:401});
 const token=auth.slice(7),url=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://bealqgenrcytjzjoikmk.supabase.co",key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
 const u=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,authorization:`Bearer ${token}`}});if(!u.ok)return NextResponse.json({error:"Unauthorized"},{status:401});const user=await u.json();
 const body=await req.json().catch(()=>({}));const eventType=clean(body.eventType||"activity",80),ua=clean(req.headers.get("user-agent"),1000),ip=clean((req.headers.get("x-forwarded-for")||req.headers.get("x-real-ip")||"").split(",")[0].trim(),80)||null;
 const requestId=clean(req.headers.get("x-vercel-id")||req.headers.get("x-request-id")||crypto.randomUUID(),180),detail={...(body.detail&&typeof body.detail==="object"?body.detail:{}),...clientInfo(ua)};
 const row={auth_user_id:user.id,event_type:eventType,ip_address:ip,user_agent:ua||null,source:clean(body.source||"web",80),route:clean(body.route||req.headers.get("referer")||"",500),entity_type:body.entityType?clean(body.entityType,80):null,entity_id:body.entityId?clean(body.entityId,180):null,success:body.success!==false,request_id:requestId,session_ref:body.sessionRef?clean(body.sessionRef,180):null,detail};
 const r=await fetch(`${url}/rest/v1/account_activity`,{method:"POST",headers:{apikey:key,authorization:`Bearer ${token}`,"content-type":"application/json",prefer:"return=minimal"},body:JSON.stringify(row)});if(!r.ok)return NextResponse.json({error:"Activity could not be recorded."},{status:500});
 if(eventType==="login")await fetch(`${url}/rest/v1/user_profiles?id=eq.${user.id}`,{method:"PATCH",headers:{apikey:key,authorization:`Bearer ${token}`,"content-type":"application/json",prefer:"return=minimal"},body:JSON.stringify({last_login_at:new Date().toISOString(),last_login_ip:ip})});
 return NextResponse.json({ok:true});
}
