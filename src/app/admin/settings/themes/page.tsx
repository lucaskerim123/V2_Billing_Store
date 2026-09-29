"use client";

import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import styles from "./theme-manager.module.css";

type Theme={id:string;name:string;surface:"admin"|"customer";version:string;description:string;is_builtin:boolean;manifest:any;css_text?:string|null};

export default function ThemeManagerPage(){
 const [sb]=useState(()=>createClient());
 const [themes,setThemes]=useState<Theme[]>([]);
 const [activeAdmin,setActiveAdmin]=useState("V5A");
 const [activeCustomer,setActiveCustomer]=useState("V3C");
 const [status,setStatus]=useState("");
 const [manifestText,setManifestText]=useState("");
 const [cssText,setCssText]=useState("");

 const adminThemes=useMemo(()=>themes.filter(t=>t.surface==="admin"),[themes]);
 const customerThemes=useMemo(()=>themes.filter(t=>t.surface==="customer"),[themes]);

 async function load(){
  const {data,error}=await sb.rpc("orbitfs_theme_list");
  if(error){setStatus(error.message);return}
  setThemes(data?.themes||[]);
  setActiveAdmin(data?.active_admin||"V5A");
  setActiveCustomer(data?.active_customer||"V3C");
 }

 useEffect(()=>{void load()},[]);

 async function apply(id:string){
  const theme=themes.find(t=>t.id===id);
  if(!theme)return;
  setStatus(`Applying ${id}…`);
  const {error}=await sb.rpc("orbitfs_theme_apply",{p_theme_id:id});
  if(error){setStatus(error.message);return}
  if(theme.surface==="admin")setActiveAdmin(id);else setActiveCustomer(id);
  window.dispatchEvent(new CustomEvent("orbitfs-theme-changed",{detail:{surface:theme.surface,id}}));
  setStatus(`${id} applied to the ${theme.surface==="admin"?"Admin Panel":"Customer Portal"}.`);
  await load();
 }

 async function importTheme(){
  try{
   const manifest=JSON.parse(manifestText);
   setStatus("Importing theme…");
   const {data,error}=await sb.rpc("orbitfs_theme_import",{p_manifest:manifest,p_css:cssText});
   if(error){setStatus(error.message);return}
   setStatus(`${data.theme_id} imported for ${data.surface}.`);
   setManifestText("");
   setCssText("");
   await load();
  }catch{setStatus("Manifest must be valid JSON.")}
 }

 return <main className={styles.shell}>
  <header className={styles.head}><div><p className="eyebrow">SYSTEM · THEMES</p><h1>OrbitFS Theme Manager</h1><p className="muted">Choose Admin and Customer themes independently. V3 remains available as the stable legacy family; V5 is the current redesign family.</p></div></header>

  <section className={styles.selectorGrid} aria-label="Active theme selectors">
   <label className={styles.selector}>
    <span>Admin Panel</span>
    <select value={activeAdmin} onChange={e=>void apply(e.target.value)}>
     {adminThemes.map(t=><option key={t.id} value={t.id}>{t.name} · {t.id}</option>)}
    </select>
    <small>Current: {activeAdmin}</small>
   </label>
   <label className={styles.selector}>
    <span>Customer Portal</span>
    <select value={activeCustomer} onChange={e=>void apply(e.target.value)}>
     {customerThemes.map(t=><option key={t.id} value={t.id}>{t.name} · {t.id}</option>)}
    </select>
    <small>Current: {activeCustomer}</small>
   </label>
  </section>

  <section className={styles.grid}>{themes.map(t=>{const active=t.surface==="admin"?activeAdmin===t.id:activeCustomer===t.id;return <article key={t.id} className={`${styles.card} ${active?styles.active:""}`}>
   <div className={styles.cardTop}><div><h2>{t.name}</h2><p>{t.description}</p></div><span className={styles.badge}>{active?"ACTIVE":"INSTALLED"}</span></div>
   <div className={styles.meta}><span>{t.id}</span><span>{t.surface==="admin"?"Admin Panel":"Customer Portal"}</span><span>v{t.version}</span><span>{t.is_builtin?"Built-in":"Imported"}</span></div>
   <div className={styles.actions}><button type="button" onClick={()=>void apply(t.id)} disabled={active}>{active?"Applied":"Apply theme"}</button></div>
  </article>})}</section>

  <section className={styles.import}><div><h2>Import completed theme</h2><p className="muted">Paste the package manifest and CSS. Required manifest fields: <code>id</code>, <code>name</code>, <code>surface</code> and <code>version</code>.</p></div><textarea value={manifestText} onChange={e=>setManifestText(e.target.value)} placeholder='{"id":"MyThemeA","name":"My Theme","surface":"admin","version":"1.0.0"}'/><textarea value={cssText} onChange={e=>setCssText(e.target.value)} placeholder="Theme CSS…"/><div className={styles.actions}><button type="button" onClick={()=>void importTheme()} disabled={!manifestText.trim()||!cssText.trim()}>Import theme</button></div></section>
  {status&&<div className={styles.status} role="status">{status}</div>}
 </main>;
}
