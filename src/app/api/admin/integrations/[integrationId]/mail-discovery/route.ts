import {createClient} from "@supabase/supabase-js";
import {requireIntegrationAdmin,integrationErrorResponse} from "@/lib/integrations/admin-context";
import {BILLING_EMAIL_EVENTS} from "@/lib/billing-email-events.mjs";
import {planMailDiscovery} from "@/integrations/Mailsystem/Data/discovery.mjs";
import {defaultBillingMailTemplates} from "@/integrations/Mailsystem/Data/billing-defaults.mjs";
import {verifyMailSystemConnection,type MailConnectionResult} from "@/integrations/Mailsystem/Data/client";
import {createSupabaseMailModuleStore} from "@/integrations/Mailsystem/Data/supabase-store";
import {configureTemplate} from "@/integrations/Mailsystem/Data/configuration";
export const runtime="nodejs";

const noCache={headers:{"cache-control":"no-store"}};
const defaults=defaultBillingMailTemplates(BILLING_EMAIL_EVENTS);
const reject=(message:string,status=400)=>Object.assign(new Error(message),{status});
type Box={id:string;address:string;kind?:string};
type TemplateDraft={display_name:string;subject:string;body_text:string|null;body_html:string|null};

async function discover(req:Request,localOnly=false){
 const {db:adminDb}=await requireIntegrationAdmin(req,["integrations.manage","integrations.mail.manage"]);
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw reject("Integration database unavailable.",503);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:state,error}=await db.from("app_integrations").select("installed,enabled").eq("integration_id","mailsystem").maybeSingle();
 if(error)throw error;
 if(!state?.installed)throw reject("Install Mail System first.",409);
 const store=createSupabaseMailModuleStore(db);
 // The retired mail tables are not part of the installed integration contract.
 const [templates,triggers,routes,settings,staff,departments,verified]=await Promise.all([
  store.listTemplates(),store.listTriggers(),store.listRoutes(),store.getSettings(),
  adminDb.rpc("admin_get_staff_snapshot"),
  adminDb.from("support_departments").select("id,name,slug,email,enabled").eq("enabled",true),
  localOnly?Promise.resolve<MailConnectionResult>({connected:false,canSend:false,status:"unknown_error",message:"Billing configuration loaded. Mailbox connection not checked.",sender:null,senders:[]}):verifyMailSystemConnection()
 ]);
 const permitted:Box[]=verified.connected?verified.senders:[];
 const provisioningDomains=verified.connected?(verified.provisioningDomains||[]):[];
 const scopedConnection={...verified,senders:permitted,canSend:verified.connected&&permitted.length>0};
 const directory=staff.error||departments.error||!Array.isArray(staff.data?.members)||!Array.isArray(staff.data?.groups)?{available:false,users:0,groups:0,departments:0}:{available:true,users:staff.data.members.length,groups:staff.data.groups.length,departments:departments.data?.length||0};
 const events=planMailDiscovery({events:BILLING_EMAIL_EVENTS,senders:permitted,catalogueAvailable:verified.connected,templates,triggers,routes,defaultTemplates:defaults});
 const eventTemplateKeys=new Set(events.map(event=>event.templateKey));
 return {db,store,templates,triggers,connection:scopedConnection,events,directory,provisioningDomains,departmentRows:departments.data||[],settings,integrationEnabled:state.enabled===true,customTemplates:templates.filter(template=>!eventTemplateKeys.has(template.template_key))};
}

export async function GET(req:Request){
 try{
  const {connection,events,directory,provisioningDomains,settings,integrationEnabled,customTemplates}=await discover(req,new URL(req.url).searchParams.get("local")==="1");
  return Response.json({connection,events,directory,provisioningDomains,deliveryEnabled:settings.enabled,integrationEnabled,customTemplates},noCache);
 }catch(error){return integrationErrorResponse(error,"Mail discovery failed.");}
}

