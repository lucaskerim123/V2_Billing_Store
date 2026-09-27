"use client";

import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

type Row=Record<string,any>;

const productName=(x:any)=>({
 orbitfs_base:"OrbitFS Base",
 orbitfs_apex:"OrbitFS APEX",
 orbitfs_mcp:"OrbitFS MCP",
 orbitfs_studio:"OrbitFS Studio"
}[String(x||"").toLowerCase()]||String(x||"OrbitFS licence"));

const initials=(name:string)=>{
 const parts=String(name||"").trim().split(/\s+/).filter(Boolean);
 return (parts.length>1?parts[0][0]+parts[1][0]:parts[0]?.slice(0,2)||"CU").toUpperCase();
};

export default function LicenseControllerPage(){
 const sb=useMemo(()=>createClient(),[]);
 const [customers,setCustomers]=useState<Row[]>([]);
 const [customerQuery,setCustomerQuery]=useState("");
 const [customerId,setCustomerId]=useState("");
 const [data,setData]=useState<any>(null);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState("");
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const [masterQuery,setMasterQuery]=useState("");
 const [newKey,setNewKey]=useState("");

 async function getToken(){
  const {data:{session}}=await sb.auth.getSession();
  if(!session?.access_token)throw Error("Administrator session expired.");
  return session.access_token;
 }

 async function loadCustomers(){
  const {data,error}=await sb.from("customers").select("id,auth_user_id,user_id,customer_number,name,email").not("auth_user_id","is",null).order("created_at",{ascending:false});
  if(error)throw error;
  const rows=data||[];
  setCustomers(rows);
  setCustomerId(current=>current||String(rows[0]?.id||""));
 }

 async function loadCustomer(id=customerId){
  if(!id){setData(null);return}
  setLoading(true);setError("");
  try{
   const t=await getToken();
   const r=await fetch("/api/admin/license-link?customerId="+encodeURIComponent(id),{headers:{Authorization:"Bearer "+t},cache:"no-store"});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not load customer licences.");
   setData(j);
  }catch(e:any){
   setError(e?.message||"Could not load customer licences.");
   setData(null);
  }finally{setLoading(false)}
 }

 async function refresh(){
  setLoading(true);setError("");
  try{
   await loadCustomers();
   if(customerId)await loadCustomer(customerId);
  }catch(e:any){setError(e?.message||"Could not refresh customer licences.")}
  finally{setLoading(false)}
 }

 useEffect(()=>{
  setLoading(true);
  loadCustomers().catch(e=>setError(e?.message||"Could not load customers.")).finally(()=>setLoading(false));
 },[]);
 useEffect(()=>{if(customerId)void loadCustomer(customerId)},[customerId]);

 const filteredCustomers=customers.filter(c=>{
  const q=customerQuery.trim().toLowerCase();
  if(!q)return true;
  return [c.name,c.email,c.customer_number,c.id].some(v=>String(v||"").toLowerCase().includes(q));
 }).slice(0,30);

 const selectedCustomer=data?.customer||customers.find(c=>c.id===customerId);
 const linkedIds=new Set((data?.bindings||[]).map((b:any)=>String(b.license_id||"")));
 const available=(data?.allLicenses||[])
  .filter((x:any)=>!linkedIds.has(String(x.id||x.license_id||"")))
  .filter((x:any)=>{
   const q=masterQuery.trim().toLowerCase();
   if(!q)return true;
   return [x.id,x.product_code,x.product,x.status,x.customer_external_id,x.external_reference,x.order_ref].some(v=>String(v||"").toLowerCase().includes(q));
  });

 async function link(licenseId="",mode="manual"){
  setBusy(mode+":"+licenseId);setError("");setMessage("");
  try{
   const t=await getToken();
   const r=await fetch("/api/admin/license-link",{method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json"},body:JSON.stringify({customerId,licenseId,mode})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not link licence.");
   setMessage(productName(j.product)+" linked"+(mode==="auto"&&j.matchReason?" · matched by "+j.matchReason:"")+".");
   await loadCustomer(customerId);
  }catch(e:any){setError(e?.message||"Could not link licence.")}
  finally{setBusy("")}
 }

 async function control(licenseId:string,action:string,installationId=""){
  const needsInstallation=["lock-installation","unlock-installation","reactivate-installation","terminate-installation"].includes(action);
  if(needsInstallation&&!installationId){setError("A specific installation is required for this control.");return}
  if(!confirm(action==="rotate"?"Rotate this licence key? The replacement key will be shown once.":"Apply "+action+" to this licence?"))return;
  setBusy(action+":"+licenseId+":"+installationId);setError("");setMessage("");
  try{
   const t=await getToken();
   const r=await fetch("/api/admin/license-master?path="+encodeURIComponent("/api/v1/license/"+encodeURIComponent(licenseId)+"/control"),{
    method:"POST",
    headers:{Authorization:"Bearer "+t,"Content-Type":"application/json"},
    body:JSON.stringify({action,installation_id:needsInstallation?installationId:undefined,actorRef:"billing_store_license_controller"})
   });
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||("Licence "+action+" failed."));
   const key=j?.key||j?.license?.key||j?.license_key||j?.licenseKey||"";
   if(key)setNewKey(String(key));
   else if(action==="rotate")throw Error("License Manager completed rotation but did not return the replacement key.");
   setMessage(j.message||("Licence "+action+" completed."));
   await loadCustomer(customerId);
  }catch(e:any){setError(e?.message||("Licence "+action+" failed."))}
  finally{setBusy("")}
 }

 const bindings=data?.bindings||[];

 return <main className="lmPage licenseControllerPage orbitReferencePage orbitLicenceReference">
  <header className="orbitReferenceHero">
   <div>
    <p className="eyebrow">MY ORBITFS · CUSTOMER LICENCES</p>
    <h1>Customer Licence Manager</h1>
    <p className="muted">Manage Billing Store customer links and run permitted licence actions through the authoritative License Manager APIs.</p>
   </div>
   <div className="orbitReferenceHeroActions">
    <button className="orbitIconAction" title="Refresh customer licences" aria-label="Refresh customer licences" onClick={()=>void refresh()} disabled={loading}>↻</button>
    <button className="orbitIconAction primary" title="Auto-link licence" aria-label="Auto-link licence" onClick={()=>void link("","auto")} disabled={!selectedCustomer||!!busy}>↗</button>
   </div>
  </header>

  {error&&<div className="orbitReferenceNotice danger" role="alert"><b>Action failed</b><span>{error}</span></div>}
  {message&&<div className="orbitReferenceNotice" role="status">{message}</div>}

  <div className="orbitReferenceSplit licence">
   <aside className="orbitReferenceRail">
    <div className="orbitReferenceRailHead">
     <b>Select customer</b>
     <span>Search customer accounts and review linked licence records.</span>
    </div>
    <div className="orbitReferenceSearch"><input value={customerQuery} onChange={e=>setCustomerQuery(e.target.value)} placeholder="Search customers"/></div>
    <div className="orbitReferenceRailList customers">
     {filteredCustomers.map(c=><button type="button" key={c.id} className={"orbitReferenceCustomerCard "+(customerId===c.id?"active":"")} onClick={()=>setCustomerId(c.id)}>
      <b>{c.name||"Unnamed customer"}</b>
      <span>{c.email||"No email"}</span>
      <small>{c.customer_number||c.id}</small>
     </button>)}
     {!filteredCustomers.length&&<div className="orbitReferenceEmpty compact">No customers found.</div>}
    </div>
   </aside>

   <section className="orbitReferenceWorkspace licence">
    {selectedCustomer?<><div className="orbitReferenceCustomerHead">
      <div className="orbitReferenceAvatar">{initials(selectedCustomer.name||selectedCustomer.email||"Customer")}</div>
      <div className="orbitReferenceCustomerIdentity">
       <h2>{selectedCustomer.name||"Customer"}</h2>
       <p>{selectedCustomer.email||"No email"}</p>
       <small>{selectedCustomer.customer_number||selectedCustomer.id}</small>
      </div>
      <div className="orbitReferenceCustomerSummary">
       <span className="orbitMiniState live">{bindings.some((b:any)=>String(b.authoritative_status||b.status||"").toLowerCase()==="active")?"Active":"Linked"}</span>
       <span className="orbitLicenceCount">{bindings.length} {bindings.length===1?"licence":"licences"}</span>
      </div>
    </div>

    {newKey&&<section className="orbitReferenceKeyBox" role="status">
     <div><b>Replacement licence key</b><span>Shown once. Save it before leaving this page.</span></div>
     <code>{newKey}</code>
     <div className="orbitReferenceDecision"><button onClick={()=>void navigator.clipboard?.writeText(newKey)}>Copy key</button><button className="secondary" onClick={()=>setNewKey("")}>Dismiss</button></div>
    </section>}

    <section className="orbitReferenceSection">
     <div className="orbitReferenceSectionHead"><div><b>Linked licences</b><small>License Manager records currently linked to this Billing Store customer.</small></div><span>{bindings.length}</span></div>
     {loading?<div className="orbitReferenceEmpty compact">Loading customer licences…</div>:bindings.length?<div className="orbitReferenceLicenceList">
      {bindings.map((b:any)=>{
       const status=String(b.authoritative_status||b.status||"unknown").toLowerCase();
       const components=Object.entries(b.authoritative_components||{}).filter(([,enabled])=>Boolean(enabled)).map(([key])=>productName(key)).join(" · ")||productName(b.license_product_key||"orbitfs_base");
       const installs=b.master_activations?.length?b.master_activations:(data?.installations||[]).filter((i:any)=>String(i.license_binding_id)===String(b.id)).map((i:any)=>({...i,status:i.state}));
       return <article className="orbitReferenceLicenceCard" key={b.id}>
        <div className="orbitReferenceLicenceTop">
         <div><h3>{productName(b.license_product_key||b.label)}</h3><p>{b.label&&b.label!==productName(b.license_product_key)?b.label:"License Manager authority"}</p></div>
         <span className={"orbitMiniState "+(status==="active"?"live":status==="suspended"?"suspended":"")}>{status}</span>
        </div>
        <div className="orbitReferenceLicenceFacts">
         <div><span>Licence key</span><b>{b.license_key_last4?"••••-"+b.license_key_last4:"Protected"}</b></div>
         <div><span>Expiry</span><b>{b.authoritative_expires_at?new Date(b.authoritative_expires_at).toLocaleDateString():"No expiry"}</b></div>
         <div><span>Components</span><b>{components}</b></div>
        </div>
        <div className="orbitReferenceLicenceActions">
         {status==="active"&&<button disabled={!!busy} onClick={()=>void control(String(b.license_id),"rotate")}>{busy.startsWith("rotate:"+b.license_id)?"Rotating…":"Rotate key"}</button>}
         {["active","suspended"].includes(status)&&<button className="secondary" disabled={!!busy} onClick={()=>void control(String(b.license_id),status==="suspended"?"activate":"suspend")}>{busy.startsWith("activate:"+b.license_id)?"Unsuspending…":busy.startsWith("suspend:"+b.license_id)?"Suspending…":status==="suspended"?"Unsuspend":"Suspend"}</button>}
         <button className="danger" disabled={!!busy} onClick={()=>void control(String(b.license_id),"revoke")}>{busy.startsWith("revoke:"+b.license_id)?"Terminating…":"Terminate"}</button>
        </div>
        {!!installs.length&&<div className="orbitReferenceInstallations">
         {installs.map((i:any)=><div key={i.id||i.installation_id}><span><b>{i.installation_id}</b><small>{i.status||"unknown"}</small></span>{String(i.status||"").toLowerCase()==="active"&&<button className="secondary" disabled={!!busy} onClick={()=>void control(String(b.license_id),"unlock-installation",String(i.installation_id))}>{busy===("unlock-installation:"+b.license_id+":"+i.installation_id)?"Releasing…":"Unlock / release"}</button>}</div>)}
        </div>}
       </article>
      })}
     </div>:<div className="orbitReferenceEmpty compact"><b>No licence is linked to this customer.</b><span>Use Auto-link or open the License Manager inventory below to link an existing licence.</span></div>}
    </section>

    <details className="orbitReferenceInventory">
     <summary><div><b>Link an existing licence</b><span>Open License Manager inventory</span></div><span>＋</span></summary>
     <div className="orbitReferenceInventoryBody">
      <p>These are existing License Manager records. Linking creates the Billing Store customer association only; it does not issue a licence.</p>
      <input value={masterQuery} onChange={e=>setMasterQuery(e.target.value)} placeholder="Search licence ID, product, status, customer reference or order…"/>
      <div className="orbitReferenceGrantList inventory">
       {available.slice(0,50).map((x:any)=><div className="orbitReferenceGrantRow" key={String(x.id||x.license_id)}><div><b>{productName(x.product_code||x.product)}</b><small>{x.id||x.license_id} · {x.status||"unknown"}{x.customer_external_id?" · Customer ref "+x.customer_external_id:""}</small></div><button disabled={!!busy} onClick={()=>void link(String(x.id||x.license_id))}>{busy==="manual:"+String(x.id||x.license_id)?"Linking…":"Link to customer"}</button></div>)}
       {!available.length&&<div className="orbitReferenceEmpty compact">No unlinked licences match this search.</div>}
      </div>
     </div>
    </details>
   </>:<div className="orbitReferenceEmpty">Select a customer to review linked licences.</div>}
   </section>
  </div>
 </main>;
}
