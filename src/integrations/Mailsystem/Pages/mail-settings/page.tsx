"use client";

import {useCallback,useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";
import {MailAccessManager} from "../../Data/access-manager";
import type {MailTemplate} from "../../Data/types";
import "@/app/admin/settings-system-v2.css";

type Props={integration?:{id:string;name:string;version:string}};
type Draft=Pick<MailTemplate,"display_name"|"subject"|"body_text"|"body_html">;
type EventRow={key:string;name:string;category:string;description?:string;variables:readonly {name:string;sensitive?:boolean}[];sender:string|null;status:string;active:boolean;existing:boolean;routeKey:string|null;templateKey:string;template:Draft|null};
type Box={id:string;address:string;kind?:string};
type Snapshot={events:EventRow[];connection:{connected:boolean;canSend:boolean;message:string;senders:Box[]};directory:{available:boolean;users:number;groups:number;departments:number};provisioningDomains:string[];deliveryEnabled:boolean;integrationEnabled:boolean;customTemplates:MailTemplate[]};
const sections=[["events","Automated emails"],["mailboxes","Mailboxes"],["access","Users & access"],["templates","Custom templates"],["delivery","Delivery settings"]] as const;
const kinds=["system","department","personal","shared"];
const title=(value:string)=>value.charAt(0).toUpperCase()+value.slice(1);
const emptyDraft:Draft={display_name:"",subject:"",body_text:"",body_html:""};
const stateLabel=(row:EventRow)=>row.active?"Enabled":row.status==="configured"?"Configured · disabled":row.status==="needs_sender"?"Mailbox needed":row.status==="needs_template"?"Template needed":"Ready to configure";
const isReview=(status:string)=>["needs_review","needs_sender","needs_template","template_variables_need_review"].includes(status);

export default function MailSettingsPage({integration}:Props){
 const supabase=useMemo(()=>createClient(),[]);
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const [section,setSection]=useState<typeof sections[number][0]>("events");
 const [busy,setBusy]=useState("");
 const [syncing,setSyncing]=useState(false);
 const [detecting,setDetecting]=useState(false);
 const [checking,setChecking]=useState(false);
 const [syncStatus,setSyncStatus]=useState("");
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const [query,setQuery]=useState("");
 const [category,setCategory]=useState("");
 const [bulkSender,setBulkSender]=useState("");
 const [selected,setSelected]=useState("");
 const [draft,setDraft]=useState<Draft>(emptyDraft);
 const [templateSender,setTemplateSender]=useState("");
 const [templateActive,setTemplateActive]=useState(false);
 const [customKey,setCustomKey]=useState("");
 const [customExisting,setCustomExisting]=useState(false);
 const [domain,setDomain]=useState("");
 const [newBox,setNewBox]=useState({address:"",kind:"department",display_name:""});
 const [warnings,setWarnings]=useState<string[]>([]);
 const [accessRevision,setAccessRevision]=useState(0);
 const [preview,setPreview]=useState(false);
 const request=useCallback(async(path:string,method="GET",body?:unknown)=>{
  const {data:{session}}=await supabase.auth.getSession();
  if(!session?.access_token)throw new Error("Administrator session expired. Sign in again.");
  const response=await fetch("/api/admin/integrations/mailsystem/"+path,{method,headers:{Authorization:"Bearer "+session.access_token,"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:"no-store",signal:AbortSignal.timeout(method==="GET"?20000:60000)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(typeof result.error==="string"?result.error:result.error?.message||result.message||"Mail operation failed.");
  return result;
 },[supabase]);
 const load=useCallback(async(localOnly=false)=>{
  const result:Snapshot=await request("mail-discovery"+(localOnly?"?local=1":""));
  setSnapshot(old=>localOnly&&old?{...result,connection:old.connection,provisioningDomains:old.provisioningDomains,events:result.events.map(event=>{
   const previous=old.events.find(item=>item.key===event.key);
   if(!event.routeKey&&previous&&!previous.routeKey&&previous.sender&&old.connection.connected)return {...event,sender:previous.sender,status:"ready_to_configure"};
   return event;
  })}:result);
  if(!localOnly)setDomain(old=>result.provisioningDomains.includes(old)?old:result.provisioningDomains.length===1?result.provisioningDomains[0]:"");
  return result;
 },[request]);
 const discover=useCallback(async()=>{
  setDetecting(true);setError("");setMessage("");
  try{
   const result=await request("mail-discovery","POST",{});
   setWarnings(Array.isArray(result.warnings)?result.warnings:[]);
   await load(true);
   setMessage(result.detected+" Billing Store events detected. "+result.templatesPrepared+" missing templates and "+result.triggersPrepared+" missing triggers prepared."+ (result.ok===false?" Some templates need review.":""));
  }catch(reason){setError(reason instanceof Error?reason.message:"Local event detection failed.");}
  finally{setDetecting(false);}
 },[request,load]);
 const run=useCallback(async(name:string,operation:()=>Promise<unknown>)=>{
  setBusy(name);setError("");setMessage("");
  try{await operation();}
  catch(reason){setError(reason instanceof Error?reason.message:"Mail operation failed.");}
  finally{setBusy("");}
 },[]);
 useEffect(()=>{let active=true;void run("load",async()=>{
  // Opening settings is read-only: local state renders before checking the remote catalogue.
  const initial=await load(true);
  setChecking(true);
  void request("mail-discovery").then((result:Snapshot)=>{
   if(!active)return;
   // Do not replace a more recent snapshot saved by another settings action.
   setSnapshot(old=>old===initial?result:old?{...old,connection:result.connection,provisioningDomains:result.provisioningDomains}:result);
   setDomain(old=>result.provisioningDomains.includes(old)?old:result.provisioningDomains.length===1?result.provisioningDomains[0]:"");
  }).catch(reason=>{if(active)setSyncStatus(reason instanceof Error?reason.message:"Mailbox connection check failed.");}).finally(()=>{if(active)setChecking(false);});
 });return()=>{active=false};},[load,run,request]);
 const syncAll=useCallback(async()=>{
  setSyncing(true);setSyncStatus("Synchronizing staff directory and access…");
  try{
   const result=await request("mail-directory","POST",{});
   const failures=(result.failures||[]).map((item:{result?:string})=>item.result||"Sync failed");
   const refreshed=await load();setAccessRevision(old=>old+1);
   if(result.ok===false)throw new Error("Directory sync incomplete: "+failures.join("; "));
   setSyncStatus("Staff synchronized: "+(result.users?.synced??0)+" of "+(result.users?.total??0)+". "+(result.users?.pendingReview?result.users.pendingReview+" staff need access review. ":"")+(refreshed.connection.connected?"Mailbox catalogue refreshed.":"Mailbox catalogue unavailable: "+refreshed.connection.message));
  }catch(reason){setSyncStatus(reason instanceof Error?reason.message:"Directory synchronization failed.");}
  finally{setSyncing(false);}
 },[request,load]);
 const saveConfiguration=useCallback(async(body:unknown)=>{
  const result=await request("mail-discovery","PUT",body);
  await load(true);
  const rows=(result.results||[]) as {key:string;status:string}[];
  const review=rows.filter(row=>isReview(row.status));
  setMessage(rows.length?rows.length+" events processed. "+review.length+" need review.":"Configuration saved.");
  if(review.some(row=>row.status==="template_variables_need_review"))throw new Error("Template variables need review. Use only the listed variables and include every required secure link or code.");
  return rows;
 },[request,load]);
 const loadAccess=useCallback(()=>request("mail-access"),[request]);
 const saveAccess=useCallback((body:unknown)=>request("mail-access","PUT",body),[request]);
 const events=snapshot?.events||[],mailboxes=snapshot?.connection.senders||[];
 const categories=[...new Set(events.map(event=>event.category))];
 const displayed=events.filter(event=>(!category||event.category===category)&&(!query||[event.name,event.key,event.description||"",event.sender||""].join(" ").toLowerCase().includes(query.toLowerCase())));
 const selectedEvent=events.find(event=>event.key===selected);
 const ready=events.filter(event=>event.status==="configured");
 const loading=busy==="load"&&!snapshot;
 const mailboxOptions=mailboxes.map(box=><option key={box.id} value={box.address}>{box.address} · {box.kind||"mailbox"}</option>);
 const selectEvent=(event:EventRow)=>{
  setSelected(event.key);setDraft(event.template?{...event.template}: {...emptyDraft,display_name:event.name,subject:event.name});
  setTemplateSender(event.sender||"");setTemplateActive(event.active);setPreview(false);
 };
 const selectCustom=(template?:MailTemplate)=>{
  setCustomKey(template?.template_key||"custom.");setCustomExisting(!!template);
  setDraft(template?{...template}:emptyDraft);setTemplateActive(template?.active||false);setPreview(false);
 };
 const editor=(custom:boolean)=> <form className="panel" onSubmit={event=>{
  event.preventDefault();
  void run("save-template",async()=>{
   if(custom){
    await request("mail-discovery","PUT",{action:"custom_template",templateKey:customKey,edit:customExisting,template:draft,active:templateActive});
    await load(true);setCustomExisting(true);setMessage("Custom template saved.");
   }else{
    const rows=await saveConfiguration({eventKey:selected,template:draft,...(templateSender&&templateSender!==selectedEvent?.sender?{sender:templateSender}:{}),...(templateActive!==selectedEvent?.active?{active:templateActive}:{})});
    if(rows.some(row=>row.status==="needs_sender"))setMessage("Template saved. Assign a mailbox before enabling delivery.");
   }
  });
 }}>
  <div className="panelTitle"><div><h2>{custom?(customExisting?"Edit custom template":"New custom template"):selectedEvent?.name+" template"}</h2><p className="muted">{custom?"Reusable template for manual email actions.":"Edit the automatically detected event, content and sender together."}</p></div><button type="button" className="secondary" onClick={()=>{setSelected("");setCustomKey("");setPreview(false)}}>Close</button></div>
  {custom&&<label>Template key<input required value={customKey} readOnly={customExisting} onChange={event=>setCustomKey(event.target.value)}/></label>}
  {!custom&&<p className="muted">{selectedEvent?.description} · {selectedEvent?.key}</p>}
  <fieldset disabled={!!busy}>
   <div className="two"><label>Template name<input required value={draft.display_name} onChange={event=>setDraft(old=>({...old,display_name:event.target.value}))}/></label><label>Subject<input required maxLength={998} value={draft.subject} onChange={event=>setDraft(old=>({...old,subject:event.target.value}))}/></label></div>
   {!custom&&<div className="two"><label>Sender mailbox<select value={templateSender} onChange={event=>setTemplateSender(event.target.value)}><option value="">Not assigned</option>{mailboxOptions}</select></label><label className="toggle"><input type="checkbox" checked={templateActive} disabled={!templateActive&&(!templateSender||!snapshot?.connection.canSend||!snapshot?.integrationEnabled)} onChange={event=>setTemplateActive(event.target.checked)}/> Enable this event</label></div>}
   {custom&&<label className="toggle"><input type="checkbox" checked={templateActive} onChange={event=>setTemplateActive(event.target.checked)}/> Template active</label>}
   <label>Plain text email<textarea rows={9} value={draft.body_text||""} onChange={event=>setDraft(old=>({...old,body_text:event.target.value}))}/></label>
   <details><summary>HTML content (optional)</summary><label>HTML email<textarea rows={7} value={draft.body_html||""} onChange={event=>setDraft(old=>({...old,body_html:event.target.value}))}/></label></details>
   {!custom&&<section><h3>Available event variables</h3><p className="muted">Select a variable to append it to the text. Required secure links and codes must remain in the template.</p><div className="inlineActions">{selectedEvent?.variables.map(variable=><button className="secondary" type="button" key={variable.name} onClick={()=>setDraft(old=>({...old,body_text:(old.body_text||"")+" {{"+variable.name+"}}"}))}>{variable.name}{variable.sensitive?" · required":""}</button>)}</div></section>}
  </fieldset>
  <div className="inlineActions"><button type="submit" disabled={!!busy||!draft.display_name.trim()||!draft.subject.trim()||!(draft.body_text||draft.body_html)||(!custom&&templateActive&&!selectedEvent?.active&&!templateSender)}>{busy==="save-template"?"Saving…":"Save template"+(custom?"":" & event")}</button><button type="button" className="secondary" onClick={()=>setPreview(old=>!old)}>{preview?"Hide preview":"Preview"}</button></div>
  {preview&&<section className="panel"><h3>{draft.subject}</h3><p className="muted">Preview uses template placeholders, not live customer data.</p><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{draft.body_text||draft.body_html}</pre></section>}
 </form>;
 return <main className="adminShell settingsEditorV3 settingsCompact">
  <div className="settingsEditorTop">
   <div className="settingsEditorBreadcrumbs"><Link href="/admin/integrations">Integrations</Link><span>›</span><span>Mail Settings</span></div>
   <header className="settingsEditorHeader"><div><p className="eyebrow">MASTER ADMIN · MAIL CONFIGURATION</p><h1>Mail Settings</h1><p className="muted">Configure Billing Store email events, templates, sender mailboxes and staff access. Mail System provides the delivery and mailbox service.</p>{integration&&<small className="muted">{integration.name} · v{integration.version}</small>}</div><Link className="buttonlink secondary" href="/admin/integrations">Connection & lifecycle</Link></header>
   <div className="settingsSummaryV3"><article><small>Detected events</small><strong>{events.length}</strong></article><article><small>Configured</small><strong>{ready.length}</strong></article><article><small>Enabled</small><strong>{events.filter(event=>event.active).length}</strong></article><article><small>Assigned mailboxes</small><strong>{mailboxes.length}</strong></article></div>
   <div className="settingsLiveBarV3"><div className="settingsLiveStateV3"><div><b>{checking?"Checking Mail System…":snapshot?.connection.connected?"Mail System connected":loading?"Loading Billing configuration…":"Mail System unavailable"}</b><small>{snapshot?.connection.message||"Loading live configuration."}</small></div></div><div className="settingsLiveActionsV3"><button type="button" className="secondary" disabled={!snapshot||detecting||!!busy} onClick={()=>void discover()}>{detecting?"Detecting…":"Detect Billing events"}</button><button type="button" disabled={!snapshot?.integrationEnabled||syncing} onClick={()=>void syncAll()}>{syncing?"Synchronizing…":"Sync now"}</button></div></div>
  </div>
  <nav className="inlineActions" aria-label="Mail Settings sections">{sections.map(([id,label])=><button key={id} type="button" className={section===id?"":"secondary"} aria-pressed={section===id} onClick={()=>{setSection(id);setSelected("");setCustomKey("");setPreview(false)}}>{label}</button>)}</nav>
  {error&&<section className="panel" role="alert"><h2>Mail Settings needs attention</h2><p>{error}</p><button type="button" className="secondary" disabled={!!busy} onClick={()=>void run("reload",async()=>{await load()})}>Reload</button></section>}
  {message&&<p role="status">{message}</p>}
  {syncStatus&&<p role="status">{syncStatus}</p>}
  {warnings.length>0&&<details className="panel"><summary>Event detection needs review ({warnings.length})</summary><ul>{warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></details>}
  {loading&&<section className="panel" role="status">Loading Billing Store events and templates…</section>}
  {snapshot&&section==="events"&&<>
   <section className="panel">
    <div className="panelTitle"><div><h2>Automated emails</h2><p className="muted">Every registered Billing Store event is detected locally. Detect Billing events prepares missing templates and triggers without changing saved senders or enabling delivery. Sync now updates staff and mailbox availability separately.</p></div></div>
    <div className="two"><label>Search events<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search events…" /></label><label>Category<select value={category} onChange={event=>setCategory(event.target.value)}><option value="">All categories</option>{categories.map(item=><option key={item} value={item}>{title(item)}</option>)}</select></label></div>
    <div className="two"><label>Assign sender to {category?title(category):"all categories"}<select value={bulkSender} onChange={event=>setBulkSender(event.target.value)}><option value="">Select mailbox</option>{mailboxOptions}</select></label><div className="inlineActions"><button className="secondary" type="button" disabled={!!busy||!bulkSender} onClick={()=>void run("routing",()=>saveConfiguration({...(category?{category}:{all:true}),sender:bulkSender}))}>Apply sender</button><button type="button" disabled={!!busy||!snapshot.connection.canSend||!snapshot.integrationEnabled} onClick={()=>void run("enable",()=>saveConfiguration({...(category?{category}:{all:true}),active:true,enableModule:true}))}>Enable ready events</button><button className="secondary" type="button" disabled={!!busy} onClick={()=>void run("disable",()=>saveConfiguration({...(category?{category}:{all:true}),active:false}))}>Disable category</button></div></div>
   </section>
   {selectedEvent&&editor(false)}
   <div className="settingsGroupStack">{categories.filter(item=>!category||item===category).map(item=>{
    const rows=displayed.filter(event=>event.category===item);
    return rows.length>0&&<details key={item} className="settingsGroupV3" open={category===item||item==="account"||undefined}>
     <summary className="settingsGroupHeadV3"><div><h2>{title(item)}</h2><p>{rows.filter(event=>event.status==="configured").length} configured · {rows.filter(event=>event.active).length} enabled</p></div><span>{rows.length} events</span><i aria-hidden="true">⌄</i></summary>
     <div className="settingsListV3">{rows.map(event=><div key={event.key} className="settingV3">
      <div className="settingInfoV3"><div className="settingTitleV3"><b>{event.name}</b></div><p className="muted">{event.description}</p><small>{event.key} · {stateLabel(event)}</small></div>
      <div className="inlineActions"><label>Sender<select aria-label={"Sender for "+event.name} value={event.sender||""} disabled={!!busy||!snapshot.connection.connected} onChange={change=>{if(change.target.value)void run("routing",()=>saveConfiguration({eventKey:event.key,sender:change.target.value}))}}><option value="">Select mailbox</option>{mailboxOptions}</select></label><button className="secondary" type="button" disabled={!!busy} onClick={()=>selectEvent(event)}>Edit template</button><button type="button" className="secondary" disabled={!!busy||(!event.active&&(!event.sender||!snapshot.integrationEnabled||!snapshot.connection.canSend))} onClick={()=>void run("event",()=>saveConfiguration({eventKey:event.key,active:!event.active,enableModule:!event.active}))}>{event.active?"Disable":"Enable"}</button></div>
     </div>)}</div>
    </details>;
   })}{!displayed.length&&<section className="panel">No events match the current filters.</section>}</div>
     </>}
  {snapshot&&section==="mailboxes"&&<>
   <section className="panel"><div className="panelTitle"><div><h2>Automatic mailbox setup</h2><p className="muted">Create missing system and department mailboxes through Mail System. Existing assigned mailboxes are preserved.</p></div></div><div className="two"><label>Verified provisioning domain<select value={domain} onChange={event=>setDomain(event.target.value)}><option value="">Select domain</option>{snapshot.provisioningDomains.map(value=><option key={value}>{value}</option>)}</select></label><button type="button" disabled={!!busy||!domain||!snapshot.integrationEnabled} onClick={()=>void run("provision",async()=>{const result=await request("mail-mailboxes","POST",{domain});if(result.ok===false)throw new Error((result.results||[]).filter((item:{ok:boolean})=>!item.ok).map((item:{address?:string;error?:string})=>(item.address||"Mailbox")+": "+(item.error||"Provisioning failed")).join("; "));await load();setMessage("Mailbox provisioning processed.")})}>Provision system & department mailboxes</button></div>{!snapshot.provisioningDomains.length&&<p className="muted">No provisioning domain is authorized. Authorize a verified domain in Mail System once.</p>}</section>
   <section className="panel"><h2>Create mailbox</h2><form onSubmit={event=>{event.preventDefault();void run("create-mailbox",async()=>{const result=await request("mail-mailboxes","POST",{mailboxes:[newBox]});if(result.ok===false)throw new Error(result.results?.[0]?.error||"Mailbox provisioning rejected.");setNewBox({address:"",kind:"department",display_name:""});await load();setMessage("Mailbox provisioned.")})}}><div className="two"><label>Address<input type="email" required value={newBox.address} onChange={event=>setNewBox(old=>({...old,address:event.target.value}))}/></label><label>Display name<input value={newBox.display_name} onChange={event=>setNewBox(old=>({...old,display_name:event.target.value}))}/></label></div><div className="two"><label>Mailbox type<select value={newBox.kind} onChange={event=>setNewBox(old=>({...old,kind:event.target.value}))}>{kinds.map(kind=><option key={kind} value={kind}>{title(kind)}</option>)}</select></label><button disabled={!!busy||!snapshot.integrationEnabled||!snapshot.provisioningDomains.length}>Create mailbox</button></div></form></section>
   {kinds.map(kind=><details key={kind} className="settingsGroupV3" open><summary className="settingsGroupHeadV3"><div><h2>{title(kind)} mailboxes</h2></div><span>{mailboxes.filter(box=>box.kind===kind).length}</span><i aria-hidden="true">⌄</i></summary><div className="settingsListV3">{mailboxes.filter(box=>box.kind===kind).map(box=><div className="settingV3" key={box.id}><b>{box.address}</b><span className="muted">Assigned to Billing Store</span></div>)}{!mailboxes.some(box=>box.kind===kind)&&<p className="muted">No assigned {kind} mailboxes.</p>}</div></details>)}
  </>}
  {snapshot&&section==="access"&&<><section className="panel"><h2>Detected directory</h2><p>{snapshot.directory.available? snapshot.directory.users+" staff · "+snapshot.directory.groups+" groups · "+snapshot.directory.departments+" departments":"Directory unavailable. Check administrator permissions."}</p></section><MailAccessManager key={accessRevision} onLoad={loadAccess} onSave={saveAccess} canManage={snapshot.integrationEnabled}/></>}
  {snapshot&&section==="templates"&&<><section className="panel"><div className="panelTitle"><div><h2>Custom templates</h2><p className="muted">Automated templates are edited directly on their event. Create reusable custom templates here.</p></div><button disabled={!!busy} type="button" onClick={()=>selectCustom()}>New template</button></div>{snapshot.customTemplates.map(template=><div className="listrow" key={template.id}><div><b>{template.display_name}</b><p className="muted">{template.template_key} · {template.active?"Active":"Disabled"}</p></div><button type="button" className="secondary" disabled={!!busy} onClick={()=>selectCustom(template)}>Edit</button></div>)}{!snapshot.customTemplates.length&&<p className="muted">No custom templates created.</p>}</section>{customKey&&editor(true)}</>}
  {snapshot&&section==="delivery"&&<section className="panel"><div className="panelTitle"><div><h2>Automated delivery</h2><p className="muted">Global delivery switch. Individual events must also be enabled and have a valid sender.</p></div><strong>{snapshot.deliveryEnabled?"Enabled":"Disabled"}</strong></div><label className="toggle"><input type="checkbox" checked={snapshot.deliveryEnabled} disabled={!!busy||(!snapshot.deliveryEnabled&&(!snapshot.connection.canSend||!snapshot.integrationEnabled))} onChange={event=>void run("delivery",async()=>{await request("mail-discovery","PUT",{action:"delivery",enabled:event.target.checked});await load(true);setMessage("Delivery setting saved.")})}/> Enable automated email delivery</label><p className="muted">Integration installation, API credentials and lifecycle remain in Integration Manager.</p></section>}
 </main>;
}
