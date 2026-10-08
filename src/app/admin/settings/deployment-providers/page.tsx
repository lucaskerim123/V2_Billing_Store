"use client";

import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

type Snapshot={
 settings?:{supabase_oauth_enabled?:boolean;vercel_oauth_enabled?:boolean;supabase_client_id?:string|null;vercel_client_id?:string|null;vercel_install_url?:string|null;supabase_scopes?:string|null};
 supabase_client_secret_configured?:boolean;
 vercel_client_secret_configured?:boolean;
 connected_supabase?:number;
 connected_vercel?:number;
};

export default function DeploymentProviderSettings(){
 const sb=useMemo(()=>createClient(),[]);
 const [data,setData]=useState<Snapshot|null>(null);
 const [busy,setBusy]=useState("");
 const [message,setMessage]=useState("");
 const [error,setError]=useState("");
 const [origin,setOrigin]=useState("");
 const [form,setForm]=useState({supabase_oauth_enabled:true,vercel_oauth_enabled:true,supabase_client_id:"",vercel_client_id:"",vercel_install_url:"",supabase_scopes:"",supabase_client_secret:"",vercel_client_secret:""});

 function hydrate(snapshot:Snapshot){
  const s=snapshot.settings||{};
  setData(snapshot);
  setForm(current=>({...current,supabase_oauth_enabled:s.supabase_oauth_enabled!==false,vercel_oauth_enabled:s.vercel_oauth_enabled!==false,supabase_client_id:String(s.supabase_client_id||""),vercel_client_id:String(s.vercel_client_id||""),vercel_install_url:String(s.vercel_install_url||""),supabase_scopes:String(s.supabase_scopes||""),supabase_client_secret:"",vercel_client_secret:""}));
 }

 async function load(){
  setBusy("load");setError("");
  try{
   const {data:result,error:rpcError}=await sb.rpc("admin_orbitfs_release_system_snapshot");
   if(rpcError)throw rpcError;
   hydrate((result||{}) as Snapshot);
  }catch(e:any){setError(e?.message||"Could not load deployment provider configuration.")}
  finally{setBusy("")}
 }

 async function save(){
  setBusy("save");setMessage("");setError("");
  try{
   const patch={supabase_oauth_enabled:form.supabase_oauth_enabled,vercel_oauth_enabled:form.vercel_oauth_enabled,supabase_client_id:form.supabase_client_id.trim(),vercel_client_id:form.vercel_client_id.trim(),vercel_install_url:form.vercel_install_url.trim(),supabase_scopes:form.supabase_scopes.trim()};
   const {error:updateError}=await sb.rpc("admin_update_orbitfs_release_system",{p_patch:patch});
   if(updateError)throw updateError;
   if(form.supabase_client_secret.trim()){
    const {error:secretError}=await sb.rpc("admin_store_orbitfs_release_secret",{p_key:"supabase_client_secret",p_value:form.supabase_client_secret});
    if(secretError)throw secretError;
   }
   if(form.vercel_client_secret.trim()){
    const {error:secretError}=await sb.rpc("admin_store_orbitfs_release_secret",{p_key:"vercel_client_secret",p_value:form.vercel_client_secret});
    if(secretError)throw secretError;
   }
   setMessage("Deployment provider settings saved. New customer connections will use this configuration.");
   await load();
  }catch(e:any){setError(e?.message||"Could not save deployment provider settings.")}
  finally{setBusy("")}
 }

 async function removeSecret(provider:"supabase"|"vercel"){
  if(!confirm(`Remove the stored ${provider==="supabase"?"Supabase":"Vercel"} client secret?`))return;
  setBusy(provider+"-remove");setMessage("");setError("");
  try{
   const key=provider==="supabase"?"supabase_client_secret":"vercel_client_secret";
   const {error:rpcError}=await sb.rpc("admin_remove_orbitfs_release_secret",{p_key:key});
   if(rpcError)throw rpcError;
   setMessage(`${provider==="supabase"?"Supabase":"Vercel"} client secret removed.`);
   await load();
  }catch(e:any){setError(e?.message||"Could not remove client secret.")}
  finally{setBusy("")}
 }

 useEffect(()=>{setOrigin(window.location.origin);void load()},[]);
 const supabaseCallback=origin?`${origin}/api/orbitfs/oauth/supabase/callback`:"/api/orbitfs/oauth/supabase/callback";
 const vercelCallback=origin?`${origin}/api/orbitfs/oauth/vercel/callback`:"/api/orbitfs/oauth/vercel/callback";
 const supReady=Boolean(form.supabase_client_id.trim()&&data?.supabase_client_secret_configured&&form.supabase_oauth_enabled);
 const verReady=Boolean(form.vercel_client_id.trim()&&data?.vercel_client_secret_configured&&form.vercel_oauth_enabled);

 return <main className="adminShell settingsCompact">
  <header className="adminTop"><div><p className="eyebrow">MY ORBITFS · CUSTOMER DEPLOYER</p><h1>Deployment providers</h1><p className="muted">Configure the Billing-owned OAuth applications used to connect each customer&apos;s Supabase and Vercel accounts. License Manager still owns deployment authorization and release state.</p></div><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><Link className="buttonlink secondary" href="/admin/settings">System settings</Link><button className="secondary" type="button" onClick={()=>void load()} disabled={!!busy}>{busy==="load"?"Refreshing…":"Refresh"}</button></div></header>
  {message&&<p className="inlineStatus">{message}</p>}{error&&<p className="inlineStatus" style={{borderColor:"crimson"}}>{error}</p>}
  <section className="settingsRuntimeStrip" aria-label="Provider status">
   <article><small>Supabase OAuth</small><strong>{supReady?"Ready":"Setup"}</strong><span>{Number(data?.connected_supabase||0)} customer connection(s)</span></article>
   <article><small>Vercel OAuth</small><strong>{verReady?"Ready":"Setup"}</strong><span>{Number(data?.connected_vercel||0)} customer connection(s)</span></article>
   <article><small>Secret storage</small><strong>Vault</strong><span>Secrets are write-only and never shown back to the browser.</span></article>
   <article><small>Authority</small><strong>Billing</strong><span>Provider credentials only; technical deployment authority remains in License Manager.</span></article>
  </section>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:16,marginTop:16}}>
   <section className="panel">
    <div className="panelTitle"><div><p className="eyebrow">SUPABASE OAUTH APP</p><h2>Supabase customer connection</h2><p className="muted">Customers authorize their own Supabase account. The deployer stores customer tokens separately in Vault.</p></div><span className={supReady?"state ready":"state waiting"}>{supReady?"READY":"SETUP"}</span></div>
    <div className="form">
     <label>Enable Supabase OAuth<select value={form.supabase_oauth_enabled?"true":"false"} onChange={e=>setForm({...form,supabase_oauth_enabled:e.target.value==="true"})}><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
     <label>Client ID<input value={form.supabase_client_id} onChange={e=>setForm({...form,supabase_client_id:e.target.value})} autoComplete="off" placeholder="Supabase OAuth client ID"/></label>
     <label>Client secret<input type="password" value={form.supabase_client_secret} onChange={e=>setForm({...form,supabase_client_secret:e.target.value})} autoComplete="new-password" placeholder={data?.supabase_client_secret_configured?"Configured — enter only to replace":"Enter Supabase OAuth client secret"}/><small>{data?.supabase_client_secret_configured?"A secret is stored in Vault. It cannot be read back.":"No stored secret detected."}</small></label>
     <label>OAuth scopes<input value={form.supabase_scopes} onChange={e=>setForm({...form,supabase_scopes:e.target.value})} placeholder="projects.read projects.write organizations.read"/></label>
     <label>Callback URL<input readOnly value={supabaseCallback}/><small>Add this exact callback URL to the Supabase OAuth application.</small></label>
    </div>
    {data?.supabase_client_secret_configured&&<button className="secondary" type="button" onClick={()=>void removeSecret("supabase")} disabled={!!busy}>Remove stored Supabase secret</button>}
   </section>
   <section className="panel">
    <div className="panelTitle"><div><p className="eyebrow">VERCEL OAUTH APP</p><h2>Vercel customer connection</h2><p className="muted">Customers authorize their own Vercel account/team so the deployer can create and update their OrbitFS project.</p></div><span className={verReady?"state ready":"state waiting"}>{verReady?"READY":"SETUP"}</span></div>
    <div className="form">
     <label>Enable Vercel OAuth<select value={form.vercel_oauth_enabled?"true":"false"} onChange={e=>setForm({...form,vercel_oauth_enabled:e.target.value==="true"})}><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
     <label>Client ID<input value={form.vercel_client_id} onChange={e=>setForm({...form,vercel_client_id:e.target.value})} autoComplete="off" placeholder="Vercel Integration / OAuth client ID"/></label>
     <label>Client secret<input type="password" value={form.vercel_client_secret} onChange={e=>setForm({...form,vercel_client_secret:e.target.value})} autoComplete="new-password" placeholder={data?.vercel_client_secret_configured?"Configured — enter only to replace":"Enter Vercel OAuth client secret"}/><small>{data?.vercel_client_secret_configured?"A secret is stored in Vault. It cannot be read back.":"No stored secret detected."}</small></label>
     <label>Install URL<input value={form.vercel_install_url} onChange={e=>setForm({...form,vercel_install_url:e.target.value})} placeholder="https://vercel.com/integrations/..."/></label>
     <label>Callback URL<input readOnly value={vercelCallback}/><small>Add this exact callback URL to the Vercel Integration / OAuth application.</small></label>
    </div>
    {data?.vercel_client_secret_configured&&<button className="secondary" type="button" onClick={()=>void removeSecret("vercel")} disabled={!!busy}>Remove stored Vercel secret</button>}
   </section>
  </div>
  <section className="panel" style={{marginTop:16}}><div className="panelTitle"><div><p className="eyebrow">SAVE & APPLY</p><h2>Customer deployer credentials</h2><p className="muted">Client IDs and provider settings are stored in Billing configuration. Client secrets are stored in Supabase Vault and never returned to the Admin Portal.</p></div></div><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" onClick={()=>void save()} disabled={!!busy}>{busy==="save"?"Saving…":"Save deployment provider settings"}</button><button className="secondary" type="button" onClick={()=>void load()} disabled={!!busy}>Discard unsaved changes</button></div></section>
 </main>;
}
