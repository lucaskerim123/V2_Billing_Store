"use client";

import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

const productLabel=(code:string)=>({
  orbitfs_base:"OrbitFS Base",
  orbitfs_apex:"OrbitFS APEX",
  orbitfs_mcp:"OrbitFS MCP",
  orbitfs_studio:"OrbitFS Studio"
}[code]||code);

export default function LicenseMasterSettings(){
 const sb=useMemo(()=>createClient(),[]);
 const [data,setData]=useState<any>(null);
 const [busy,setBusy]=useState("");
 const [editing,setEditing]=useState(false);
 const [message,setMessage]=useState("");
 const [error,setError]=useState("");
 const [masterUrl,setMasterUrl]=useState("");

 async function headers():Promise<Record<string,string>>{
  const {data:{session}}=await sb.auth.getSession();
  if(!session?.access_token)throw new Error("Administrator session expired.");
  return {Authorization:`Bearer ${session.access_token}`};
 }

 async function request(body?:any){
  const response=await fetch("/api/admin/settings/license-master",{
   method:body?"POST":"GET",
   headers:{...(await headers()),...(body?{"Content-Type":"application/json"}:{})},
   body:body?JSON.stringify(body):undefined,
   cache:"no-store"
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||"License Manager request failed");
  return result;
 }

 async function load(options?:{test?:boolean;preserveFeedback?:boolean}){
  const action=options?.test?"test":"load";
  setBusy(action);
  if(!options?.preserveFeedback){setMessage("");setError("")}
  try{
   if(options?.test){
    const test=await request({action:"test"});
    setMessage(`License Manager connected · ${Number(test.latencyMs||0)}ms · ${Number(test.productCount||0)} products`);
   }
   const result=await request();
   setData(result);
   setMasterUrl(String(result.configuredUrl||result.connection?.master_url||""));
  }catch(e:any){setError(e?.message||"License Manager unavailable")}
  finally{setBusy("")}
 }

 async function saveConnection(){
  if(!masterUrl.trim())return setError("License Manager API URL is required.");
  setBusy("save");setMessage("");setError("");
  try{
   await request({action:"save",masterUrl:masterUrl.trim(),enabled:true});
   setEditing(false);
   setMessage("Billing connection updated. Technical authority remains in License Manager.");
   await load({preserveFeedback:true});
  }catch(e:any){setError(e?.message||"Could not save connection")}
  finally{setBusy("")}
 }

 useEffect(()=>{void load()},[]);

 const connection=data?.connection||{};
 const connections=Array.isArray(data?.connections)?data.connections:[];
 const masterProducts=Array.isArray(data?.masterProducts)?data.masterProducts:[];
 const pulse=data?.pulse||{};
 const authority=pulse?.authority||{};
 const policy=pulse?.runtime_policy||{};
 const officialConnections=Array.isArray(data?.officialConnections)?data.officialConnections:[];
 const panelUrl=String(data?.masterPanelUrl||"https://panel.incendiarynetworks.cc").replace(/\/+$/,"");
 const masterSettings=panelUrl+"/settings";
 const connectedCount=connections.filter((row:any)=>row.connected).length;
 const authorityOnline=authority.system_enabled!==false&&authority.licensing_enabled!==false&&!authority.maintenance_mode&&!connection.last_error;
 const releaseOnline=authority.release_system_enabled!==false;
 const deploymentOnline=authority.deployment_enabled!==false;

 if(!data&&busy==="load")return <main className="adminShell orbitPhaseOne orbitProductConnectionsPage"><section className="orbitAdminLoading"><b>Loading Product Connections</b><span>Reading Billing mappings and live License Manager authority state.</span></section></main>;

 return <main className="adminShell orbitPhaseOne orbitProductConnectionsPage">
  <header className="orbitReferenceHero orbitPhaseHero">
   <div>
    <p className="eyebrow">MY ORBITFS · PRODUCT CONNECTIONS</p>
    <h1>Product Connections</h1>
    <p className="muted">Billing Store connects commerce products to the canonical License Manager catalogue. Licensing, release, deployment and runtime policy remain authoritative in License Manager.</p>
   </div>
   <div className="orbitReferenceHeroActions">
    <a className="buttonlink secondary" href={masterSettings} target="_blank" rel="noreferrer">Open authoritative settings ↗</a>
    <Link className="buttonlink secondary" href="/admin/licensing">Authority status</Link>
    <button className="secondary" type="button" onClick={()=>void load({test:true})} disabled={!!busy}>{busy==="test"?"Testing…":"Test connection"}</button>
    <button type="button" onClick={()=>void load()} disabled={!!busy}>{busy==="load"?"Refreshing…":"Refresh"}</button>
   </div>
  </header>

  {error&&<div className="orbitReferenceNotice danger" role="alert"><b>Connection action failed</b><span>{error}</span></div>}
  {message&&<div className="orbitReferenceNotice" role="status"><b>Updated</b><span>{message}</span></div>}

  <section className="orbitProductConnectionStatus">
   <div className="orbitAuthorityState">
    <span className={"orbitAuthorityDot "+(authorityOnline?"online":"")} aria-hidden="true"/>
    <div><small>BILLING → LICENSE MANAGER</small><b>{authorityOnline?"Connected":"Needs attention"}</b><span>{connection.last_error||"Billing is using the configured authoritative API."}</span></div>
   </div>
   <div className="orbitProductConnectionStatusMeta">
    <div><span>API</span><b className="orbitMono">{data?.configuredUrl||connection.master_url||"Not configured"}</b></div>
    <div><span>Last success</span><b>{connection.last_success_at?new Date(connection.last_success_at).toLocaleString():"Not recorded"}</b></div>
   </div>
  </section>

  <section className="orbitProductConnectionStats">
   <article><span>Product mappings</span><b>{connectedCount}/{Math.max(connections.length,4)}</b><small>Billing products connected to canonical catalogue</small></article>
   <article><span>Licensing authority</span><b>{authority.licensing_enabled===false?"Off":"On"}</b><small>{authority.maintenance_mode?"Maintenance mode active":"Validation and entitlement authority"}</small></article>
   <article><span>Release authority</span><b>{releaseOnline?"On":"Off"}</b><small>Channels, releases, validation and approval</small></article>
   <article><span>Deployment authority</span><b>{deploymentOnline?"On":"Off"}</b><small>Base, Update and rollback authorization</small></article>
  </section>

  <div className="orbitProductConnectionsGrid">
   <section className="orbitAuthorityPanel orbitProductConnectionPanel">
    <div className="orbitAuthorityPanelHead">
     <div><p className="eyebrow">BILLING CONNECTION</p><h2>Authority endpoint</h2><p>This controls only where Billing Store sends authenticated License Manager requests. It does not create technical state.</p></div>
     <span className={"orbitMiniState "+(connection.enabled!==false?"live":"")}>{connection.enabled===false?"Disabled":"Enabled"}</span>
    </div>

    {!editing?<div className="orbitProductConnectionReadout">
     <div><span>License Manager API</span><b className="orbitMono">{data?.configuredUrl||connection.master_url||"Not configured"}</b></div>
     <div><span>Manager UI</span><b className="orbitMono">{panelUrl}</b></div>
     <div><span>Last successful test</span><b>{connection.last_success_at?new Date(connection.last_success_at).toLocaleString():"Not tested"}</b></div>
     <div><span>Last error</span><b>{connection.last_error||"None"}</b></div>
    </div>:<div className="orbitProductConnectionEditor">
     <label><span>License Manager API</span><input value={masterUrl} onChange={event=>setMasterUrl(event.target.value)} placeholder="https://example.com/api/v1"/><small>Only an approved official License Manager endpoint is accepted by the server.</small></label>
     <label><span>Manager UI</span><input readOnly value={panelUrl}/><small>Read-only navigation target supplied by Billing configuration.</small></label>
    </div>}

    <div className="orbitProductConnectionActions">
     {editing?<><button className="secondary" type="button" disabled={!!busy} onClick={()=>{setEditing(false);setMasterUrl(String(data?.configuredUrl||connection.master_url||""))}}>Cancel</button><button type="button" disabled={busy==="save"||!masterUrl.trim()} onClick={()=>void saveConnection()}>{busy==="save"?"Saving…":"Save Billing connection"}</button></>:<button className="secondary" type="button" onClick={()=>setEditing(true)} disabled={!!busy}>Edit connection</button>}
    </div>
   </section>

   <section className="orbitAuthorityPanel orbitProductConnectionPanel">
    <div className="orbitAuthorityPanelHead"><div><p className="eyebrow">LIVE AUTHORITY</p><h2>Technical system state</h2><p>Read from License Manager. Billing does not expose duplicate authority switches.</p></div><span className={"orbitMiniState "+(authorityOnline?"live":"")}>{authorityOnline?"Online":"Restricted"}</span></div>
    <div className="orbitAuthorityCapabilityList orbitProductAuthorityList">
     <div><b>System API</b><span>External technical authority API</span><strong>{authority.system_enabled===false?"OFF":"ON"}</strong></div>
     <div><b>Licensing</b><span>Validation, issuance and entitlements</span><strong>{authority.licensing_enabled===false?"OFF":"ON"}</strong></div>
     <div><b>Release system</b><span>Shared Base + Update release authority</span><strong>{releaseOnline?"ON":"OFF"}</strong></div>
     <div><b>Deployment</b><span>Base, Update and rollback authorization</span><strong>{deploymentOnline?"ON":"OFF"}</strong></div>
     <div><b>Maintenance</b><span>{authority.maintenance_mode?"Authority maintenance is active":"Normal authority mode"}</span><strong>{authority.maintenance_mode?"ON":"OFF"}</strong></div>
    </div>
   </section>
  </div>

  <section className="orbitAuthorityPanel orbitProductCataloguePanel">
   <div className="orbitAuthorityPanelHead"><div><p className="eyebrow">CANONICAL PRODUCT MAPPINGS</p><h2>Billing products ↔ License Manager</h2><p>Commerce mappings may reference the canonical catalogue, but License Manager owns technical product and entitlement authority.</p></div><span>{connectedCount} connected</span></div>
   <div className="orbitProductMappingGrid">
    {(connections.length?connections:masterProducts.map((product:any)=>({code:String(product.code||product.slug||""),master:product,local:null,connected:false}))).map((row:any)=>{
     const code=String(row.code||row.master?.code||row.master?.slug||"");
     return <article key={code||row.master?.id}>
      <div className="orbitAuthorityProductMark">{code==="orbitfs_base"?"B":code==="orbitfs_mcp"?"M":code==="orbitfs_apex"?"A":"S"}</div>
      <div><b>{productLabel(code)}</b><span className="orbitMono">{code||"Unknown product"}</span><small>{row.master?.name||"Not returned by License Manager"}</small></div>
      <div className="orbitProductMappingState"><span className={"orbitMiniState "+(row.connected?"live":"")}>{row.connected?"Connected":"Needs mapping"}</span><small>{row.local?.slug||row.local?.name||"Billing mapping"}</small></div>
     </article>
    })}
    {!connections.length&&!masterProducts.length&&<div className="orbitReferenceEmpty compact"><b>No product catalogue returned</b><span>Test or refresh the License Manager connection to load canonical products.</span></div>}
   </div>
  </section>

  <section className="orbitProductConnectionsGrid">
   <section className="orbitAuthorityPanel orbitProductConnectionPanel">
    <div className="orbitAuthorityPanelHead"><div><p className="eyebrow">LIVE RUNTIME POLICY</p><h2>Validation and pulse</h2><p>Read-only here. Change runtime policy only in License Manager API Control.</p></div><span>Pulse #{Number(pulse.pulse_revision||0)||"—"}</span></div>
    <div className="orbitProductPolicyGrid">
     <div><span>Validation cache TTL</span><b>{Number(policy.validation_ttl_seconds||0)}s</b></div>
     <div><span>Pulse interval</span><b>{Number(policy.pulse_poll_seconds||0)}s</b></div>
     <div><span>Failed validations</span><b>{Number(policy.max_failed_validations||0)}</b></div>
     <div><span>Offline grace</span><b>{policy.allow_offline_grace?`${Number(policy.offline_grace_seconds||0)}s`:"Off"}</b></div>
    </div>
    <div className="orbitProductConnectionFooter"><span>Last pulse: {pulse.pulse_at?new Date(pulse.pulse_at).toLocaleString():"Never"} · {pulse.pulse_reason||"No reason recorded"}</span><a className="buttonlink secondary" href={masterSettings} target="_blank" rel="noreferrer">Manage in License Manager ↗</a></div>
   </section>

   <section className="orbitAuthorityPanel orbitProductConnectionPanel">
    <div className="orbitAuthorityPanelHead"><div><p className="eyebrow">OFFICIAL CONNECTIONS</p><h2>Approved authority endpoints</h2><p>Resolved by Billing's License Manager configuration. These are not customer provider connections.</p></div><span>{officialConnections.length}</span></div>
    <div className="orbitOfficialConnectionList">
     {officialConnections.length?officialConnections.map((row:any,index:number)=><div key={row.id||row.url||row.master_url||index}><span className={"orbitAuthorityDot "+(row.enabled===false?"":"online")} aria-hidden="true"/><div><b>{row.name||row.label||"Official License Manager"}</b><small className="orbitMono">{row.url||row.master_url||row.api_url||"Configured endpoint"}</small></div><span>{row.enabled===false?"Disabled":"Approved"}</span></div>):<div className="orbitReferenceEmpty compact"><span>No additional official endpoint records were returned.</span></div>}
    </div>
   </section>
  </section>
 </main>;
}
