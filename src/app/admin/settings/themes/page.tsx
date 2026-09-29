"use client";

import {ChangeEvent,useEffect,useMemo,useState} from "react";
import JSZip from "jszip";
import {createClient} from "@/lib/supabase";
import styles from "./theme-manager.module.css";

type Surface="admin"|"customer";
type Theme={
  id:string;
  name:string;
  surface:Surface;
  version:string;
  description:string;
  is_builtin:boolean;
  manifest:any;
  css_text?:string|null;
};

function zipDirname(value:string){
  const at=value.lastIndexOf("/");
  return at<0?"":value.slice(0,at+1);
}

function resolveZipPath(base:string,relative:string){
  const parts=(base+relative).split("/");
  const out:string[]=[];
  for(const part of parts){
    if(!part||part===".")continue;
    if(part===".."){
      if(!out.length)throw new Error("Theme CSS import escapes the package root.");
      out.pop();
    }else out.push(part);
  }
  return out.join("/");
}

async function inlinePackageCss(zip:JSZip,filePath:string,rootPrefix:string,seen:Set<string>):Promise<string>{
  if(seen.has(filePath))throw new Error("Circular CSS import in theme package: "+filePath);
  seen.add(filePath);
  const file=zip.file(filePath);
  if(!file)throw new Error("Theme CSS file is missing: "+filePath);
  const css=await file.async("string");
  const rx=/@import\s+(?:url\()?["']([^"']+\.css)["']\)?\s*;/g;
  let output="";
  let last=0;
  let match:RegExpExecArray|null;
  while((match=rx.exec(css))){
    output+=css.slice(last,match.index);
    const importPath=match[1];
    if(/^(?:https?:|data:|\/\/)/i.test(importPath))throw new Error("External CSS imports are not allowed in uploaded theme packages.");
    const resolved=resolveZipPath(zipDirname(filePath),importPath);
    if(!resolved.startsWith(rootPrefix))throw new Error("Theme CSS import escapes the package root.");
    output+=await inlinePackageCss(zip,resolved,rootPrefix,new Set(seen));
    last=rx.lastIndex;
  }
  output+=css.slice(last);
  return output;
}

