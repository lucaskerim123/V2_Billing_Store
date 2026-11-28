import {createClient} from "@supabase/supabase-js";
import {getBillingEmailEvent} from "@/lib/billing-email-events.mjs";
import {createSupabaseMailModuleStore} from "@/integrations/Mailsystem/Data/supabase-store";
import {getMailModuleConfig} from "@/integrations/Mailsystem/Data/config";
import {dispatchMailEvent} from "@/integrations/Mailsystem/Data/module";
import {resolveMailRoute} from "@/integrations/Mailsystem/Data/routing";

/** Host-owned trusted event boundary. No browser-supplied recipients or tokens. */
export async function sendAutomation(eventKey:string,to:string,vars:Record<string,string>,relatedType?:string,relatedId?:string){
 if(!getBillingEmailEvent(eventKey))throw new Error("Unknown Billing Store email event: "+eventKey);
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new Error("Billing email database unavailable.");
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:integration,error}=await db.from("app_integrations").select("installed,enabled").eq("integration_id","mailsystem").maybeSingle();
 if(error)throw error;
 if(!integration?.installed||!integration.enabled)return {ok:true,skipped:true as const,eventKey,reason:"no_email_integration_installed"};
 const store=createSupabaseMailModuleStore(db);
 const [settings,trigger]=await Promise.all([store.getSettings(),store.getTrigger(eventKey)]);
 if(!settings.enabled||!trigger?.active)return {ok:true,skipped:true as const,eventKey,reason:"email_event_disabled"};
 // The central mail:admin key is not a substitute for an explicit mailbox assignment.
 const routes=await store.listRoutes();
 const selection=resolveMailRoute(trigger.route_key?routes.filter(r=>r.route_key===trigger.route_key):routes,vars,settings.defaultSender);
 if(!selection.sender||trigger.route_key&&!selection.route)throw new Error("No active sender route for "+eventKey);
 const config=await getMailModuleConfig();
 const catalogue=await fetch(config.baseUrl+"/api/integrations/mailboxes",{headers:{Authorization:"Bearer "+config.apiKey},cache:"no-store"});
 if(!catalogue.ok)throw new Error("Unable to verify scoped sender mailbox.");
 const {mailboxes}=await catalogue.json();
 if(!Array.isArray(mailboxes)||!mailboxes.some((m:{address:string})=>m.address.toLowerCase()===selection.sender!.toLowerCase()))throw new Error("Sender not assigned to Billing Store.");
 const result=await dispatchMailEvent({store,eventKey,context:vars,resolveRecipients:async()=>to});
 if("skipped" in result&&result.skipped)return {ok:true,skipped:true as const,eventKey,reason:result.reason};
 // Keep the existing scheduler's delivery ledger consistent, without persisting sensitive template variables.
 const {error:logError}=await db.from("mail_delivery_log").insert({event_type:eventKey,related_type:relatedType||null,related_id:relatedId||null,template_key:trigger.template_key,recipient:to,sender:selection.sender,subject:"[Integration email]",status:"sent",sent_at:new Date().toISOString(),provider_id:"providerId" in result?result.providerId||null:null});
 if(logError)console.error("Billing mail delivery ledger failed",eventKey,logError.code);
 return {...result,ok:true,skipped:false as const,eventKey};
}
