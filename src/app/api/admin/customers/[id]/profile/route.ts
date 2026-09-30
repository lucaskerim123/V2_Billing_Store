import {createClient} from "@supabase/supabase-js";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
// Keep the helper parameter tied to the configured service client, rather than
// ReturnType<typeof createClient> (which loses the inferred schema generics).
const serviceClient=()=>createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
type ServiceClient=ReturnType<typeof serviceClient>;
const validId=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const editable=["display_name","first_name","last_name","company_name","phone","address_line1","address_line2","city","state_region","postal_code","country_code","timezone","currency","language","admin_notes","enforcement_notes"] as const;

async function context(req:Request){
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token||!url||!publicKey||!serviceKey)return null;
 const client=createClient(url,publicKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error}=await client.auth.getUser(token);
 if(error||!user)return null;
 const {data:access,error:accessError}=await client.rpc("get_my_staff_access");
 if(accessError)return {error:"Unable to verify staff permissions.",status:403} as const;
 const permissions=access?.permissions||{};
 const canView=permissions.all===true||permissions["customers.view"]===true||permissions["customers.edit"]===true;
 const canEdit=permissions.all===true||permissions["customers.edit"]===true;
 if(!canView)return {error:"Customer access denied.",status:403} as const;
 return {db:serviceClient(),user,canEdit} as const;
}

async function getProfile(db:ServiceClient,id:string){
 const [profile,customer]=await Promise.all([
  db.from("user_profiles").select("*").eq("id",id).maybeSingle(),
  db.from("customers").select("*").or(`auth_user_id.eq.${id},user_id.eq.${id}`).maybeSingle()
 ]);
 if(profile.error)throw Error(profile.error.message);
 if(customer.error)throw Error(customer.error.message);
 return {profile:profile.data,customer:customer.data};
}

export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 if(!validId.test(id))return Response.json({error:"Invalid customer ID."},{status:400});
 const ctx=await context(req);
 if(!ctx)return Response.json({error:"Authentication required."},{status:401});
 if("error" in ctx)return Response.json({error:ctx.error},{status:ctx.status});
 try{
  const {profile,customer}=await getProfile(ctx.db,id);
  if(!customer)return Response.json({error:"Customer record not found."},{status:404});
  if(!profile)return Response.json({error:"This customer is missing its linked user profile. Repair account identity before editing."},{status:409});
  return Response.json({profile,customer},{headers:{"cache-control":"no-store"}});
 }catch(e:any){return Response.json({error:e.message||"Customer could not be loaded."},{status:500})}
}

export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 if(!validId.test(id))return Response.json({error:"Invalid customer ID."},{status:400});
 const ctx=await context(req);
 if(!ctx)return Response.json({error:"Authentication required."},{status:401});
 if("error" in ctx)return Response.json({error:ctx.error},{status:ctx.status});
 if(!ctx.canEdit)return Response.json({error:"Customer editing permission required."},{status:403});
 const submitted=await req.json().catch(()=>null);
 if(!submitted||typeof submitted!=="object"||Array.isArray(submitted))
  return Response.json({error:"Invalid customer profile."},{status:400});
 const patch:Record<string,string|null>={};
 for(const key of editable){
  if(Object.prototype.hasOwnProperty.call(submitted,key)){
   const value=submitted[key];
   if(value!==null&&typeof value!=="string")return Response.json({error:`Invalid ${key} value.`},{status:400});
   const normalized=typeof value==="string"?value.trim():null;
   if(normalized&&normalized.length>(key==="admin_notes"||key==="enforcement_notes"?10000:500))
    return Response.json({error:`${key} is too long.`},{status:400});
   patch[key]=normalized||null;
  }
 }
 if(!Object.keys(patch).length)return Response.json({error:"No editable fields provided."},{status:400});
 try{
  const before=await getProfile(ctx.db,id);
  if(!before.customer||!before.profile)return Response.json({error:"Customer or linked profile missing. No changes made."},{status:409});
  const {data:profile,error}=await ctx.db.from("user_profiles").update(patch).eq("id",id).select("*").maybeSingle();
  if(error)return Response.json({error:error.message},{status:500});
  if(!profile)return Response.json({error:"No profile row was updated. Your changes were not saved."},{status:409});
  const {customer}=await getProfile(ctx.db,id);
  if(!customer)return Response.json({error:"Updated the profile, but its customer record is missing. Contact an administrator."},{status:500});
  const synced=["display_name","first_name","last_name","company_name","phone","address_line1","address_line2","city","state_region","postal_code","country_code","timezone","currency","language"].filter(k=>k in patch);
  const inconsistent=synced.filter(key=>String((customer as Record<string,unknown>)[key]??"")!==String((profile as Record<string,unknown>)[key]??""));
  if(inconsistent.length){
    // Do not claim success while the customer-facing profile is stale.
    return Response.json({error:`Profile changed, but customer synchronization failed for: ${inconsistent.join(", ")}. Refresh and contact an administrator.`},{status:500});
  }
  await ctx.db.from("admin_audit_log").insert({actor_id:ctx.user.id,action:"customer.profile.updated",target_type:"customer",target_id:id,detail:{fields:Object.keys(patch)}});
  return Response.json({ok:true,profile,customer},{headers:{"cache-control":"no-store"}});
 }catch(e:any){return Response.json({error:e.message||"Customer update failed."},{status:500})}
}
