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

const suffixFor=(surface:Surface)=>surface==="admin"?"A":"C";
const surfaceLabel=(surface:Surface)=>surface==="admin"?"Admin Panel":"Customer Portal";

function assertThemeId(id:string,surface:Surface){
  if(!id.endsWith(suffixFor(surface)))throw new Error(surfaceLabel(surface)+" theme IDs must end in "+suffixFor(surface)+".");
}

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
  const entry=zip.file(filePath);
  if(!entry)throw new Error("Theme CSS file is missing: "+filePath);
  const css=await entry.async("string");
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
  const [activeAdmin,setActiveAdmin]=useState("V5A");
  const [activeCustomer,setActiveCustomer]=useState("V3C");
  const [status,setStatus]=useState("");
  const [busy,setBusy]=useState("");
  const [manifestText,setManifestText]=useState("");
  const [cssText,setCssText]=useState("");

  const grouped=useMemo(()=>({
    admin:themes.filter(t=>t.surface==="admin").sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true})),
    customer:themes.filter(t=>t.surface==="customer").sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}))
  }),[themes]);

  async function load(){
    const {data,error}=await sb.rpc("orbitfs_theme_list");
    if(error){setStatus(error.message);return}
    setThemes(data?.themes||[]);
    setActiveAdmin(data?.active_admin||"V5A");
    setActiveCustomer(data?.active_customer||"V3C");
  }

  useEffect(()=>{void load()},[]);

  function announce(surface:Surface,id:string){
    window.dispatchEvent(new CustomEvent("orbitfs-theme-changed",{detail:{surface,id}}));
    if(typeof BroadcastChannel!=="undefined"){
      const channel=new BroadcastChannel("orbitfs-theme");
      channel.postMessage({surface,id});
      channel.close();
    }
  }

  async function apply(id:string){
    const theme=themes.find(t=>t.id===id);
    if(!theme)return;
    try{
      assertThemeId(theme.id,theme.surface);
      setBusy("apply:"+id);
      setStatus("Applying "+id+"…");
      const {error}=await sb.rpc("orbitfs_theme_apply",{p_theme_id:id});
      if(error)throw error;
      if(theme.surface==="admin")setActiveAdmin(id);else setActiveCustomer(id);
      announce(theme.surface,id);
      setStatus(id+" applied to the "+surfaceLabel(theme.surface)+".");
      await load();
    }catch(error:any){
      setStatus(error?.message||"Could not apply theme.");
    }finally{
      setBusy("");
    }
  }

  async function importManifest(manifest:any,css:string){
    const surface=String(manifest?.surface||"") as Surface;
    if(surface!=="admin"&&surface!=="customer")throw new Error("Theme surface must be admin or customer.");
    const id=String(manifest?.id||"").trim();
    if(!id)throw new Error("Theme manifest requires an id.");
    assertThemeId(id,surface);
    const {data,error}=await sb.rpc("orbitfs_theme_import",{p_manifest:manifest,p_css:css});
    if(error)throw error;
    setStatus(String(data.theme_id)+" imported for "+surfaceLabel(data.surface)+".");
    await load();
  }

  async function importTheme(){
    setBusy("manual");
    try{
      const manifest=JSON.parse(manifestText);
      await importManifest(manifest,cssText);
      setManifestText("");
      setCssText("");
    }catch(error:any){
      setStatus(error?.message||"Manifest must be valid JSON.");
    }finally{
      setBusy("");
    }
  }

  async function importPackage(event:ChangeEvent<HTMLInputElement>){
    const selected=event.target.files?.[0];
    event.target.value="";
    if(!selected)return;
    setBusy("package");
    setStatus("Reading "+selected.name+"…");
    try{
      const zip=await JSZip.loadAsync(await selected.arrayBuffer());
      const manifests=Object.keys(zip.files).filter(name=>name.endsWith("/manifest.json"));
      if(manifests.length!==1)throw new Error("Theme package must contain exactly one manifest.json.");
      const manifestPath=manifests[0];
      const manifest=JSON.parse(await zip.file(manifestPath)!.async("string"));
      const surface=String(manifest?.surface||"") as Surface;
      if(surface!=="admin"&&surface!=="customer")throw new Error("Theme surface must be admin or customer.");
      if(!manifest.id||!manifest.entry)throw new Error("Theme manifest requires id, surface and entry.");
      assertThemeId(String(manifest.id),surface);
      const prefix=manifestPath.slice(0,-"manifest.json".length);
      if(prefix!==String(manifest.id)+"/")throw new Error("Theme package root must match the manifest id.");
      const entryPath=prefix+String(manifest.entry).replace(/^\.\//,"");
      const bundledCss=await inlinePackageCss(zip,entryPath,prefix,new Set());
      if(/url\((?!\s*["']?(?:data:|#))/i.test(bundledCss))throw new Error("Uploaded runtime themes must embed assets as data URLs.");
      await importManifest(manifest,bundledCss);
    }catch(error:any){
      setStatus(error?.message||"Could not import theme package.");
    }finally{
      setBusy("");
    }
  }

  function surfaceSection(surface:Surface,activeId:string){
    const themesForSurface=grouped[surface];
    return <section className={styles.surface}>
      <div className={styles.surfaceHead}>
        <div>
          <p className="eyebrow">{surface==="admin"?"ADMIN THEMES · A":"CUSTOMER THEMES · C"}</p>
          <h2>{surfaceLabel(surface)}</h2>
          <p className="muted">{surface==="admin"?"Every Admin theme ID ends in A.":"Every Customer Portal theme ID ends in C."}</p>
        </div>
        <label className={styles.quickSwitch}>
          <span>Active theme</span>
          <select value={activeId} onChange={e=>void apply(e.target.value)} disabled={!!busy}>
            {themesForSurface.map(t=><option key={t.id} value={t.id}>{t.name} · {t.id}</option>)}
          </select>
        </label>
      </div>
      <div className={styles.grid}>{themesForSurface.map(t=>{
        const active=t.id===activeId;
        const parent=t.manifest?.extends;
        return <article key={t.id} className={styles.card+" "+(active?styles.active:"")}>
          <div className={styles.cardTop}>
            <div><h3>{t.name}</h3><p>{t.description}</p></div>
            <span className={styles.badge}>{active?"ACTIVE":"INSTALLED"}</span>
          </div>
          <div className={styles.meta}>
            <span>{t.id}</span><span>v{t.version}</span><span>{t.is_builtin?"Built-in":"Imported"}</span>{parent&&<span>Extends {parent}</span>}
          </div>
          <div className={styles.actions}><button type="button" onClick={()=>void apply(t.id)} disabled={active||!!busy}>{active?"Applied":"Apply theme"}</button></div>
        </article>;
      })}</div>
    </section>;
  }

  return <main className={styles.shell}>
    <header className={styles.head}>
      <div>
        <p className="eyebrow">SYSTEM · THEMES</p>
        <h1>OrbitFS Theme Manager</h1>
        <p className="muted">Switch the Admin Panel and Customer Portal independently. A = Admin. C = Customer. V3 stays available as the stable baseline while V5 can be changed separately.</p>
      </div>
      <div className={styles.legend}><span>A · Admin</span><span>C · Customer</span></div>
    </header>

    {surfaceSection("admin",activeAdmin)}
    {surfaceSection("customer",activeCustomer)}

    <section className={styles.import}>
      <div><p className="eyebrow">THEME PACKAGES</p><h2>Import theme package</h2><p className="muted">Upload an .orbit-theme.zip with one manifest and CSS entry. Admin package IDs must end in A; customer package IDs must end in C.</p></div>
      <label className={styles.upload}>
        <input type="file" accept=".zip,.orbit-theme.zip,application/zip" onChange={e=>void importPackage(e)} disabled={!!busy}/>
        <span>{busy==="package"?"Importing package…":"Choose .orbit-theme.zip"}</span>
      </label>
      <details className={styles.advanced}>
        <summary>Advanced manual import</summary>
        <p className="muted">Paste an already-bundled manifest and CSS. Built-in theme IDs cannot be overwritten.</p>
        <textarea value={manifestText} onChange={e=>setManifestText(e.target.value)} placeholder='{"id":"MyThemeC","name":"My Theme","surface":"customer","version":"1.0.0"}'/>
        <textarea value={cssText} onChange={e=>setCssText(e.target.value)} placeholder="Theme CSS…"/>
        <div className={styles.actions}><button type="button" onClick={()=>void importTheme()} disabled={!manifestText.trim()||!cssText.trim()||!!busy}>{busy==="manual"?"Importing…":"Import manually"}</button></div>
      </details>
    </section>

    {status&&<div className={styles.status} role="status">{status}</div>}
  </main>;
}
