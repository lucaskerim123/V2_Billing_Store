import {randomBytes,createHash} from "node:crypto";
import {sendAutomation} from "@/lib/transactional-server";
import {createClient} from "@supabase/supabase-js";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";

type Access={permissions?:Record<string,boolean>,is_staff?:boolean,primary_role?:string};
const allowed=(a:Access|undefined,k:string)=>!!a?.permissions?.all||!!a?.permissions?.[k];

async function context(req:Request){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)throw Object.assign(new Error("Authentication required."),{status:401});
  const db=createClient(url,publicKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
  const {data:{user},error}=await db.auth.getUser(token);
  if(error||!user)throw Object.assign(new Error("Invalid session."),{status:401});
  const {data:access,error:ae}=await db.rpc("get_my_staff_access");
  if(ae)throw Object.assign(new Error(ae.message),{status:403});
  return {token,db,user,access:(access||{}) as Access};
}

function cleanPermissions(v:any){const out:Record<string,boolean>={};if(v&&typeof v==="object")for(const [k,x] of Object.entries(v))if(typeof x==="boolean")out[k]=x;return out}
function slugify(v:string){return v.trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,60)}
async function audit(db:any,userId:string,action:string,targetType:string,targetId:string,detail:any){try{await db.from("admin_audit_log").insert({actor_id:userId,action,target_type:targetType,target_id:targetId,detail})}catch{}}
async function staffNotice(userId:string,eventType:string,title:string,message:string,surface:"admin"|"portal"="admin",severity:"info"|"warning"|"error"="info"){
 try{
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)return;
 const service=createClient(url,key,{auth:{persistSession:false}});
 const {error}=await service.rpc("notification_emit",{p_recipient_user_id:userId,p_surface:surface,p_category:"staff",p_event_type:eventType,p_title:title,p_message:message,p_severity:severity,p_source_type:"staff_access",p_source_id:userId,p_action_url:surface==="admin"?"/admin/settings/staff/members":"/portal/settings",p_metadata:{kind:"notification"},p_dedupe_key:eventType+":"+userId+":"+Date.now()});
 if(error)console.error("[staff/notifications] Delivery failed:",error.message);
 }catch(error){console.error("[staff/notifications] Error:",error)}
}


export async function GET(req:Request){
  try{
    const {db,access}=await context(req);
    if(!(allowed(access,"staff.view")||allowed(access,"staff.manage")||allowed(access,"staff.invite")||allowed(access,"staff.groups.view")||allowed(access,"staff.groups.manage")||allowed(access,"settings.permissions")))return Response.json({error:"Permission denied."},{status:403});
    const [{data,error},{data:departments,error:de},{data:deptStaff,error:dse}]=await Promise.all([
      db.rpc("admin_get_staff_snapshot"),
      db.from("support_departments").select("id,name,slug,description,enabled,min_support_rank,sort_order").eq("enabled",true).order("sort_order").order("name"),
      db.from("support_department_staff").select("department_id,user_id")
    ]);
    if(error)return Response.json({error:error.message},{status:400});
    if(de)return Response.json({error:de.message},{status:400});
    if(dse)return Response.json({error:dse.message},{status:400});
    const snap:any=data||{members:[],groups:[],availableCustomers:[],can:{}};
    const byUser=new Map<string,string[]>();
    for(const row of deptStaff||[]){const arr=byUser.get(String(row.user_id))||[];arr.push(String(row.department_id));byUser.set(String(row.user_id),arr)}
    const depMap=new Map((departments||[]).map((d:any)=>[String(d.id),d]));
    snap.members=(snap.members||[]).map((m:any)=>{
      const department_ids=byUser.get(String(m.user_id))||[];
      const department_names=department_ids.map(id=>depMap.get(id)?.name).filter(Boolean);
      return {...m,department_ids,department_names,primary_department_id:department_ids[0]||""};
    });
    snap.departments=departments||[];
    return Response.json(snap);
  }catch(e:any){return Response.json({error:e.message||"Unable to load staff system."},{status:e.status||500})}
}

