"use client";
import {useEffect,useState} from "react";
import {createClient} from "@/lib/supabase";
import Link from "next/link";
type KeyRow={id:string;name:string;key_last4:string;scopes:string[];status:string;created_at:string};
export default function ObsKeysPage(){
 const [keys,setKeys]=useState<KeyRow[]>([]),[scopes,setScopes]=useState<string[]>([]);
 const [selected,setSelected]=useState<string[]>(["customers.read","orders.read","invoices.read"]);
 const [name,setName]=useState("OrbitFS Chatbot"),[created,setCreated]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 async function request(method="GET",body?:object){
  const {data:{session}}=await createClient().auth.getSession();
  if(!session?.access_token)throw new Error("Sign in as a Billing superadministrator.");
  const response=await fetch("/api/admin/obs-keys",{method,headers:{Authorization:"Bearer "+session.access_token,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined,cache:"no-store"});
  const result=await response.json();if(!response.ok)throw new Error(result.error||"Request failed");return result;
 }
 async function refresh(){try{const d=await request();setKeys(d.keys||[]);setScopes(d.permissions||[])}catch(e:any){setError(e.message)}}
 useEffect(()=>{void refresh()},[]);
 async function create(){setBusy(true);setError("");setCreated("");try{const d=await request("POST",{name,scopes:selected});setCreated(d.key);await refresh()}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 async function revoke(id:string){if(!window.confirm("Revoke this integration key immediately?"))return;setBusy(true);setError("");try{await request("DELETE",{id});await refresh()}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 return <main className="adminShell"><header className="adminTop"><div><p className="eyebrow">ORBITFS BILLING STORE</p><h1>OBS API Keys</h1><p className="muted">Grant explicit read permissions to integrations. Only the token hash is stored; copy the key when created.</p></div><Link href="/admin/settings/api-connections">API Connections</Link></header>
 <section className="panel"><h2>Create OBS integration key</h2><label>Key name<input value={name} onChange={e=>setName(e.target.value)} maxLength={120}/></label><div><strong>Permissions</strong>{scopes.map(scope=><label key={scope} style={{display:"block",margin:"8px 0"}}><input type="checkbox" checked={selected.includes(scope)} onChange={e=>setSelected(prev=>e.target.checked?[...prev,scope]:prev.filter(x=>x!==scope))}/>{scope}</label>)}</div><button className="buttonlink" disabled={busy||!selected.length||name.trim().length<2} onClick={()=>void create()}>Generate OBS key</button>{created&&<div className="panel"><strong>Copy this key now. It will not be displayed again.</strong><pre style={{overflowWrap:"anywhere",whiteSpace:"pre-wrap"}}>{created}</pre><button onClick={()=>void navigator.clipboard.writeText(created)}>Copy key</button></div>}{error&&<p role="alert">{error}</p>}</section>
 <section className="panel"><h2>Existing keys</h2>{keys.map(k=><div key={k.id} style={{padding:"12px 0",borderBottom:"1px solid var(--line)"}}><strong>{k.name}</strong> · OBS-••••{k.key_last4}<div>{k.scopes.join(", ")} · {k.status}</div>{k.status==="active"&&<button className="buttonlink secondary" disabled={busy} onClick={()=>void revoke(k.id)}>Revoke</button>}</div>)}</section></main>;
}