export async function POST(req:Request){
 try{
  const initial=await discover(req,true);
  const {db,store,templates,triggers,events,settings}=initial;
  const existingKeys=new Set(templates.map(template=>template.template_key));
  const missing=new Map(events.filter(event=>event.template&&!existingKeys.has(event.templateKey)).map(event=>[event.templateKey,event.template!]));
  const warnings:string[]=[];
  // Bound concurrency and keep the revision RPC; never replace an existing template.
  const pending=[...missing.entries()];
  for(let offset=0;offset<pending.length;offset+=6){
   await Promise.all(pending.slice(offset,offset+6).map(async ([key,template])=>{
    try{await store.saveTemplate({...template,template_key:key,active:false});existingKeys.add(key);}
    catch(error){
     if(await store.getTemplateByKey(key))existingKeys.add(key);
     else warnings.push(key+": "+(error instanceof Error?error.message:String(error)));
    }
   }));
  }
  const existingTriggers=new Set(triggers.map(trigger=>trigger.event_key));
  const rows=events.filter(event=>existingKeys.has(event.templateKey)&&!existingTriggers.has(event.key)).map(event=>({event_key:event.key,template_key:event.templateKey,route_key:null,recipient_mapping:{source:"host_event"},active:false}));
  if(rows.length){
   const result=await db.from("app_mail_triggers").upsert(rows,{onConflict:"event_key",ignoreDuplicates:true});
   if(result.error)throw result.error;
  }
  const results=events.map(event=>({key:event.key,status:!existingKeys.has(event.templateKey)?"needs_template":event.routeKey&&event.sender?"configured":"needs_sender"}));
  return Response.json({ok:warnings.length===0,detected:events.length,templatesPrepared:pending.filter(([key])=>existingKeys.has(key)).length,triggersPrepared:rows.length,configured:results.filter(row=>row.status==="configured").map(row=>row.key),results,warnings,requiresReview:results.filter(row=>row.status!=="configured"),deliveryEnabled:settings.enabled},noCache);
 }catch(error){return integrationErrorResponse(error,"Local event detection failed.");}
}

function draft(input:unknown):TemplateDraft{
 if(!input||typeof input!=="object")throw reject("Template content is required.");
 const value=input as Partial<TemplateDraft>;
 if(typeof value.display_name!=="string"||typeof value.subject!=="string"||!(value.body_text==null||typeof value.body_text==="string")||!(value.body_html==null||typeof value.body_html==="string"))throw reject("Invalid template content.");
 return {display_name:value.display_name,subject:value.subject,body_text:value.body_text||null,body_html:value.body_html||null};
}
function variablesUsed(source:TemplateDraft){
 return [...new Set([source.subject,source.body_text||"",source.body_html||""].flatMap(part=>[...part.matchAll(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g)].map(match=>match[1])))];
}

