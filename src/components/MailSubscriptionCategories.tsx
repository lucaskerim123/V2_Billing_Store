"use client";

import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import styles from "./MailSubscriptionCategories.module.css";

type Category={
  category_key:string;label:string;description:string;
  required:boolean;default_subscribed:boolean;enabled:boolean;sort_order:number
};
type Mapping={event_key:string;category_key:string};
type Automation={event_key:string;name:string;template_key?:string|null;enabled?:boolean};
type Template={template_key:string};

function isCritical(key:string){
  return /^(auth\.|security\.|password\.|customer\.|invoice\.|payment\.|cancellation\.|licen[cs]e\.|order\.created$|order\.paid$|service\.suspended$|service\.terminated$|deployment\.failed$|deployment\.action_required$|deployment\.rollback_succeeded$|support\.ticket\.created$)/.test(key);
}
function inferred(key:string){
  if(isCritical(key))return "system";
  if(key==="release.update_available")return "updates_available";
  if(key==="release.update_released"||key==="news.product_updates")return "product_updates";
  if(key.startsWith("news."))return "news";
  if(key.startsWith("deployment."))return "deployments";
  if(key.startsWith("support."))return "support";
  if(key.startsWith("service."))return "orders";
  return "system";
}
export default function MailSubscriptionCategories({
  categories,events,automations=[],templates=[],onSave,showEvents=false,tone="light"
}:{
  categories:Category[],events:Mapping[],automations?:Automation[],templates?:Template[],
  onSave:(value:any)=>Promise<boolean>,showEvents?:boolean,tone?:"light"|"dark"
}){
  const [drafts,setDrafts]=useState<Record<string,Category>>({});
  const [busy,setBusy]=useState<string>("");
  const [message,setMessage]=useState("");
  const [newLabel,setNewLabel]=useState("");
  const [newKey,setNewKey]=useState("");
  const [keyEdited,setKeyEdited]=useState(false);
  const [newDescription,setNewDescription]=useState("");
  const [eventSearch,setEventSearch]=useState("");
  useEffect(()=>setDrafts(Object.fromEntries(categories.map(c=>[c.category_key,{...c}]))),[categories]);
  const sorted=useMemo(()=>[...categories].sort((a,b)=>a.sort_order-b.sort_order||a.label.localeCompare(b.label)),[categories]);
  const map=useMemo(()=>Object.fromEntries(events.map(e=>[e.event_key,e.category_key])),[events]);
  const available=useMemo(()=>new Set(templates.map(t=>t.template_key)),[templates]);
  const patch=(key:string,change:Partial<Category>)=>setDrafts(v=>({...v,[key]:{...v[key],...change}}));
  async function saveCategory(c:Category){
    const d=drafts[c.category_key];if(!d)return;
    setBusy(c.category_key);setMessage("");
    const ok=await onSave({action:"subscription_category",key:c.category_key,label:d.label,description:d.description,defaultSubscribed:d.default_subscribed,enabled:d.enabled,sortOrder:d.sort_order});
    setMessage(ok?"Subscription category saved.":"Could not save category.");
    setBusy("");
  }
  async function addCategory(){
    const key=newKey.trim().toLowerCase();
    if(!/^[a-z][a-z0-9_]{1,47}$/.test(key)||newLabel.trim().length<2){setMessage("Enter a valid category name and lowercase key.");return}
    if(categories.some(c=>c.category_key===key)){setMessage("A category with this key already exists.");return}
    setBusy("new-category");setMessage("");
    const ok=await onSave({action:"subscription_category",key,label:newLabel.trim(),description:newDescription.trim(),defaultSubscribed:true,enabled:true,sortOrder:sorted.length?Math.max(...sorted.map(c=>c.sort_order))+10:10});
    if(ok){setNewLabel("");setNewKey("");setNewDescription("");setKeyEdited(false);setMessage("Category added and subscribed by default.");}else setMessage("Could not create the category.");
    setBusy("");
  }
  async function assignEvent(eventKey:string,categoryKey:string){
    setBusy(eventKey);setMessage("");
    const ok=await onSave({action:"subscription_event",eventKey,categoryKey});
    setMessage(ok?"Mail event category updated.":"Could not update the mail event category.");
    setBusy("");
  }
  return <div className={styles.root+" "+(tone==="dark"?styles.dark:"")}>
    <div className={styles.header}>
      <div><h3>Customer email categories</h3><p>Customers start subscribed. These categories appear in Account Settings and control the actual mail-sending paths.</p></div>
      <span className={styles.count}>{sorted.length} categories</span>
    </div>
    <details className={styles.categoryDrawer}>
      <summary className={styles.drawerSummary}><span>Manage subscription categories</span><span className={styles.count}>{sorted.length} categories</span></summary>
      <div className={styles.grid}>
      {sorted.map(c=>{
        const d=drafts[c.category_key]||c;
        const eventCount=automations.filter(a=>(map[a.event_key]||inferred(a.event_key))===c.category_key).length;
        return <details className={styles.card} key={c.category_key}>
          <summary className={styles.cardTop}>
            <span className={styles.cardTitle}><b>{c.label}</b><small>{c.category_key.replaceAll("_"," ")} · {c.required?"Mandatory":eventCount+" linked events"}</small></span>
            <span className={c.required?styles.required:styles.optional}>{c.required?"Required":c.enabled?"Optional":"Paused"}</span>
          </summary>
          <div className={styles.cardBody}>
            <label className={styles.field}>Customer-facing category name<input value={d.label} maxLength={80} onChange={e=>patch(c.category_key,{label:e.target.value})}/></label>
            <label className={styles.field}>Description<textarea rows={2} maxLength={400} value={d.description} onChange={e=>patch(c.category_key,{description:e.target.value})}/></label>
            <div className={styles.controls}>
              <label><input type="checkbox" checked={d.required||d.default_subscribed} disabled={d.required} onChange={e=>patch(c.category_key,{default_subscribed:e.target.checked})}/><span>Subscribed by default</span></label>
              <label><input type="checkbox" checked={d.required||d.enabled} disabled={d.required} onChange={e=>patch(c.category_key,{enabled:e.target.checked})}/><span>Category enabled</span></label>
            </div>
            <div className={styles.cardFoot}><small>{c.required?"Critical messages cannot be turned off":eventCount+" linked email events"}</small><button type="button" disabled={busy!==""} onClick={()=>saveCategory(c)}>{busy===c.category_key?"Saving…":"Save category"}</button></div>
          </div>
        </details>;
      })}
    </div>
    <details className={styles.addCategory}><summary>Add another optional category</summary>
      <div className={styles.newCategoryForm}>
        <label className={styles.field}>Category name<input value={newLabel} maxLength={80} onChange={e=>{const value=e.target.value;setNewLabel(value);if(!keyEdited)setNewKey(value.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,48))}} placeholder="Maintenance announcements"/></label>
        <label className={styles.field}>Category key<input value={newKey} maxLength={48} onChange={e=>{setKeyEdited(true);setNewKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,""))}} placeholder="maintenance_announcements"/></label>
        <label className={styles.field}>Description<textarea rows={2} maxLength={400} value={newDescription} onChange={e=>setNewDescription(e.target.value)} placeholder="What will customers receive?"/></label>
        <button type="button" disabled={busy!==""} onClick={addCategory}>{busy==="new-category"?"Adding…":"Add category"}</button>
      </div>
      <p className={styles.help}>New categories start enabled and subscribed by default. Assign events below to make them control delivery. Disable a category to pause it without removing existing customer choices.</p>
    </details>
    </details>
    {showEvents&&<details className={styles.routing}>
      <summary>Mail event routing <span>{automations.length} automations</span></summary>
      <p>Choose a category to view its events. Security, payment and deployment-problem events always stay mandatory.</p>
      <input className={styles.eventSearch} placeholder="Find an automation…" value={eventSearch} onChange={e=>setEventSearch(e.target.value)} aria-label="Search mail events"/>
      <div className={styles.eventGroups}>
        {sorted.map(c=>{
          const members=[...automations].filter(a=>(isCritical(a.event_key)?"system":map[a.event_key]||inferred(a.event_key))===c.category_key)
            .filter(a=>`${a.name} ${a.event_key} ${a.template_key||""}`.toLowerCase().includes(eventSearch.toLowerCase()))
            .sort((a,b)=>a.event_key.localeCompare(b.event_key));
          if(!members.length)return null;
          return <details className={styles.eventGroup} key={c.category_key} open={eventSearch.trim()?true:undefined}>
            <summary>{c.label} <small>{members.length} events</small></summary>
            <div className={styles.eventList}>
              {members.map(a=>{
                const critical=isCritical(a.event_key);
                const categoryKey=critical?"system":map[a.event_key]||inferred(a.event_key);
                return <div className={styles.event} key={a.event_key}>
                  <div><b>{a.name}</b><small>{a.event_key}</small><small>{a.template_key?available.has(a.template_key)?"Template: "+a.template_key:"Template missing: "+a.template_key:"No template assigned"}</small></div>
                  <div className={styles.eventControl}>
                    <select aria-label={a.name+" category"} disabled={critical||busy!==""} value={categoryKey} onChange={e=>assignEvent(a.event_key,e.target.value)}>
                      {sorted.map(option=><option key={option.category_key} value={option.category_key} disabled={!critical&&option.required}>{option.label}</option>)}
                    </select>{critical&&<small>Locked · mandatory</small>}
                  </div>
                </div>;
              })}
            </div>
          </details>;
        })}
      </div>
    </details>}
    {!showEvents&&<p className={styles.help}>Assign individual automations to categories in <Link href="/admin/settings/outbound-mail">Outbound Mail settings</Link>.</p>}
    {message&&<p role="status" className={styles.message}>{message}</p>}
  </div>;
}
