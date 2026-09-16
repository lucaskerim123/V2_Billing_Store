import {isMailAdmin,requireMailUser} from "@/lib/mail-auth";
import {loadMailRuntimeConfig} from "@/lib/mail-config-server";

export async function GET(req:Request){
  const ctx:any=await requireMailUser(req);if(ctx.error)return ctx.error;
  const canAdmin=isMailAdmin(ctx)||isMailAdmin(ctx,'mail.settings')||isMailAdmin(ctx,'mail.templates')||isMailAdmin(ctx,'mail.queue.view')||isMailAdmin(ctx,'mail.queue.manage');
  if(!canAdmin)return Response.json({error:'Mail administration denied.'},{status:403});
  const [{data,error},{data:queue,error:queueError},config]=await Promise.all([ctx.db.rpc('mail_admin_snapshot'),ctx.db.rpc('mail_admin_queue_snapshot'),loadMailRuntimeConfig(ctx.db)]);
  if(error)return Response.json({error:error.message},{status:500});
  if(queueError)return Response.json({error:queueError.message},{status:500});
  if(!data)return Response.json({error:'Mail administration denied.'},{status:403});
  const outboundConfigured=!!String(process.env.RESEND_API_KEY||'').trim();
  const inboundConfigured=!!String(process.env.RESEND_MAIL_API_KEY||process.env.RESEND_API_KEY||'').trim();
  return Response.json({...data,queue:queue||{summary:{},queue:[],stuck_logs:[]},runtimeConfig:config,provider:{name:'Resend transport',apiKeyConfigured:outboundConfigured,mailApiKeyConfigured:inboundConfigured,separateMailApiKeyConfigured:!!String(process.env.RESEND_MAIL_API_KEY||'').trim(),secretsLocation:'Vercel environment'}})
}

export async function PUT(req:Request){
  const ctx:any=await requireMailUser(req);if(ctx.error)return ctx.error;
  const canAdmin=isMailAdmin(ctx)||isMailAdmin(ctx,'mail.settings')||isMailAdmin(ctx,'mail.templates')||isMailAdmin(ctx,'mail.queue.manage');
  if(!canAdmin)return Response.json({error:'Mail administration denied.'},{status:403});
  const b=await req.json().catch(()=>({}));

  if(b.action==='settings'){
    if(!isMailAdmin(ctx,'mail.settings'))return Response.json({error:'Mail settings permission required.'},{status:403});
    const {error}=await ctx.db.rpc('mail_admin_save_settings',{p_rows:b.rows||[]});
    return error?Response.json({error:error.message},{status:403}):Response.json({ok:true});
  }
  if(b.action==='account'){
    if(!isMailAdmin(ctx,'mail.settings'))return Response.json({error:'Mail settings permission required.'},{status:403});
    const {error}=await ctx.db.rpc('mail_admin_update_account',{
      p_address:String(b.address||''),
      p_display_name:String(b.displayName||''),
      p_kind:String(b.kind||'shared'),
      p_active:b.active!==false,
      p_assigned_user_id:b.assignedUserId||null
    });
    return error?Response.json({error:error.message},{status:403}):Response.json({ok:true});
  }
  if(b.action==='account_create'){
    if(!isMailAdmin(ctx,'mail.settings'))return Response.json({error:'Mail settings permission required.'},{status:403});
    const {error}=await ctx.db.rpc('mail_admin_create_account',{
      p_address:String(b.address||''),
      p_display_name:String(b.displayName||''),
      p_kind:String(b.kind||'shared'),
      p_assigned_user_id:b.assignedUserId||null
    });
    return error?Response.json({error:error.message},{status:403}):Response.json({ok:true});
  }
  if(b.action==='account_delete'){
    if(!isMailAdmin(ctx,'mail.settings'))return Response.json({error:'Mail settings permission required.'},{status:403});
    const {error}=await ctx.db.rpc('mail_admin_delete_account',{p_address:String(b.address||'')});
    return error?Response.json({error:error.message},{status:403}):Response.json({ok:true});
  }
  if(b.action==='template'){
    if(!isMailAdmin(ctx,'mail.templates'))return Response.json({error:'Mail template permission required.'},{status:403});
    const {error}=await ctx.db.rpc('mail_admin_upsert_template',{p_template:b.template||{}});
    return error?Response.json({error:error.message},{status:403}):Response.json({ok:true});
  }
  if(b.action==='automation'){
    if(!isMailAdmin(ctx,'mail.settings'))return Response.json({error:'Mail settings permission required.'},{status:403});
    const {error}=await ctx.db.rpc('mail_admin_save_automation',{p_event_key:String(b.eventKey||''),p_template_key:b.templateKey?String(b.templateKey):null,p_enabled:b.enabled!==false});
    return error?Response.json({error:error.message},{status:403}):Response.json({ok:true});
  }
  if(b.action==='queue'){
    if(!isMailAdmin(ctx,'mail.queue.manage'))return Response.json({error:'Mail queue manage permission required.'},{status:403});
    const {data,error}=await ctx.db.rpc('mail_admin_queue_action',{p_action:String(b.queueAction||''),p_outbox_id:b.outboxId||null,p_log_id:b.logId||null});
    return error?Response.json({error:error.message},{status:403}):Response.json(data||{ok:true});
  }
  return Response.json({error:'Unknown mail admin action.'},{status:400})
}
