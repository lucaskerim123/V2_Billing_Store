import {createClient} from "@supabase/supabase-js";
import {createSupabaseMailModuleStore} from "@/integrations/mail/supabase-store";
import {dispatchMailEvent} from "@/integrations/mail/module";

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||"";

type SendMailEventInput={
  eventKey:string;
  recipient:string;
  variables:Record<string,string>;
  relatedType?:string;
  relatedId?:string;
};

export async function sendBillingMailEvent(input:SendMailEventInput){
  const recipient=String(input.recipient||"").trim();
  if(!recipient)return {ok:true,skipped:true as const,reason:"missing_recipient"};
  if(!SUPABASE_URL||!SERVICE_KEY)return {ok:true,skipped:true as const,reason:"mail_integration_server_not_configured"};
  if(!process.env.MAIL_SYSTEM_URL||!process.env.MAIL_SYSTEM_API_KEY)return {ok:true,skipped:true as const,reason:"mail_system_credentials_missing"};

  const db=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:integration,error:integrationError}=await db.from("app_integrations")
    .select("installed,enabled").eq("integration_id","mail").maybeSingle();
  if(integrationError)throw new Error("Mail integration state unavailable: "+integrationError.message);
  if(!integration?.installed||!integration?.enabled)return {ok:true,skipped:true as const,reason:"mail_integration_disabled"};

  let dispatchId:string|null=null;
  const relatedType=input.relatedType||null;
  const relatedId=input.relatedId||null;
  if(relatedType&&relatedId){
    const {data:inserted,error:insertError}=await db.from("app_mail_dispatch_log").insert({
      event_key:input.eventKey,related_type:relatedType,related_id:relatedId,
      recipient,status:"pending",attempts:1
    }).select("id").maybeSingle();
    if(!insertError&&inserted){dispatchId=String(inserted.id)}
    else if(insertError?.code==="23505"){
      const {data:existing,error:existingError}=await db.from("app_mail_dispatch_log")
        .select("id,status,updated_at,attempts").eq("event_key",input.eventKey)
        .eq("related_type",relatedType).eq("related_id",relatedId).maybeSingle();
      if(existingError)throw new Error("Mail dispatch idempotency check failed: "+existingError.message);
      if(existing?.status==="sent")return {ok:true,skipped:true as const,reason:"duplicate_event_already_sent"};
      const stalePending=existing?.status==="pending"&&Date.now()-new Date(existing.updated_at).getTime()>15*60*1000;
      if(existing?.status==="pending"&&!stalePending)return {ok:true,skipped:true as const,reason:"duplicate_event_in_progress"};
      if(existing?.id){
        const {error:updateError}=await db.from("app_mail_dispatch_log").update({
          status:"pending",error:null,attempts:Number(existing.attempts||0)+1,updated_at:new Date().toISOString()
        }).eq("id",existing.id);
        if(updateError)throw new Error("Mail dispatch retry could not be recorded: "+updateError.message);
        dispatchId=String(existing.id);
      }
    }else if(insertError){
      throw new Error("Mail dispatch ledger unavailable: "+insertError.message);
    }
  }

  try{
    const store=createSupabaseMailModuleStore(db);
    const result=await dispatchMailEvent({
      store,
      eventKey:input.eventKey,
      context:{...input.variables,recipient,related_type:relatedType,related_id:relatedId},
      resolveRecipients:async(_mapping,context)=>String(context.recipient||"")
    });
    if("skipped" in result&&result.skipped){
      if(dispatchId)await db.from("app_mail_dispatch_log").delete().eq("id",dispatchId);
      return {ok:true,skipped:true as const,reason:result.reason};
    }
    if(dispatchId){
      await db.from("app_mail_dispatch_log").update({
        status:"sent",mail_system_message_id:String((result as any)?.id||"")||null,
        error:null,updated_at:new Date().toISOString()
      }).eq("id",dispatchId);
    }
    return result;
  }catch(error){
    if(dispatchId)await db.from("app_mail_dispatch_log").update({
      status:"failed",error:error instanceof Error?error.message:"Mail dispatch failed",
      updated_at:new Date().toISOString()
    }).eq("id",dispatchId);
    throw error;
  }
}
