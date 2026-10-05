"use client";

import Link from "next/link";
import {FormEvent,useCallback,useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import {settingMeta} from "@/lib/settings-meta";
import "../app/admin/settings-system-v2.css";

const GROUP_HELP:Record<string,string>={
 "Brand identity":"Names and labels that define the main OrbitFS brand customers see across public and signed-in areas.",
 "Admin identity":"Admin Center naming shown only to staff and administrators.",
 "Business identity":"Operator, company and support identity used in customer-facing business contexts.",
 "Authentication pages":"Headings and labels shown on sign-in and account registration experiences.",
 "Browser tab titles":"Controls how OrbitFS identifies Store and Admin pages in browser tabs.",
 "Accounts":"Registration, verification and customer account lifecycle behaviour.",
 "Availability":"Global platform availability and maintenance behaviour.",
 "Regional defaults":"Default language/region and timezone used when a more specific preference is unavailable.",
 "Contact details":"Platform-wide customer contact information.",
 "Currency & tax":"Primary billing currency and tax calculation/display defaults.",
 "Order numbering":"Generated order-number format and prefix behaviour.",
 "Account credit":"Wallet/account-credit availability, recharge limits and automatic application behaviour.",
 "Payment handling":"Rules that change how invoices may be paid or manually settled.",
 "Invoice lifecycle":"When invoices are created, when they become due and how unpaid invoices progress.",
 "Numbering":"Generated invoice-number format.",
 "Reminders":"Timing for invoice reminders before and after due dates.",
 "Overdue enforcement":"Automatic actions that may occur after an invoice remains unpaid. Review these carefully before changing them.",
 "Invoice branding":"Business identity displayed on customer invoices.",
 "Invoice content":"Long-form customer-facing invoice notes and payment instructions.",
 "Invoice presentation":"Default visual layout and display options used by customer invoices.",
 "Catalogue defaults":"Defaults applied when creating or presenting products.",
 "Fulfilment":"Controls when purchased products can be provisioned or delivered.",
 "Catalogue behaviour":"Global catalogue features such as add-ons, upgrades and administrative visibility.",
 "Checkout":"Customer checkout behaviour and supported order features.",
 "Stock":"How unavailable products are shown to customers.",
 "Branding":"Logo and brand assets used in public/customer-facing interfaces.",
 "Colours":"Global presentation colours used by supported OrbitFS surfaces.",
 "Interface":"Theme, density, navigation and corner-style defaults.",
 "Layout":"Global presentation sizing and content-width defaults.",
 "Homepage hero":"Primary storefront heading, description and call-to-action labels.",
 "Homepage sections":"Controls which optional storefront sections are shown.",
 "Footer & links":"Public footer copy and legal/status links.",
 "Customer portal":"Customer-facing content used inside the signed-in portal.",
 "Integration":"Controls how OrbitFS talks to the licence integration layer. Changes here can affect live licence behaviour.",
 "Automatic enforcement":"Rules that automatically suspend or restore licence/service access.",
 "Customer Licence Controller":"Defines which licence-management actions customers can perform themselves.",
 "Ticket defaults":"Default values assigned to newly created support tickets.",
 "Ticket lifecycle":"Controls reopening and automatic closure of support tickets.",
 "Customer controls":"Actions customers can perform themselves in the support system.",
 "Customer-facing content":"Text displayed to customers inside support surfaces.",
 "Other settings":"Additional configuration values for this area."
};

function typeName(type?:string,key?:string){
 if(key?.endsWith("_cents"))return "Money";
 return ({boolean:"On / off",select:"Dropdown",textarea:"Long text",number:"Number",color:"Colour",url:"URL",text:"Text"} as Record<string,string>)[type||"text"]||"Text";
}

export default function AdminSettingsEditor({category,title,description}:{category:string;title:string;description:string}){
 const sb=useMemo(()=>createClient(),[]);
 const [rows,setRows]=useState<any[]>([]);
 const [initial,setInitial]=useState<Record<string,string>>({});
 const [msg,setMsg]=useState("");
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [query,setQuery]=useState("");
 const [saving,setSaving]=useState(false);
 const [lastLoadedAt,setLastLoadedAt]=useState<Date|null>(null);

 const load=useCallback(async({quiet=false}:{quiet?:boolean}={})=>{
  if(!quiet)setLoading(true);
  setError("");
  const {data,error}=await sb.from("app_settings").select("*").eq("category",category).order("key");
  if(error){
   setError(error.message);
   if(!quiet)setLoading(false);
   return;
  }
  const loaded=data||[];
  setRows(loaded);
  setInitial(Object.fromEntries(loaded.map((r:any)=>[r.key,JSON.stringify({value:r.value,public_read:r.public_read})])));
  setLastLoadedAt(new Date());
  setMsg(quiet?"Live settings reloaded.":"");
  if(!quiet)setLoading(false);
 },[sb,category]);

 useEffect(()=>{void load()},[load]);

 const groups=useMemo(()=>{
  const grouped:Record<string,{row:any;index:number}[]>={};
  const legacy=new Set(["site.store_name","site.portal_name","site.login_heading","site.registration_heading","site.logo_text","site.navigation_style"]);
  const q=query.trim().toLowerCase();
  rows.forEach((r,i)=>{
   if(category==="customization"&&legacy.has(r.key))return;
   const m=settingMeta(r.key,r.value);
   if(q&&!`${m.label} ${m.description} ${m.group} ${r.key}`.toLowerCase().includes(q))return;
   (grouped[m.group]??=[]).push({row:r,index:i});
  });
  return grouped;
 },[rows,category,query]);

 const groupEntries=Object.entries(groups);
 const visibleRows=Object.values(groups).reduce((n,list)=>n+list.length,0);
 const publicCount=rows.filter(r=>r.public_read).length;
 const dangerCount=rows.filter(r=>settingMeta(r.key,r.value).danger).length;
 const dirtyCount=rows.filter(r=>initial[r.key]!==JSON.stringify({value:r.value,public_read:r.public_read})).length;

 function display(r:any){
  if(r.key.endsWith("_cents"))return (Number(r.value||0)/100).toFixed(2);
  return typeof r.value==="string"?r.value:JSON.stringify(r.value);
 }

 function change(i:number,v:any){
  setRows(current=>current.map((row,index)=>{
   if(index!==i)return row;
   let value=v;
   if(row.key.endsWith("_cents"))value=Math.round(Number(v||0)*100);
   else if(typeof row.value==="number")value=Number(v);
   return {...row,value};
  }));
  setMsg("");
 }

 function setVisibility(i:number,value:boolean){
  setRows(current=>current.map((row,index)=>index===i?{...row,public_read:value}:row));
  setMsg("");
 }

 function resetUnsaved(){
  setRows(current=>current.map(row=>{
   const encoded=initial[row.key];
   if(!encoded)return row;
   const parsed=JSON.parse(encoded);
   return {...row,value:parsed.value,public_read:parsed.public_read};
  }));
  setMsg("Unsaved changes reset.");
 }

 async function save(e:FormEvent){
  e.preventDefault();
  if(saving||dirtyCount===0)return;
  setSaving(true);
  setMsg("Saving changes…");
  for(const r of rows){
   const before=initial[r.key];
   const now=JSON.stringify({value:r.value,public_read:r.public_read});
   if(before===now)continue;
   const {error}=await sb.from("app_settings").update({value:r.value,public_read:r.public_read,updated_at:new Date().toISOString()}).eq("key",r.key);
   if(error){setMsg(error.message);setSaving(false);return;}
  }
  setInitial(Object.fromEntries(rows.map((r:any)=>[r.key,JSON.stringify({value:r.value,public_read:r.public_read})])));
  setLastLoadedAt(new Date());
  setMsg("Settings saved and applied live.");
  setSaving(false);
 }

 if(loading)return <main className="adminShell"><section className="panel">Loading settings…</section></main>;
 if(error)return <main className="adminShell"><section className="panel"><h2>Settings failed to load</h2><p>{error}</p></section></main>;

 return <main className="adminShell settingsEditorV3 settingsCompact">
  <div className="settingsEditorTop">
   <div className="settingsEditorBreadcrumbs"><Link href="/admin/settings">System settings</Link><span>›</span><span>{title}</span></div>
   <header className="settingsEditorHeader"><div><p className="eyebrow">MASTER ADMIN · CONFIGURATION</p><h1>{title}</h1><p className="muted">{description}</p></div></header>
   <div className="settingsSummaryV3">
    <article><small>Settings</small><strong>{rows.length}</strong></article>
    <article><small>Groups</small><strong>{groupEntries.length}</strong></article>
    <article><small>Public</small><strong>{publicCount}</strong></article>
    <article><small>High-impact</small><strong>{dangerCount}</strong></article>
   </div>
   <div className="settingsLiveBarV3">
    <div className="settingsLiveStateV3"><span className="settingsLiveDot" aria-hidden="true"/><div><b>Live configuration</b><small>{lastLoadedAt?`Last refreshed ${lastLoadedAt.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`:"Loading live state"}</small></div></div>
    <div className="settingsLiveActionsV3"><button type="button" className="secondary" onClick={()=>void load({quiet:true})} disabled={saving}>Reload live</button>{dirtyCount>0&&<button type="button" className="secondary" onClick={resetUnsaved} disabled={saving}>Reset unsaved</button>}</div>
   </div>
   <div className="settingsToolsV3"><div className="settingsSearchWrap"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={`Search ${title.toLowerCase()}…`} aria-label={`Search ${title}`}/>{query&&<button type="button" onClick={()=>setQuery("")} aria-label="Clear settings search">×</button>}</div><span>{visibleRows}/{rows.length}</span></div>
  </div>

  <form onSubmit={save} noValidate>
   <div className="settingsGroupStack">{groupEntries.map(([group,list],groupIndex)=>{
    const changedInGroup=list.filter(({row:r})=>initial[r.key]!==JSON.stringify({value:r.value,public_read:r.public_read})).length;
    return <details className="settingsGroupV3" key={group} open={query.trim()?true:groupIndex===0}>
    <summary className="settingsGroupHeadV3"><div><h2>{group}</h2><p>{GROUP_HELP[group]||GROUP_HELP["Other settings"]}</p></div><span>{changedInGroup?changedInGroup+" changed":list.length+" settings"}</span><i>⌄</i></summary>
    <div className="settingsListV3">
     {list.map(({row:r,index:i})=>{
      const m=settingMeta(r.key,r.value);
      const unit=r.key.endsWith("_cents")?"AUD":m.unit;
      const type=typeName(m.type,r.key);
      const changed=initial[r.key]!==JSON.stringify({value:r.value,public_read:r.public_read});
      return <article className={`settingV3 ${m.danger?"danger":""} ${changed?"changed":""}`} key={r.key}>
       <div className="settingInfoV3">
        <div className="settingTitleV3"><b>{m.label}</b><span className="settingTypeBadge">{type}</span>{changed&&<span className="settingChangedBadge">Unsaved</span>}{m.danger&&<span className="settingDangerBadge">High impact</span>}</div>
        <p>{m.description}</p>
        <div className="settingKeyV3"><code>{r.key}</code><span className="settingVisibilityState">{r.public_read?"Public read":"Internal"}</span></div>
       </div>
       <div className="settingControlV3">
        {m.type==="boolean"?<div className="settingBooleanV3"><button type="button" className={r.value===true?"active":""} onClick={()=>change(i,true)}>Enabled</button><button type="button" className={r.value===false?"active":""} onClick={()=>change(i,false)}>Disabled</button></div>
        :m.type==="select"?<select value={String(r.value??"")} onChange={e=>change(i,e.target.value)}>{m.options?.map(o=><option key={o} value={o}>{o.replaceAll("_"," ")}</option>)}</select>
        :m.type==="textarea"?<textarea rows={3} value={display(r)} onChange={e=>change(i,e.target.value)}/>
        :m.type==="color"?<div className="settingColorV3"><input type="color" value={display(r)||"#000000"} onChange={e=>change(i,e.target.value)}/><input type="text" value={display(r)} onChange={e=>change(i,e.target.value)} placeholder="#000000"/></div>
        :<div className={unit?"settingUnitRow":""}><input type={m.type==="number"||r.key.endsWith("_cents")?"number":m.type==="url"?"url":"text"} step={r.key.endsWith("_cents")?"0.01":m.type==="number"?"1":undefined} value={display(r)} onChange={e=>change(i,e.target.value)}/>{unit&&<span>{unit}</span>}</div>}
        <div className="settingVisibilityV3"><label><input type="checkbox" checked={!!r.public_read} onChange={e=>setVisibility(i,e.target.checked)}/> Public read</label><span>{r.public_read?"Available to approved public reads":"Admin/internal only"}</span></div>
       </div>
      </article>;
     })}
    </div>
   </details>})}</div>
   {visibleRows===0&&<div className="settingsNoResults">No settings match “{query}”.</div>}
   <div className="settingsSaveV3"><div><b>{saving?"Saving live configuration…":dirtyCount?`${dirtyCount} unsaved change${dirtyCount===1?"":"s"}`:"Live configuration is saved"}</b><span role="status">{msg||"Changes write directly to the authoritative Billing configuration."}</span></div><div className="settingsSaveActionsV3">{dirtyCount>0&&<button type="button" className="secondary" onClick={resetUnsaved} disabled={saving}>Reset</button>}<button type="submit" aria-busy={saving} disabled={dirtyCount===0||saving}>{saving?"Saving…":"Save changes"}</button></div></div>
  </form>
 </main>;
}
