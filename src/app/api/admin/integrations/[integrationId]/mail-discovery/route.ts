import {createClient} from "@supabase/supabase-js";
import {requireIntegrationAdmin,integrationErrorResponse} from "@/lib/integrations/admin-context";
import {BILLING_EMAIL_EVENTS} from "@/lib/billing-email-events.mjs";
import {planMailDiscovery} from "@/integrations/Mailsystem/Data/discovery.mjs";
import {verifyMailSystemConnection} from "@/integrations/Mailsystem/Data/client";
import {createSupabaseMailModuleStore} from "@/integrations/Mailsystem/Data/supabase-store";
export const runtime="nodejs";

async function discover(req:Request){
 await requireIntegrationAdmin(req,["integrations.manage","integrations.mail.manage"]);
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw Object.assign(new Error("Integration database unavailable."),{status:503});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:state,error}=await db.from("app_integrations").select("installed").eq("integration_id","mailsystem").maybeSingle();
 if(error)throw error;
 if(!state?.installed)throw Object.assign(new Error("Install Mail System first."),{status:409});
 const store=createSupabaseMailModuleStore(db);
 const [connection,templates,triggers,routes,legacyTemplates,legacyAutomations]=await Promise.all([
  verifyMailSystemConnection(),store.listTemplates(),store.listTriggers(),store.listRoutes(),
  db.from("mail_templates").select("template_key,name,subject,text_body,html,from_account"),
  db.from("mail_automations").select("event_key,template_key"),
 ]);
 if(legacyTemplates.error||legacyAutomations.error)throw new Error(legacyTemplates.error?.message||legacyAutomations.error?.message);
 const events=planMailDiscovery({events:BILLING_EMAIL_EVENTS,senders:connection.senders,templates,triggers,routes,legacyTemplates:legacyTemplates.data||[],legacyAutomations:legacyAutomations.data||[]});
 return {db,connection,events};
}
export async function GET(req:Request){
 try{
  const {connection,events}=await discover(req);
  return Response.json({connection,events},{headers:{"cache-control":"no-store"}});
 }catch(error){return integrationErrorResponse(error,"Mail discovery failed.");}
}
export async function POST(req:Request){
 try{
  const {db,connection,events}=await discover(req);
  if(!connection.connected)throw Object.assign(new Error(connection.message),{status:409});
  const ready=events.filter(event=>!event.existing&&event.status==="ready_to_configure"&&event.template&&event.sender);
  const results=[];
  for(const event of ready){
   const template=event.template!;
   const routeKey="auto."+event.key;
   // Conflict-safe inserts: never overwrite an administrator's template, route or trigger.
   const t=await db.from("app_mail_templates").upsert({
    template_key:event.key,display_name:template.display_name,subject:template.subject,
    body_text:template.body_text,body_html:template.body_html,variables:template.variables,active:false
   },{onConflict:"template_key",ignoreDuplicates:true});
   if(t.error)throw t.error;
   const r=await db.from("app_mail_routes").upsert({route_key:routeKey,sender_address:event.sender,priority:0,conditions:{},active:false},{onConflict:"route_key",ignoreDuplicates:true});
   if(r.error)throw r.error;
   const g=await db.from("app_mail_triggers").upsert({event_key:event.key,template_key:event.key,route_key:routeKey,recipient_mapping:{source:"host_event"},active:false},{onConflict:"event_key",ignoreDuplicates:true});
   if(g.error)throw g.error;
   results.push(event.key);
  }
  return Response.json({configured:results,requiresReview:events.filter(event=>!event.existing&&event.status!=="ready_to_configure").map(event=>({key:event.key,status:event.status})),deliveryEnabled:false},{headers:{"cache-control":"no-store"}});
 }catch(error){return integrationErrorResponse(error,"Automatic mail configuration failed.");}
}