export async function POST(req:Request){
  try{
    const {token,db,user,access}=await context(req);
    const body=await req.json().catch(()=>({}));
    const action=String(body.action||"member.save");

    if(action==="member.remove"){
      if(!(allowed(access,"staff.manage")||allowed(access,"settings.permissions")))return Response.json({error:"Staff management permission required."},{status:403});
      const target=String(body.user_id||"");if(!target)return Response.json({error:"Missing staff member."},{status:400});
      const {error}=await db.rpc("admin_remove_staff_member",{p_user_id:target});
      if(error)return Response.json({error:error.message},{status:400});
      await staffNotice(target,"staff.access.removed","Staff access removed","Your staff access has been removed. Your customer account remains active.","portal","warning");
      return Response.json({ok:true});
    }

    if(action==="group.create"||action==="group.save"||action==="group.delete"){
      if(!(allowed(access,"staff.groups.manage")||allowed(access,"settings.permissions")))return Response.json({error:"Staff group management permission required."},{status:403});
      if(action==="group.create"){
        const name=String(body.name||"").trim(),description=String(body.description||"").trim();
        if(!name)return Response.json({error:"Group name is required."},{status:400});
        const slug=slugify(name);if(!slug||slug==="superadmin")return Response.json({error:"Choose a different group name."},{status:400});
        const permissions=cleanPermissions(body.permissions);delete permissions.all;
        const {data,error}=await db.from("staff_groups").insert({slug,name,description:description||null,permissions,is_system:false,sort_order:Number(body.sort_order||100)}).select().single();
        if(error)return Response.json({error:error.message},{status:400});
        await audit(db,user.id,"staff.group_created","staff_group",data.id,{slug});
        return Response.json({ok:true,group:data});
      }

      const id=String(body.group_id||"");if(!id)return Response.json({error:"Missing staff group."},{status:400});
      const {data:existing,error:ee}=await db.from("staff_groups").select("*").eq("id",id).single();
      if(ee||!existing)return Response.json({error:"Staff group not found."},{status:404});
      if(existing.slug==="superadmin"&&!allowed(access,"settings.permissions"))return Response.json({error:"Only permission administrators can modify Superadmin."},{status:403});

      if(action==="group.delete"){
        if(existing.is_system)return Response.json({error:"System staff groups cannot be deleted."},{status:400});
        const {count}=await db.from("staff_member_groups").select("user_id",{count:"exact",head:true}).eq("group_id",id);
        if((count||0)>0)return Response.json({error:"Reassign staff members before deleting this group."},{status:400});
        const {error}=await db.from("staff_groups").delete().eq("id",id);if(error)return Response.json({error:error.message},{status:400});
        await audit(db,user.id,"staff.group_deleted","staff_group",id,{slug:existing.slug});
        return Response.json({ok:true});
      }

      let permissions=cleanPermissions(body.permissions);
      if(existing.slug==="superadmin")permissions={...permissions,all:true,"admin.access":true,"settings.permissions":true,"staff.view":true,"staff.manage":true,"staff.invite":true,"staff.groups.view":true,"staff.groups.manage":true};
      else delete permissions.all;
      const patch:any={description:String(body.description||"").trim()||null,permissions,updated_at:new Date().toISOString()};
      if(existing.slug!=="superadmin"&&String(body.name||"").trim())patch.name=String(body.name).trim();
      const {data,error}=await db.from("staff_groups").update(patch).eq("id",id).select().single();if(error)return Response.json({error:error.message},{status:400});
      await audit(db,user.id,"staff.group_updated","staff_group",id,{slug:existing.slug,permission_count:Object.values(permissions).filter(Boolean).length});
      const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
      if(key){const service=createClient(url,key,{auth:{persistSession:false}});const {data:assigned}=await service.from("staff_member_groups").select("user_id").eq("group_id",id);for(const uid of new Set((assigned||[]).map((member:any)=>String(member.user_id))))await staffNotice(uid,"staff.group.permissions_updated","Staff group permissions changed","Your assigned staff group permissions have been updated.","admin","warning");}
      return Response.json({ok:true,group:data});
    }

    if(action!=="member.save")return Response.json({error:"Unknown staff action."},{status:400});
    const requestedGroups:string[]=[...new Set<string>((Array.isArray(body.group_ids)?body.group_ids:[]).map((x:any)=>String(x)).filter(Boolean))];
    if(!requestedGroups.length)return Response.json({error:"Choose at least one staff group."},{status:400});
    const {data:groupRows,error:ge}=await db.from("staff_groups").select("id,slug,name").in("id",requestedGroups);
    if(ge||!groupRows||groupRows.length!==requestedGroups.length)return Response.json({error:ge?.message||"One or more staff groups are invalid."},{status:400});
    if(groupRows.some((g:any)=>g.slug==="superadmin")&&!allowed(access,"settings.permissions"))return Response.json({error:"Only permission administrators can assign Superadmin."},{status:403});

    let target=String(body.existing_user_id||body.user_id||"");
    // New staff membership must be accepted by email, never granted on invitation.
    const {data:existingStaff}=target?await db.from("staff_members").select("user_id").eq("user_id",target).maybeSingle():{data:null};
    if(!existingStaff){
      if(!(allowed(access,"staff.invite")||allowed(access,"settings.permissions")))return Response.json({error:"Staff invite permission required."},{status:403});
      const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
      if(!serviceKey)return Response.json({error:"Staff invitation service is not configured."},{status:503});
      const service=createClient(url,serviceKey,{auth:{persistSession:false}});
      let email=String(body.email||"").trim().toLowerCase();
      if(target){
        const {data:existing,error:lookupError}=await service.auth.admin.getUserById(target);
        if(lookupError||!existing?.user?.email)return Response.json({error:"Customer account not found."},{status:404});
        email=existing.user.email.toLowerCase();
      }
      if(!email||!email.includes("@"))return Response.json({error:"Valid recipient email required."},{status:400});
      const tokenValue=randomBytes(32).toString("hex");
      const tokenHash=createHash("sha256").update(tokenValue).digest("hex");
      const requestedDepartments=[...new Set<string>((Array.isArray(body.department_ids)?body.department_ids:[]).map(String).filter(Boolean))];
      const primaryDepartment=requestedDepartments.includes(String(body.primary_department_id||""))?String(body.primary_department_id):requestedDepartments[0]||null;
      const {data:pending,error:pendingError}=await service.from("staff_invitations").insert({
        email,user_id:target||null,token_hash:tokenHash,group_ids:requestedGroups,
        primary_group_id:requestedGroups.includes(String(body.primary_group_id||""))?String(body.primary_group_id):requestedGroups[0],
        title:String(body.title||""),staff_notes:String(body.staff_notes||""),
        department_ids:requestedDepartments,primary_department_id:primaryDepartment,created_by:user.id
      }).select("id").single();
      if(pendingError||!pending)return Response.json({error:pendingError?.message||"Unable to create invitation."},{status:400});
      try{
        const origin=new URL(req.url).origin;
        const invitationUrl=`${origin}/portal/staff-invite?token=${encodeURIComponent(tokenValue)}`;
        const delivery=await sendAutomation("staff.invite",email,{invite_url:invitationUrl},"staff_invitation",pending.id);
        if("skipped" in delivery && delivery.skipped)throw new Error("Staff invite automation was skipped; no email was sent.");
      }catch(e:any){
        await service.from("staff_invitations").delete().eq("id",pending.id);
        return Response.json({error:e?.message||"Invitation email failed."},{status:502});
      }
      await audit(db,user.id,"staff.invitation_sent","staff_invitation",pending.id,{email,group_count:requestedGroups.length});
      return Response.json({ok:true,pending:true,message:"Invitation emailed. Staff permissions activate only after acceptance."});
    }
    const requestedDepartments:string[]=[...new Set<string>((Array.isArray(body.department_ids)?body.department_ids:[]).map((x:any)=>String(x)).filter(Boolean))];
    let departmentName="";
    if(requestedDepartments.length){
      const {data:departmentRows,error:dve}=await db.from("support_departments").select("id,name").in("id",requestedDepartments).eq("enabled",true);
      if(dve||!departmentRows||departmentRows.length!==requestedDepartments.length)return Response.json({error:dve?.message||"One or more support departments are invalid."},{status:400});
      const primaryDepartment=requestedDepartments.includes(String(body.primary_department_id||""))?String(body.primary_department_id):requestedDepartments[0];
      departmentName=departmentRows.find((d:any)=>String(d.id)===primaryDepartment)?.name||departmentRows[0]?.name||"";
    }
    const primary=requestedGroups.includes(String(body.primary_group_id||""))?String(body.primary_group_id):requestedGroups[0];
    const {data,error}=await db.rpc("admin_save_staff_member",{
      p_user_id:target,
      p_title:String(body.title||""),
      p_department:departmentName,
      p_staff_notes:String(body.staff_notes||""),
      p_status:body.status==="disabled"?"disabled":"active",
      p_group_ids:requestedGroups,
      p_primary_group_id:primary||null
    });
    if(error)return Response.json({error:error.message},{status:400});
    const {error:departmentSaveError}=await db.rpc("admin_set_staff_departments",{p_user_id:target,p_department_ids:requestedDepartments});
    if(departmentSaveError)return Response.json({error:departmentSaveError.message},{status:400});
    await staffNotice(target,"staff.permissions.changed","Staff permissions updated","Your staff groups or permissions were updated.","admin",groupRows.some((g:any)=>g.slug==="superadmin")?"warning":"info");
    return Response.json({ok:true,id:target,result:data,department_ids:requestedDepartments});
  }catch(e:any){return Response.json({error:e.message||"Staff operation failed."},{status:e.status||500})}
}