export async function PUT(req:Request){
 try{
  const body=await req.json().catch(()=>null);
  if(!body||typeof body!=="object")throw reject("Configuration required.");
  const localOnly=body.action==="custom_template"||(body.action==="delivery"?body.enabled===false:!body.sender&&body.active!==true);
  const {store,connection,events,integrationEnabled,settings}=await discover(req,localOnly);
  if(body.action==="delivery"){
   if(typeof body.enabled!=="boolean")throw reject("Choose a delivery state.");
   if(body.enabled&&(!connection.canSend||!integrationEnabled))throw reject("Connect and enable Mail System with at least one assigned mailbox first.",409);
   await store.saveSettings({...settings,enabled:body.enabled});
   return Response.json({ok:true,deliveryEnabled:body.enabled},noCache);
  }
  if(body.action==="custom_template"){
   const key=String(body.templateKey||"");
   const existing=await store.getTemplateByKey(key);
   if((!existing&&!/^custom\.[a-z0-9][a-z0-9._-]{0,91}$/i.test(key))||events.some(event=>event.templateKey===key))throw reject("Use a unique custom template key.");
   if(existing&&!body.edit)throw reject("This template already exists.",409);
   const template=await configureTemplate(store,{...draft(body.template),id:existing?.id,template_key:key,active:body.active===true});
   return Response.json({ok:true,template},noCache);
  }
  const all=body.all===true,category=typeof body.category==="string"?body.category:"",eventKey=typeof body.eventKey==="string"?body.eventKey:"";
  if(!all&&!category&&!eventKey)throw reject("Select an event or category.");
  const selected=events.filter(event=>all||event.key===eventKey||event.category===category);
  if(!selected.length)throw reject("No matching events.",404);
  if(body.template&&selected.length!==1)throw reject("Edit one event template at a time.");
  const sender=typeof body.sender==="string"?body.sender.trim().toLowerCase():null;
  if(sender&&!connection.senders.some(mailbox=>mailbox.address.toLowerCase()===sender))throw reject("Select a mailbox assigned to this integration.",403);
  if(body.active===true&&(!connection.canSend||!integrationEnabled))throw reject("Connect and enable Mail System first.",409);
  const results:{key:string;status:string}[]=[];
  for(const event of selected){
   const trigger=await store.getTrigger(event.key);
   if(body.active===false&&!sender&&!body.template){
    if(trigger)await store.saveTrigger({...trigger,active:false});
    results.push({key:event.key,status:"disabled"});continue;
   }
   const source=body.template?draft(body.template):event.template;
   if(!source){results.push({key:event.key,status:"needs_review"});continue;}
   const used=variablesUsed(source),allowed=new Set(event.variables.map(variable=>variable.name));
   const valid=used.every(variable=>allowed.has(variable))&&event.variables.filter(variable=>variable.sensitive).every(variable=>used.includes(variable.name));
   if((body.active===true||trigger?.active||body.template)&&!valid){results.push({key:event.key,status:"template_variables_need_review"});continue;}
   const selectedSender=sender||event.sender;
   const active=body.active===true?true:body.active===false?false:!!trigger?.active;
   if((body.active===true||sender)&&active&&(!connection.canSend||!integrationEnabled||!selectedSender)){results.push({key:event.key,status:"needs_sender"});continue;}
   // Editing a template shared by events forks it to this event instead of changing another event's content.
   const shared=events.some(other=>other.key!==event.key&&other.templateKey===event.templateKey);
   const key=body.template&&shared?"event."+event.key:event.templateKey;
   const existing=await store.getTemplateByKey(key);
   if(body.template){
    await configureTemplate(store,{...source,id:existing?.id,template_key:key,active:active||!!existing?.active});
   }else if(!existing||active&&!existing.active){
    await store.saveTemplate({...source,id:existing?.id,template_key:key,variables:used,active:active||!!existing?.active});
   }
   let routeKey=event.routeKey;
   if(selectedSender&&(sender||body.active===true||!routeKey)){
    routeKey=sender||!routeKey?"auto."+event.key:routeKey;
    const route=(await store.listRoutes()).find(item=>item.route_key===routeKey);
    if(sender||!route||active&&!route.active)await store.saveRoute({id:route?.id,route_key:routeKey,sender_address:selectedSender,priority:route?.priority||0,conditions:route?.conditions||{},active:active||!!route?.active});
   }
   await store.saveTrigger({id:trigger?.id,event_key:event.key,template_key:key,route_key:routeKey,recipient_mapping:trigger?.recipient_mapping||{source:"host_event"},active});
   results.push({key:event.key,status:active?"enabled":selectedSender?"saved":"needs_sender"});
  }
  if(body.enableModule===true&&results.some(item=>item.status==="enabled"))await store.saveSettings({...settings,enabled:true});
  return Response.json({ok:true,results},noCache);
 }catch(error){return integrationErrorResponse(error,"Unable to configure email events.");}
}
