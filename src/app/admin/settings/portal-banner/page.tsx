"use client";

import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import "../../settings-system-v2.css";

type Level="info"|"warning"|"alert";

export default function PortalBannerSettingsPage(){
  const sb=useMemo(()=>createClient(),[]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState("");
  const [enabled,setEnabled]=useState(false);
  const [level,setLevel]=useState<Level>("info");
  const [title,setTitle]=useState("");
  const [body,setBody]=useState("");
  const [dismissible,setDismissible]=useState(true);
  const [revision,setRevision]=useState(1);

  useEffect(()=>{(async()=>{
    const {data,error}=await sb.from("app_settings").select("key,value").eq("category","portal_banner");
    if(error){setMessage(error.message);setLoading(false);return}
    const map=Object.fromEntries((data||[]).map((row:any)=>[row.key.split(".").pop(),row.value]));
    setEnabled(map.enabled===true);
    setLevel(["info","warning","alert"].includes(String(map.level))?map.level:"info");
    setTitle(String(map.title||""));
    setBody(String(map.message||""));
    setDismissible(map.dismissible!==false);
    setRevision(Number(map.revision||1));
    setLoading(false);
  })()},[sb]);

  async function save(){
    setSaving(true);setMessage("Saving banner…");
    const nextRevision=revision+1;
    const values:Record<string,any>={enabled,level,title:title.trim(),message:body.trim(),dismissible,revision:nextRevision};
    for(const [name,value] of Object.entries(values)){
      const {error}=await sb.from("app_settings").update({value,updated_at:new Date().toISOString()}).eq("key","portal_banner."+name);
      if(error){setMessage(error.message);setSaving(false);return}
    }
    setRevision(nextRevision);
    setMessage("Global portal banner saved. Existing dismissals reset for the new revision.");
    setSaving(false);
  }

  if(loading)return <main className="adminShell"><section className="panel">Loading portal banner settings…</section></main>;

  return <main className="adminShell">
    <header className="adminPageHead">
      <div><p className="eyebrow">CUSTOMER PORTAL · GLOBAL BANNER</p><h1>Portal banner</h1><p className="muted">A persistent customer-facing banner shown across every portal page. This is separate from Notifications and the Alert System.</p></div>
      <Link className="buttonlink secondary" href="/admin/settings">← Settings</Link>
    </header>

    <section className="panel" style={{display:"grid",gap:16}}>
      <div className="panelTitle"><div><h2>Banner configuration</h2><p className="muted">Saving creates a new revision so customers who dismissed an older notice will see the updated one.</p></div></div>

      <div className="form">
        <label>Enabled
          <select value={enabled?"on":"off"} onChange={e=>setEnabled(e.target.value==="on")}>
            <option value="off">Off</option>
            <option value="on">On</option>
          </select>
        </label>

        <label>Banner type
          <select value={level} onChange={e=>setLevel(e.target.value as Level)}>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="alert">Alert</option>
          </select>
        </label>

        <label>Title
          <input value={title} onChange={e=>setTitle(e.target.value)} maxLength={120} placeholder="Scheduled maintenance"/>
        </label>

        <label>Message
          <textarea rows={5} value={body} onChange={e=>setBody(e.target.value)} maxLength={600} placeholder="Tell customers what they need to know."/>
        </label>

        <label>Customer dismissal
          <select value={dismissible?"on":"off"} onChange={e=>setDismissible(e.target.value==="on")}>
            <option value="on">Dismissible after confirmation</option>
            <option value="off">Cannot be dismissed</option>
          </select>
        </label>
      </div>

      <div className={"portalBannerAdminPreview portalBannerAdminPreview-"+level}>
        <div><small>{level.toUpperCase()} PREVIEW</small><b>{title||"Banner title"}</b><span>{body||"Banner message will appear here."}</span></div>
        {dismissible&&<button type="button" disabled>Dismiss</button>}
      </div>

      <div className="inlineActions">
        <button type="button" onClick={()=>void save()} disabled={saving}>{saving?"Saving…":"Save banner"}</button>
        <span className="muted">Revision {revision}</span>
      </div>
      {message&&<p className="inlineStatus">{message}</p>}
    </section>
  </main>;
}