export default function ThemeManagerPage(){
  const [sb]=useState(()=>createClient());
  const [themes,setThemes]=useState<Theme[]>([]);
  const [activeAdmin,setActiveAdmin]=useState("V3A");
  const [activeCustomer,setActiveCustomer]=useState("V3C");
  const [status,setStatus]=useState("");
  const [packageBusy,setPackageBusy]=useState(false);
  const [manifestText,setManifestText]=useState("");
  const [cssText,setCssText]=useState("");

  async function load(){
    const {data,error}=await sb.rpc("orbitfs_theme_list");
    if(error){setStatus(error.message);return}
    setThemes(data?.themes||[]);
    setActiveAdmin(data?.active_admin||"V3A");
    setActiveCustomer(data?.active_customer||"V3C");
  }

  useEffect(()=>{void load()},[]);

  const grouped=useMemo(()=>({
    admin:themes.filter(t=>t.surface==="admin"),
    customer:themes.filter(t=>t.surface==="customer")
  }),[themes]);

  function announce(surface:Surface){
    window.dispatchEvent(new CustomEvent("orbitfs-theme-changed",{detail:{surface}}));
    if(typeof BroadcastChannel!=="undefined"){
      const channel=new BroadcastChannel("orbitfs-theme");
      channel.postMessage({surface});
      channel.close();
    }
  }

  async function apply(theme:Theme){
    setStatus("Applying "+theme.id+"…");
    const {error}=await sb.rpc("orbitfs_theme_apply",{p_theme_id:theme.id});
    if(error){setStatus(error.message);return}
    announce(theme.surface);
    setStatus(theme.id+" applied to "+(theme.surface==="admin"?"Admin Panel":"Customer Portal")+".");
    await load();
  }

  async function importManifest(manifest:any,css:string){
    setStatus("Importing "+String(manifest?.id||"theme")+"…");
    const {data,error}=await sb.rpc("orbitfs_theme_import",{p_manifest:manifest,p_css:css});
    if(error)throw error;
    setStatus(String(data.theme_id)+" imported for "+String(data.surface)+".");
    await load();
  }

  async function importTheme(){
    try{
      const manifest=JSON.parse(manifestText);
      await importManifest(manifest,cssText);
      setManifestText("");
      setCssText("");
    }catch(error:any){
      setStatus(error?.message||"Manifest must be valid JSON.");
    }
  }

  async function importPackage(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];
    event.target.value="";
    if(!file)return;
    setPackageBusy(true);
    setStatus("Reading "+file.name+"…");
    try{
      const zip=await JSZip.loadAsync(await file.arrayBuffer());
      const manifests=Object.keys(zip.files).filter(name=>name.endsWith("/manifest.json"));
      if(manifests.length!==1)throw new Error("Theme package must contain exactly one manifest.json.");
      const manifestPath=manifests[0];
      const manifest=JSON.parse(await zip.file(manifestPath)!.async("string"));
      if(!manifest.id||!manifest.surface||!manifest.entry)throw new Error("Theme manifest requires id, surface and entry.");
      const prefix=manifestPath.slice(0,-"manifest.json".length);
      if(prefix!==String(manifest.id)+"/")throw new Error("Theme package root must match the manifest id.");
      const entryPath=prefix+String(manifest.entry).replace(/^\.\//,"");
      const bundledCss=await inlinePackageCss(zip,entryPath,prefix,new Set());
      if(/url\((?!\s*["']?(?:data:|#))/i.test(bundledCss))throw new Error("Uploaded runtime themes must embed assets as data URLs.");
      await importManifest(manifest,bundledCss);
    }catch(error:any){
      setStatus(error?.message||"Could not import theme package.");
    }finally{
      setPackageBusy(false);
    }
  }

  function renderSurface(surface:Surface,title:string,activeId:string){
    return <section className={styles.surface}>
      <div className={styles.surfaceHead}>
        <div><p className="eyebrow">{surface==="admin"?"ADMIN PANEL":"CUSTOMER PORTAL"}</p><h2>{title}</h2></div>
        <span className={styles.current}>Active: {activeId}</span>
      </div>
      <div className={styles.grid}>{grouped[surface].map(t=>{
        const active=activeId===t.id;
        const parent=t.manifest?.extends;
        return <article key={t.id} className={styles.card+" "+(active?styles.active:"")}>
          <div className={styles.cardTop}><div><h3>{t.name}</h3><p>{t.description}</p></div><span className={styles.badge}>{active?"ACTIVE":"INSTALLED"}</span></div>
          <div className={styles.meta}>
            <span>{t.id}</span><span>v{t.version}</span><span>{t.is_builtin?"Built-in":"Imported"}</span>{parent&&<span>Extends {parent}</span>}
          </div>
          <div className={styles.actions}><button type="button" onClick={()=>void apply(t)} disabled={active}>{active?"Applied":"Apply theme"}</button></div>
        </article>;
      })}</div>
    </section>;
  }

  return <main className={styles.shell}>
    <header className={styles.head}><div><p className="eyebrow">SYSTEM · THEMES</p><h1>OrbitFS Theme Manager</h1><p className="muted">Admin and customer themes are independent. V5 themes inherit the current V3 base and only override what we intentionally redesign.</p></div></header>

    {renderSurface("admin","Admin themes",activeAdmin)}
    {renderSurface("customer","Customer themes",activeCustomer)}

    <section className={styles.import}>
      <div><p className="eyebrow">THEME PACKAGES</p><h2>Import an OrbitFS theme package</h2><p className="muted">Use an .orbit-theme.zip containing one manifest and CSS entry. Relative CSS imports are bundled during upload. Runtime package assets must be embedded as data URLs.</p></div>
      <label className={styles.upload}>
        <input type="file" accept=".zip,.orbit-theme.zip,application/zip" onChange={e=>void importPackage(e)} disabled={packageBusy}/>
        <span>{packageBusy?"Importing package…":"Choose theme package"}</span>
      </label>
      <details className={styles.advanced}>
        <summary>Advanced manual import</summary>
        <p className="muted">Paste a manifest and already-bundled CSS. Built-in theme IDs cannot be overwritten.</p>
        <textarea value={manifestText} onChange={e=>setManifestText(e.target.value)} placeholder='{"id":"MyThemeC","name":"My Theme","surface":"customer","version":"1.0.0"}'/>
        <textarea value={cssText} onChange={e=>setCssText(e.target.value)} placeholder="Theme CSS…"/>
        <div className={styles.actions}><button type="button" onClick={()=>void importTheme()} disabled={!manifestText.trim()||!cssText.trim()}>Import manually</button></div>
      </details>
    </section>

    {status&&<div className={styles.status}>{status}</div>}
  </main>;
}
