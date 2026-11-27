import "server-only";
import {createClient} from "@supabase/supabase-js";
import {createSupabaseMailModuleStore} from "@/modules/mail-configuration/supabase-store";
import {dispatchMailEvent} from "@/modules/mail-configuration/module";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||"";

/**
 * Compatibility entry point for existing Billing lifecycle callers.
 * Billing resolves the event context and recipient; the Mail Configuration
 * module resolves the configured trigger/template/route and the central
 * Mail System performs the actual delivery.
 */
export async function sendAutomation(
  eventKey:string,
  to:string,
  vars:Record<string,string>,
  relatedType?:string,
  relatedId?:string,
){
  if(!url||!serviceKey||!process.env.MAIL_SYSTEM_URL||!process.env.MAIL_SYSTEM_API_KEY)
    return {ok:true,skipped:true as const,reason:"mail_module_not_configured"};
  const db=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const store=createSupabaseMailModuleStore(db as any);
  const context:Record<string,unknown>={...vars,event_key:eventKey,related_type:relatedType||"",related_id:relatedId||""};
  try{
    return await dispatchMailEvent({
      store,eventKey,context,
      resolveRecipients:async(mapping,values)=>{
        const field=typeof mapping.field==="string"?mapping.field:"";
        const mapped=field?values[field]:null;
        return typeof mapped==="string"&&mapped.trim()?mapped:to;
      }
    });
  }catch(error){
    console.error("[mail-module] Event dispatch failed:",eventKey,error);
    return {ok:false,skipped:true as const,reason:error instanceof Error?error.message:"mail_delivery_failed"};
  }
}
