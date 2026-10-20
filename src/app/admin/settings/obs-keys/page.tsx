"use client";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import Link from "next/link";
type Target="main"|"fallback"|"both";
type KeyRow={id:string;name:string;key_last4:string;scopes:string[];target_profile:Target;status:string;created_at:string;revoked_at?:string|null};
const GROUPS=[
 {id:"customers",title:"Customers",hint:"Customer records and account changes."},
 {id:"orders",title:"Orders",hint:"Order history and authorised order changes."},
 {id:"invoices",title:"Invoices",hint:"Invoice details and Billing-managed adjustments."},
 {id:"payments",title:"Payments",hint:"Payment records and Billing-managed financial operations."}
];
const EXTRA=[
 {id:"licenses.link",label:"Link licences",hint:"Associate a Billing customer with a licence from License Manager."},
 {id:"billing.override",label:"Owner override",hint:"Explicit override for supported Billing operations. Does not bypass provider or database safeguards."},
 {id:"billing.admin",label:"Billing administrator",hint:"Broad OBS API scopes; does not grant access to operations with no endpoint."}
];
const TARGETS:[Target,string,string][]=[
 ["main","Main","Main Billing Store only"],
 ["fallback","Fallback","Fallback Billing Store only"],
 ["both","Both","Valid on either Billing Store endpoint"]
];
export default function ObsKeysPage(){
 const [keys,setKeys]=useState<KeyRow[]>([]),[supported,setSupported]=useState<string[]>([]);
 const [selected,setSelected]=useState<string[]>(["customers.read","orders.read","invoices.read"]);
 const [name,setName]=useState("OrbitFS Chatbot"),[target,setTarget]=useState<Target>("both"),[created,setCreated]=useState("");
 const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[filter,setFilter]=useState<"all"|Target>("all");
 const active=useMemo(()=>keys.filter(k=>k.status==="active"),[keys]);
 const visible=useMemo(()=>keys.filter(k=>filter==="all"||k.target_profile===filter),[keys,filter]);
 async function request(method="GET",body?:object){
  const {data:{session}}=await createClient().auth.getSession();
  if(!session?.access_token)throw new Error("Sign in with an authorised Billing administrator account.");
  const response=await fetch("/api/admin/obs-keys",{method,headers:{Authorization:"Bearer "+session.access_token,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined,cache:"no-store"});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(payload.error||"OBS API request failed");return payload;
 }
 async function refresh(){try{const d=await request();setKeys(d.keys||[]);setSupported(d.permissions||[])}catch(e:any){setError(e.message||"Unable to load keys")}}
 useEffect(()=>{void refresh()},[]);
 function toggle(scope:string){setSelected(v=>v.includes(scope)?v.filter(x=>x!==scope):[...v,scope])}
 function allScopes(group:string){return [group+".read",group+".write"].filter(x=>supported.includes(x))}
 function setGroup(group:string,enabled:boolean){const requested=allScopes(group);setSelected(v=>enabled?[...new Set([...v,...requested])]:v.filter(x=>!requested.includes(x)))}
 async function generate(){
  setBusy(true);setError("");setNotice("");setCreated("");
  try{const d=await request("POST",{name:name.trim(),scopes:selected,target_profile:target});setCreated(d.key);setNotice("Key created. Copy it now: it cannot be recovered after closing this page.");await refresh()}
  catch(e:any){setError(e.message||"Key creation failed")}finally{setBusy(false)}
 }
 async function revoke(id:string){
  if(!window.confirm("Revoke this OBS key? Any system using it will lose access immediately."))return;
  setBusy(true);setError("");try{await request("DELETE",{id});setNotice("Integration key revoked.");await refresh()}
  catch(e:any){setError(e.message||"Revocation failed")}finally{setBusy(false)}
 }
 return <main className="adminShell settingsCompact">
  <header className="adminTop"><div><p className="eyebrow">ORBITFS · BILLING INTEGRATIONS</p><h1>OBS API Keys</h1><p className="muted">Issue, scope and revoke secure API credentials for OrbitFS Chat and other trusted services.</p></div>
   <div className="inlineActions"><Link className="buttonlink secondary" href="/admin/settings/api-connections">API Connections</Link><button className="buttonlink secondary" onClick={()=>void refresh()} disabled={busy}>Refresh</button></div></header>
  <section className="panel"><div className="panelTitle"><div><p className="eyebrow">INTEGRATION STATUS</p><h2>{active.length} active key{active.length===1?"":"s"}</h2><p className="muted">Keys are stored as SHA-256 hashes. Full values appear only after generation.</p></div><span className="state ready">SCOPED ACCESS</span></div>
   <div className="workspaceGrid"><div className="workspaceBlock"><b>Main</b><p className="muted">{active.filter(k=>k.target_profile==="main"||k.target_profile==="both").length} authorised keys</p></div><div className="workspaceBlock"><b>Fallback</b><p className="muted">{active.filter(k=>k.target_profile==="fallback"||k.target_profile==="both").length} authorised keys</p></div></div></section>
  <section className="panel"><div className="panelTitle"><div><p className="eyebrow">CREATE CREDENTIAL</p><h2>New integration key</h2><p className="muted">Select where the key works, then grant exact capabilities.</p></div></div>
   <div className="form"><label>Integration name<input value={name} onChange={e=>setName(e.target.value)} maxLength={120} placeholder="e.g. OrbitFS Chatbot"/></label>
    <fieldset style={{border:"1px solid var(--line)",borderRadius:12,padding:14}}><legend><b>Work target</b></legend><div className="workspaceGrid">{TARGETS.map(([value,label,description])=><label key={value} className="workspaceBlock" style={{cursor:"pointer"}}><input type="radio" name="obs-target" value={value} checked={target===value} onChange={()=>setTarget(value)}/> <b>{label}</b><p className="muted">{description}</p></label>)}</div></fieldset>
    <div className="panelTitle"><div><h3>Permissions</h3><p className="muted">Read and write are separate. Unimplemented financial mutations remain unavailable even when a key has write permission.</p></div><button type="button" className="buttonlink secondary" onClick={()=>setSelected(supported.filter(x=>!x.includes("override")&&!x.includes("admin")))}>Select standard permissions</button></div>
    <div className="workspaceGrid">{GROUPS.map(group=><div className="workspaceBlock" key={group.id}><div className="panelTitle"><div><b>{group.title}</b><p className="muted">{group.hint}</p></div></div>
     {(["read","write"] as const).map(op=>{const scope=group.id+"."+op;return <label key={scope} style={{display:"block",padding:"6px 0"}}><input type="checkbox" disabled={!supported.includes(scope)} checked={selected.includes(scope)} onChange={()=>toggle(scope)}/> {op==="read"?"Read":"Write"} <small className="muted"> · {scope}</small></label>})}
     <button type="button" className="buttonlink secondary small" onClick={()=>setGroup(group.id,!allScopes(group.id).every(scope=>selected.includes(scope)))}>Toggle read + write</button>
    </div>)}</div>
    <div className="workspaceBlock"><b>Additional authority</b>{EXTRA.filter(x=>supported.includes(x.id)).map(extra=><label key={extra.id} style={{display:"block",padding:"9px 0"}}><input type="checkbox" checked={selected.includes(extra.id)} onChange={()=>toggle(extra.id)}/> <strong>{extra.label}</strong> <small className="muted"> · {extra.id}</small><p className="muted">{extra.hint}</p></label>)}</div>
   </div>
   <div className="inlineActions"><button className="buttonlink" disabled={busy||name.trim().length<2||!selected.length} onClick={()=>void generate()}>{busy?"Working…":"Generate OBS key"}</button><span className="muted">{selected.length} selected permission{selected.length===1?"":"s"} · {target.toUpperCase()}</span></div>
   {created&&<section className="workspaceBlock" role="status"><h3>New key · copy once</h3><p className="muted">Keep this secret in a server-side environment variable. Never put it in a browser or repository.</p><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{created}</pre><button className="buttonlink secondary" onClick={()=>void navigator.clipboard.writeText(created)}>Copy secret key</button><button className="buttonlink secondary" onClick={()=>setCreated("")}>Hide</button></section>}
   {error&&<p role="alert" className="muted">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </section>
  <section className="panel"><div className="panelTitle"><div><p className="eyebrow">ACCESS INVENTORY</p><h2>Existing OBS keys</h2><p className="muted">Review targets and scopes. Revoke a key to immediately block future requests.</p></div><select aria-label="Filter key target" value={filter} onChange={e=>setFilter(e.target.value as typeof filter)}><option value="all">All targets</option>{TARGETS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
   <div className="lmRuntimeList">{visible.map(key=><div key={key.id}><div><b>{key.name}</b><span>OBS-••••{key.key_last4} · {key.target_profile.toUpperCase()} · {key.status}</span><small className="muted">{key.scopes.join(" · ")}</small></div><div><strong>{key.status==="active"?"ACTIVE":"REVOKED"}</strong>{key.status==="active"&&<button className="buttonlink secondary small" disabled={busy} onClick={()=>void revoke(key.id)}>Revoke</button>}</div></div>)}{!visible.length&&<p className="muted">No keys match this target.</p>}</div>
  </section>
 </main>;
}
