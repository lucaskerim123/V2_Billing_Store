"use client";

import Link from "next/link";
import {useCallback,useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import styles from "./alert-system.module.css";

type AlertKind="notification"|"message"|"alert"|"announcement"|"maintenance";
type Severity="info"|"success"|"warning"|"error";
type Audience="selected"|"customers"|"staff"|"everyone";
type Recipient={id:string;label:string;email?:string|null;customer_number?:string|null;kind:"staff"|"customer";status?:string|null};
type ProductOption={slug:string;name:string};
type GroupOption={slug:string;name:string};
type Preview={count:number;sample:Array<{user_id:string;surface:string;label:string;email?:string|null}>};
type Conditions={customer_status:string;country_code:string;verified_only:boolean;product_slug:string;service_status:string;license_state:string;staff_status:string;staff_department:string;staff_group:string};

type AlertOptions={
  settings:Record<string,any>;
  products:ProductOption[];
  customer_statuses:string[];
  countries:string[];
  service_statuses:string[];
  license_states:string[];
  staff_statuses:string[];
  staff_departments:string[];
  staff_groups:GroupOption[];
};

const kinds:Array<{value:AlertKind;label:string;help:string}>=[
  {value:"notification",label:"Notification",help:"Standard informational item in the notification centre."},
  {value:"message",label:"Message",help:"Direct administrative message for the selected audience."},
  {value:"alert",label:"Alert",help:"Attention-required warning or important operational notice."},
  {value:"announcement",label:"Announcement",help:"Platform-wide or targeted announcement."},
  {value:"maintenance",label:"Maintenance",help:"Service availability, maintenance or disruption notice."}
];
const severityDefaults:Record<AlertKind,Severity>={notification:"info",message:"info",alert:"warning",announcement:"success",maintenance:"warning"};
const blankConditions:Conditions={customer_status:"",country_code:"",verified_only:false,product_slug:"",service_status:"",license_state:"",staff_status:"",staff_department:"",staff_group:""};

function cleanConditions(c:Conditions){return Object.fromEntries(Object.entries(c).filter(([,v])=>v!==""&&v!==false));}
function pretty(value:string){return value.replaceAll("_"," ").replace(/\b\w/g,m=>m.toUpperCase())}

export default function OrbitFSAlertSystemPage(){
  const [sb]=useState(()=>createClient());
  const [loading,setLoading]=useState(true);
  const [options,setOptions]=useState<AlertOptions|null>(null);
  const [kind,setKind]=useState<AlertKind>("notification");
  const [severity,setSeverity]=useState<Severity>("info");
  const [audience,setAudience]=useState<Audience>("selected");
  const [title,setTitle]=useState("");
  const [message,setMessage]=useState("");
  const [actionUrl,setActionUrl]=useState("");
  const [conditions,setConditions]=useState<Conditions>(blankConditions);
  const [recipientQuery,setRecipientQuery]=useState("");
  const [recipients,setRecipients]=useState<Recipient[]>([]);
  const [selected,setSelected]=useState<string[]>([]);
  const [recipientLoading,setRecipientLoading]=useState(false);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [previewing,setPreviewing]=useState(false);
  const [sending,setSending]=useState(false);
  const [status,setStatus]=useState("");
  const [confirmSend,setConfirmSend]=useState(false);

  const loadRecipients=useCallback(async(q="")=>{
    setRecipientLoading(true);
    const {data,error}=await sb.rpc("notification_admin_recipient_options",{p_query:q});
    setRecipientLoading(false);
    if(error){setStatus(error.message);return}
    setRecipients((data?.recipients||[]) as Recipient[]);
  },[sb]);

  useEffect(()=>{
    (async()=>{
      const {data,error}=await sb.rpc("orbitfs_alert_options");
      if(error){setStatus(error.message);setLoading(false);return}
      const o=data as AlertOptions;
      setOptions(o);
      const enabledKinds=kinds.filter(k=>o.settings?.[`type_${k.value}_enabled`]!==false);
      const configuredKind=(o.settings?.default_type||"notification") as AlertKind;
      const firstKind=(enabledKinds.some(k=>k.value===configuredKind)?configuredKind:enabledKinds[0]?.value||"notification") as AlertKind;
      setKind(firstKind);
      setSeverity((o.settings?.default_severity||severityDefaults[firstKind]) as Severity);
      setAudience((o.settings?.default_audience||"selected") as Audience);
      setLoading(false);
    })();
  },[sb]);

  useEffect(()=>{
    if(audience!=="selected")return;
    const timer=setTimeout(()=>void loadRecipients(recipientQuery),220);
    return()=>clearTimeout(timer);
  },[audience,recipientQuery,loadRecipients]);

  const enabledKinds=useMemo(()=>kinds.filter(k=>options?.settings?.[`type_${k.value}_enabled`]!==false),[options]);
  const conditionCount=Object.keys(cleanConditions(conditions)).length;
  const maxMessage=Number(options?.settings?.max_message_length||4000);
  const systemEnabled=options?.settings?.enabled!==false;
  const manualEnabled=options?.settings?.manual_send_enabled!==false;
  const linksEnabled=options?.settings?.action_links_enabled!==false;

  function changeKind(next:AlertKind){setKind(next);setSeverity(severityDefaults[next]);setPreview(null);setConfirmSend(false);setStatus("")}
  function updateCondition<K extends keyof Conditions>(key:K,value:Conditions[K]){setConditions(v=>({...v,[key]:value}));setPreview(null);setConfirmSend(false);setStatus("")}
  function toggleRecipient(id:string){setSelected(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);setPreview(null);setConfirmSend(false);setStatus("")}

  async function getPreview(){
    if(audience==="selected"&&selected.length===0){setStatus("Select at least one recipient first.");return null}
    setPreviewing(true);setStatus("");
    const {data,error}=await sb.rpc("orbitfs_alert_preview",{
      p_audience:audience,
      p_recipient_user_ids:audience==="selected"?selected:null,
      p_conditions:cleanConditions(conditions)
    });
    setPreviewing(false);
    if(error){setStatus(error.message);return null}
    const p=data as Preview;setPreview(p);setConfirmSend(false);return p;
  }

  async function sendAlert(){
    if(!title.trim()){setStatus("Add a title before sending.");return}
    if(message.length>maxMessage){setStatus(`Message is over the configured ${maxMessage} character limit.`);return}
    const p=preview||await getPreview();
    if(!p||p.count===0){if(p)setStatus("No recipients match this audience and its conditions.");return}
    const threshold=Number(options?.settings?.confirmation_threshold||25);
    const needsConfirm=p.count>=threshold||audience!=="selected";
    if(needsConfirm&&!confirmSend){
      setConfirmSend(true);
      setStatus(`Review complete. Confirm sending this ${kind} to ${p.count} matching recipient${p.count===1?"":"s"}.`);
      return;
    }
    setSending(true);setStatus("");
    const {data,error}=await sb.rpc("orbitfs_alert_send",{
      p_audience:audience,
      p_recipient_user_ids:audience==="selected"?selected:null,
      p_kind:kind,
      p_title:title.trim(),
      p_message:message.trim(),
      p_severity:severity,
      p_action_url:linksEnabled&&actionUrl.trim()?actionUrl.trim():null,
      p_conditions:cleanConditions(conditions)
    });
    setSending(false);
    if(error){setStatus(error.message);return}
    const sent=Number(data?.sent||0);
    setStatus(`Sent to ${sent} recipient${sent===1?"":"s"}.`);
    setTitle("");setMessage("");setActionUrl("");setPreview(null);setConfirmSend(false);
  }

  if(loading)return <main className={styles.shell}><section className={styles.card}>Loading OrbitFS Alert System…</section></main>;
  if(!options)return <main className={styles.shell}><section className={styles.card}><h1>OrbitFS Alert System</h1><p>{status||"Alert configuration could not be loaded."}</p></section></main>;

  return <main className={styles.shell}>
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>MASTER ADMIN · SYSTEM</p><h1>OrbitFS Alert System</h1><p>Send controlled notifications, messages and alerts using audience rules and optional recipient conditions.</p></div>
      <div className={styles.heroActions}><Link href="/admin/settings/alerts">Alert settings</Link><Link className={styles.secondary} href="/admin/audit">Audit log</Link></div>
    </header>

    <div className={styles.statusStrip}>
      <article><small>System</small><b data-good={systemEnabled}>{systemEnabled?"Enabled":"Disabled"}</b></article>
      <article><small>Manual sending</small><b data-good={manualEnabled}>{manualEnabled?"Enabled":"Disabled"}</b></article>
      <article><small>Realtime</small><b data-good={options.settings?.realtime_enabled!==false}>{options.settings?.realtime_enabled!==false?"Enabled":"Disabled"}</b></article>
      <article><small>Enabled types</small><b>{enabledKinds.length}/{kinds.length}</b></article>
    </div>

    {(!systemEnabled||!manualEnabled)&&<section className={styles.disabledNotice}><b>Sending is currently disabled by Alert System settings.</b><span>You can still review targeting here, but the backend will block dispatches until it is enabled.</span></section>}

    <div className={styles.grid}>
      <section className={styles.card}>
        <div className={styles.sectionHead}><div><span>01</span><h2>Alert content</h2></div><small>Choose what recipients will see</small></div>
        <div className={styles.typeGrid}>{enabledKinds.map(k=><button type="button" key={k.value} onClick={()=>changeKind(k.value)} className={kind===k.value?styles.activeType:""}><b>{k.label}</b><span>{k.help}</span></button>)}</div>
        <div className={styles.twoCols}>
          <label><span>Severity</span><select value={severity} onChange={e=>setSeverity(e.target.value as Severity)}><option value="info">Info</option><option value="success">Success</option><option value="warning">Warning</option><option value="error">Critical / error</option></select></label>
          <label><span>Audience</span><select value={audience} onChange={e=>{setAudience(e.target.value as Audience);setPreview(null);setConfirmSend(false);setStatus("")}}><option value="selected">Selected people</option><option value="customers">Customers</option><option value="staff">Active staff</option><option value="everyone">Everyone</option></select></label>
        </div>
        <label><span>Title</span><input maxLength={160} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Alert title"/></label>
        <label><span>Message <em>{message.length}/{maxMessage}</em></span><textarea rows={6} maxLength={maxMessage} value={message} onChange={e=>setMessage(e.target.value)} placeholder="Message shown to matching recipients"/></label>
        {linksEnabled&&<label><span>Open path <em>optional</em></span><input value={actionUrl} onChange={e=>setActionUrl(e.target.value)} placeholder="/portal/... or /admin/..."/></label>}
      </section>

      <section className={styles.card}>
        <div className={styles.sectionHead}><div><span>02</span><h2>Recipient targeting</h2></div><small>Base audience + optional AND conditions</small></div>
        {audience==="selected"&&<div className={styles.recipientPicker}>
          <div className={styles.searchRow}><input value={recipientQuery} onChange={e=>setRecipientQuery(e.target.value)} placeholder="Search name, email or customer number"/><b>{selected.length} selected</b></div>
          <div className={styles.recipientList}>{recipientLoading?<p>Loading recipients…</p>:recipients.length===0?<p>No matching recipients.</p>:recipients.map(r=><button type="button" key={r.id} onClick={()=>toggleRecipient(r.id)} className={selected.includes(r.id)?styles.selectedRecipient:""}><span><b>{r.label}</b><small>{[r.email,r.customer_number].filter(Boolean).join(" · ")||r.id}</small></span><em>{r.kind}</em></button>)}</div>
        </div>}

        <div className={styles.conditionsHead}><div><h3>Conditions</h3><p>Leave every field blank to target the full audience. Multiple conditions are combined with AND logic.</p></div>{conditionCount>0&&<button type="button" onClick={()=>{setConditions(blankConditions);setPreview(null);setConfirmSend(false)}}>Clear {conditionCount}</button>}</div>
        <div className={styles.conditionGrid}>
          <label><span>Customer status</span><select value={conditions.customer_status} onChange={e=>updateCondition("customer_status",e.target.value)}><option value="">Any status</option>{options.customer_statuses.map(v=><option key={v} value={v}>{pretty(v)}</option>)}</select></label>
          <label><span>Country</span><select value={conditions.country_code} onChange={e=>updateCondition("country_code",e.target.value)}><option value="">Any country</option>{options.countries.map(v=><option key={v} value={v}>{v}</option>)}</select></label>
          <label><span>Owns product</span><select value={conditions.product_slug} onChange={e=>updateCondition("product_slug",e.target.value)}><option value="">Any product</option>{options.products.map(v=><option key={v.slug} value={v.slug}>{v.name}</option>)}</select></label>
          <label><span>Service status</span><select value={conditions.service_status} onChange={e=>updateCondition("service_status",e.target.value)}><option value="">Any service status</option>{options.service_statuses.map(v=><option key={v} value={v}>{pretty(v)}</option>)}</select></label>
          <label><span>Licence state</span><select value={conditions.license_state} onChange={e=>updateCondition("license_state",e.target.value)}><option value="">Any licence state</option>{options.license_states.map(v=><option key={v} value={v}>{pretty(v)}</option>)}</select></label>
          <label><span>Staff status</span><select value={conditions.staff_status} onChange={e=>updateCondition("staff_status",e.target.value)}><option value="">Any staff status</option>{options.staff_statuses.map(v=><option key={v} value={v}>{pretty(v)}</option>)}</select></label>
          <label><span>Staff department</span><select value={conditions.staff_department} onChange={e=>updateCondition("staff_department",e.target.value)}><option value="">Any department</option>{options.staff_departments.map(v=><option key={v} value={v}>{v}</option>)}</select></label>
          <label><span>Staff group</span><select value={conditions.staff_group} onChange={e=>updateCondition("staff_group",e.target.value)}><option value="">Any group</option>{options.staff_groups.map(v=><option key={v.slug} value={v.slug}>{v.name}</option>)}</select></label>
          <label className={styles.checkRow}><input type="checkbox" checked={conditions.verified_only} onChange={e=>updateCondition("verified_only",e.target.checked)}/><span><b>Verified email only</b><small>Only recipients with a verified account email.</small></span></label>
        </div>
      </section>
    </div>

    <section className={styles.dispatchCard}>
      <div className={styles.dispatchTop}><div><p className={styles.eyebrow}>03 · VERIFY & SEND</p><h2>Dispatch</h2><p>Preview the effective audience before sending. The final count is calculated by Supabase using the same rules as the dispatch.</p></div><div className={styles.dispatchButtons}><button type="button" className={styles.previewButton} onClick={()=>void getPreview()} disabled={previewing||(audience==="selected"&&selected.length===0)}>{previewing?"Checking…":"Preview recipients"}</button><button type="button" className={styles.sendButton} onClick={()=>void sendAlert()} disabled={sending||!systemEnabled||!manualEnabled||!title.trim()||(audience==="selected"&&selected.length===0)}>{sending?"Sending…":confirmSend&&preview?`Confirm send to ${preview.count}`:`Send ${pretty(kind)}`}</button></div></div>
      {preview&&<div className={styles.previewBox}><div className={styles.previewCount}><strong>{preview.count}</strong><span>matching recipient{preview.count===1?"":"s"}</span></div><div className={styles.previewSample}>{preview.sample.length===0?<p>No matches.</p>:preview.sample.map(r=><span key={r.user_id}><b>{r.label}</b><small>{r.email||r.surface}</small></span>)}</div></div>}
      {status&&<p className={styles.statusMessage}>{status}</p>}
    </section>
  </main>;
}
