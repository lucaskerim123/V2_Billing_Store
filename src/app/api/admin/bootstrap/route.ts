import {createClient} from "@supabase/supabase-js";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||"";

export async function GET(){
  if(!url||!serviceKey)return Response.json({error:"Supabase server configuration is incomplete."},{status:500});
  const db=createClient(url,serviceKey,{auth:{persistSession:false}});
  const {data,error}=await db.rpc("admin_bootstrap_status");
  if(error)return Response.json({error:error.message},{status:500});
  return Response.json(data||{available:false,staff_count:0});
}

export async function POST(req:Request){
  if(!url||!serviceKey)return Response.json({error:"Supabase server configuration is incomplete."},{status:500});
  const body=await req.json().catch(()=>({}));
  const email=String(body.email||"").trim().toLowerCase();
  const password=String(body.password||"");
  const name=String(body.name||"").trim();
  if(!email||!email.includes("@"))return Response.json({error:"Enter a valid email address."},{status:400});
  if(password.length<8)return Response.json({error:"Password must be at least 8 characters."},{status:400});
  if(name.length<2)return Response.json({error:"Enter your name."},{status:400});

  const db=createClient(url,serviceKey,{auth:{persistSession:false}});
  const {data:status,error:statusError}=await db.rpc("admin_bootstrap_status");
  if(statusError)return Response.json({error:statusError.message},{status:500});
  if(!status?.available)return Response.json({error:"Initial admin setup has already been completed."},{status:409});

  const {data:created,error:createError}=await db.auth.admin.createUser({
    email,
    password,
    email_confirm:true,
    user_metadata:{display_name:name,first_name:name}
  });
  if(createError||!created.user)return Response.json({error:createError?.message||"Could not create the administrator account."},{status:400});

  const userId=created.user.id;
  try{
    const {error:profileError}=await db.from("user_profiles").upsert({
      id:userId,role:"superadmin",status:"active",display_name:name,email_verified_at:new Date().toISOString(),updated_at:new Date().toISOString()
    },{onConflict:"id"});
    if(profileError)throw profileError;

    const {data:result,error:bootstrapError}=await db.rpc("admin_bootstrap_first_admin",{p_user_id:userId,p_title:"System Administrator"});
    if(bootstrapError)throw bootstrapError;
    return Response.json({ok:true,user_id:userId,result,message:"Administrator account created. You can now sign in."});
  }catch(e:any){
    try{await db.auth.admin.deleteUser(userId)}catch{}
    return Response.json({error:e?.message||"Could not finish administrator setup."},{status:500});
  }
}
