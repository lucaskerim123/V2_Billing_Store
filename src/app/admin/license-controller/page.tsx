"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import {createClient} from "@/lib/supabase";
import {canonicalLicenseStatus,canonicalStatusLabel,isCanonicalLicenseUsable} from "@/lib/license-status";

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
 const [editingNickname,setEditingNickname]=useState("");
 const [nickname,setNickname]=useState("");
 const [issueComponents,setIssueComponents]=useState({orbitfs_apex:false,orbitfs_mcp:false,orbitfs_studio:false});
 const [channelData,setChannelData]=useState<any>({channels:[],access:[]});
 const [confirmState,setConfirmState]=useState<{title:string;message:string}|null>(null);
 const confirmAction=useRef<null|(()=>void)>(null);

 function askConfirmation(title:string,message:string,action:()=>void){
  confirmAction.current=action;
  setConfirmState({title,message});
 }
 function closeConfirmation(){confirmAction.current=null;setConfirmState(null)}
 function acceptConfirmation(){
  const action=confirmAction.current;
  closeConfirmation();
  action?.();
 }

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
   const h={Authorization:"Bearer "+t};
   const [r,cr]=await Promise.all([
    fetch("/api/admin/license-link?customerId="+encodeURIComponent(id),{headers:h,cache:"no-store"}),
    fetch("/api/admin/orbitfs/release-channels",{headers:h,cache:"no-store"})
   ]);
   const j=await r.json().catch(()=>({}));
   const cj=await cr.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not load customer licences.");
   setData(j);
   setChannelData(cr.ok?cj:{channels:[],access:[]});
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

 async function issueAdditional(confirmed=false){
  if(!customerId)return;
  if(!confirmed){askConfirmation("Issue additional licence","Create another independent OrbitFS Base licence for this customer. Existing licences remain active.",()=>void issueAdditional(true));return;}
  setBusy("issue-additional");setError("");setMessage("");setNewKey("");
  try{
   const t=await getToken();
   const components={orbitfs_base:true,...issueComponents};
   const r=await fetch("/api/admin/license-assign",{method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json"},body:JSON.stringify({customerId,product:"orbitfs_base",label:"Additional OrbitFS licence",allowMultiple:true,components})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not issue additional licence.");
   if(j.licenseKey)setNewKey(String(j.licenseKey));
   setMessage(j.alreadyIssued?"License Manager reused the matching request.":"Additional licence issued and linked to this customer.");
   await loadCustomer(customerId);
  }catch(e:any){setError(e?.message||"Could not issue additional licence.")}
  finally{setBusy("")}
 }

 async function saveNickname(bindingId:string){
  setBusy("nickname:"+bindingId);setError("");setMessage("");
  try{
   const t=await getToken();
   const r=await fetch("/api/admin/license-link",{method:"PATCH",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json"},body:JSON.stringify({customerId,bindingId,nickname})});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||"Could not save nickname.");
   setEditingNickname("");setNickname("");
   setMessage("Licence display name saved.");
   await loadCustomer(customerId);
  }catch(e:any){setError(e?.message||"Could not save nickname.")}
  finally{setBusy("")}
 }

 async function control(licenseId:string,action:string,installationId="",confirmed=false){
  const needsInstallation=["lock-installation","unlock-installation","reactivate-installation","terminate-installation"].includes(action);
  if(needsInstallation&&!installationId){setError("A specific installation is required for this control.");return}
  if(!confirmed){
   const title=action==="rotate"?"Rotate licence key":action==="terminate"?"Terminate licence":"Confirm licence action";
   const message=action==="rotate"?"The current key will be replaced and the new key will be shown once.":action==="terminate"?"This terminates the licence. Recovery requires an explicit reactivation flow.":"Apply "+action.replaceAll("-"," ")+" to this licence?";
   askConfirmation(title,message,()=>void control(licenseId,action,installationId,true));
   return;
  }
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

 async function controlComponent(licenseId:string,component:string,enabled:boolean,confirmed=false){
  const label=productName(component);
  if(!confirmed){askConfirmation((enabled?"Activate ":"Deactivate ")+label,(enabled?"Enable ":"Disable ")+label+" on this licence. The Base installation binding remains locked to its current installation.",()=>void controlComponent(licenseId,component,enabled,true));return;}
  setBusy("component:"+component+":"+licenseId);setError("");setMessage("");
  try{
   const t=await getToken();
   const r=await fetch("/api/admin/license-master?path="+encodeURIComponent("/api/v1/license/"+encodeURIComponent(licenseId)+"/control"),{
    method:"POST",
    headers:{Authorization:"Bearer "+t,"Content-Type":"application/json"},
    body:JSON.stringify({action:"set-component",component,enabled,actorRef:"billing_store_license_controller"})
   });
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||("Could not "+(enabled?"activate ":"deactivate ")+label+"."));
   setMessage(j.message||label+(enabled?" activated.":" deactivated."));
   await loadCustomer(customerId);
  }catch(e:any){setError(e?.message||("Could not "+(enabled?"activate ":"deactivate ")+label+"."))}
  finally{setBusy("")}
 }

 const bindings=data?.bindings||[];
 const selectedUserId=String(data?.customer?.auth_user_id||data?.customer?.user_id||selectedCustomer?.auth_user_id||selectedCustomer?.user_id||"");
 const channelDefinitions=(channelData?.channels||[]) as Array<{channel:string;label?:string;enabled?:boolean;customer_visible?:boolean;access_mode?:string}>;
 const customerChannelAccess=(channelData?.access||[]).filter((x:any)=>String(x.user_id||"")===selectedUserId);
 const hasUsableBase=bindings.some((b:any)=>String(b.license_product_key||"").toLowerCase()==="orbitfs_base"&&isCanonicalLicenseUsable(b));
 const channelsForLicense=(licenseId:string)=>{
  const explicit=customerChannelAccess.filter((x:any)=>String(x.license_id||"")===String(licenseId||"")).map((x:any)=>String(x.channel||"")).filter(Boolean);
  const automatic=channelDefinitions.filter((x:any)=>x.enabled!==false&&x.customer_visible!==false&&(x.channel==="stable"||x.access_mode==="open")).map((x:any)=>String(x.channel));
  return [...new Set([...automatic,...explicit])];
 };

 return <main className="lmPage licenseControllerPage orbitReferencePage orbitLicenceReference orbitPhaseOne">
  <header className="orbitReferenceHero">
   <div>
    <p className="eyebrow">MY ORBITFS · CUSTOMER LICENCES</p>
    <h1>Customer Licence Manager</h1>
    <p className="muted">Manage Billing Store customer links and run permitted licence actions through the authoritative License Manager APIs.</p>
   </div>
   <div className="orbitReferenceHeroActions">
    <button className="secondary" type="button" onClick={()=>void refresh()} disabled={loading}>{loading?"Refreshing…":"Refresh"}</button>
    <button type="button" onClick={()=>void link("","auto")} disabled={!selectedCustomer||!!busy}>{busy==="auto:"?"Matching…":"Auto-link match"}</button>
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
       <span className="orbitMiniState live">{bindings.some((b:any)=>isCanonicalLicenseUsable(b))?"Active":"Linked"}</span>
       <span className="orbitLicenceCount">{bindings.length} {bindings.length===1?"licence":"licences"}</span>
      </div>
    </div>

    <section className="orbitReferenceSection orbitLicenceChannelSummary">
     <div className="orbitReferenceSectionHead"><div><b>Release channel access</b><small>Shared Base + Update eligibility from the authoritative License Manager channel system.</small></div><span>{customerChannelAccess.length} explicit grants</span></div>
     <div className="orbitLicenceChannelGrid">
      {channelDefinitions.filter((ch:any)=>ch.enabled!==false&&ch.customer_visible!==false).map((ch:any)=>{
       const automatic=ch.channel==="stable"||ch.access_mode==="open";
       const explicit=customerChannelAccess.some((grant:any)=>String(grant.channel||"")===String(ch.channel));
       const available=(automatic&&hasUsableBase)||explicit;
       return <div key={ch.channel} className={available?"available":""}><span><b>{ch.label||ch.channel}</b><small>{ch.channel} · {automatic?(hasUsableBase?"automatic":"requires active Base licence"):explicit?"explicit grant":"restricted"}</small></span><span className={"orbitMiniState "+(available?"live":"")}>{available?"Available":"No access"}</span></div>
      })}
      {!channelDefinitions.length&&<div className="orbitReferenceEmpty compact">Channel authority is unavailable for this customer view.</div>}
     </div>
    </section>

    {newKey&&<section className="orbitReferenceKeyBox" role="status">
     <div><b>New licence key</b><span>Shown once. Save it before leaving this page.</span></div>
     <code>{newKey}</code>
     <div className="orbitReferenceDecision"><button onClick={()=>void navigator.clipboard?.writeText(newKey)}>Copy key</button><button className="secondary" onClick={()=>setNewKey("")}>Dismiss</button></div>
    </section>}

    <section className="orbitReferenceSection">
     <div className="orbitReferenceSectionHead"><div><b>Linked licences</b><small>License Manager records currently linked to this Billing Store customer.</small></div><span>{bindings.length}</span></div>
     {loading?<div className="orbitReferenceEmpty compact">Loading customer licences…</div>:bindings.length?<div className="orbitReferenceLicenceList">
      {bindings.map((b:any)=>{
       const status=canonicalLicenseStatus(b);
       const authoritativeComponents=b.authoritative_components||{};
       const components=Object.entries(authoritativeComponents).filter(([,enabled])=>Boolean(enabled)).map(([key])=>productName(key)).join(" · ")||productName(b.license_product_key||"orbitfs_base");
       const addonControls=[["orbitfs_apex","APEX"],["orbitfs_mcp","MCP"],["orbitfs_studio","Studio"]] as const;
       const installs=b.master_activations?.length?b.master_activations:(data?.installations||[]).filter((i:any)=>String(i.license_binding_id)===String(b.id)).map((i:any)=>({...i,status:i.state}));
       return <details className="orbitReferenceLicenceCard" key={b.id}>
        <summary className="orbitReferenceLicenceTop" style={{cursor:"pointer",listStyle:"none",alignItems:"center"}}>
         <div><h3>{b.label||productName(b.license_product_key)}</h3><p>{productName(b.license_product_key)} · {b.license_key_last4?"••••-"+b.license_key_last4:"Protected"}</p></div>
         <span style={{display:"flex",alignItems:"center",gap:12}}><span className={"orbitMiniState "+((status==="active"||status==="locked")?"live":(status==="restricted"||status==="suspended")?"suspended":"")}>{canonicalStatusLabel(status)}</span><span aria-hidden="true">▾</span></span>
        </summary>
        <div style={{padding:"0 12px 12px"}}>
         {editingNickname===String(b.id)?<div className="orbitReferenceActions" style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"center"}}>
           <input aria-label="Licence nickname" maxLength={80} autoFocus value={nickname} onChange={e=>setNickname(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();void saveNickname(String(b.id))}}} placeholder="Licence nickname (optional)"/>
           <button disabled={!!busy} onClick={()=>void saveNickname(String(b.id))}>{busy==="nickname:"+b.id?"Saving…":"Save name"}</button>
           <button className="secondary" onClick={()=>{setEditingNickname("");setNickname("")}}>Cancel</button>
          </div>:<div className="orbitReferenceActions"><button className="secondary" disabled={!!busy} onClick={()=>{setEditingNickname(String(b.id));setNickname(b.label===productName(b.license_product_key)?"":String(b.label||""))}}>Edit nickname</button></div>}

        <div className="orbitReferenceLicenceFacts">
         <div><span>Licence key</span><b>{b.license_key_last4?"••••-"+b.license_key_last4:"Protected"}</b></div>
         <div><span>Expiry</span><b>{b.authoritative_expires_at?new Date(b.authoritative_expires_at).toLocaleDateString():"No expiry"}</b></div>
         <div><span>Components</span><b>{components}</b></div>
         <div><span>Release channels</span><b>{channelsForLicense(String(b.license_id)).join(" · ")||"No channel access"}</b></div>
        </div>
        <div className="orbitReferenceLicenceActions">
         {(status==="active"||status==="locked")&&<button disabled={!!busy} onClick={()=>void control(String(b.license_id),"rotate")}>{busy.startsWith("rotate:"+b.license_id)?"Rotating…":"Rotate key"}</button>}
         {(status==="active"||status==="locked")&&<button className="secondary" disabled={!!busy} onClick={()=>void control(String(b.license_id),"restrict")}>{busy.startsWith("restrict:"+b.license_id)?"Restricting…":"Restrict"}</button>}
         {status==="restricted"&&<button className="secondary" disabled={!!busy} onClick={()=>void control(String(b.license_id),"activate")}>{busy.startsWith("activate:"+b.license_id)?"Removing…":"Remove restriction"}</button>}
         {status==="suspended"&&<span className="orbitMiniState suspended">Account suspended · manage customer</span>}
         {status==="terminated"&&<button className="secondary" disabled={!!busy} onClick={()=>void control(String(b.license_id),"activate")}>{busy.startsWith("activate:"+b.license_id)?"Reactivating…":"Reactivate with new key"}</button>}
         {status!=="terminated"&&<button className="danger" disabled={!!busy} onClick={()=>void control(String(b.license_id),"terminate")}>{busy.startsWith("terminate:"+b.license_id)?"Terminating…":"Terminate"}</button>}
        </div>
        <div className="orbitReferenceInstallations">
         {addonControls.map(([key,label])=>{const enabled=Boolean(authoritativeComponents[key]);const busyKey="component:"+key+":"+b.license_id;return <div key={key}><span><b>{label}</b><small>{enabled?"Active entitlement":"Not entitled"} · Base binding stays locked</small></span><button className="secondary" disabled={!!busy||!(status==="active"||status==="locked")} onClick={()=>void controlComponent(String(b.license_id),key,!enabled)}>{busy===busyKey?(enabled?"Deactivating…":"Activating…"):(enabled?"Deactivate":"Activate")}</button></div>})}
        </div>
        {!!installs.length&&<div className="orbitReferenceInstallations">
         {installs.map((i:any)=><div key={i.id||i.installation_id}><span><b>{i.installation_id}</b><small>{String(i.status||"").toLowerCase()==="active"?"bound / locked":String(i.status||"").toLowerCase()==="released"?"released / unlocked":i.status||"unknown"}</small></span>{String(i.status||"").toLowerCase()==="active"&&<button className="secondary" disabled={!!busy} onClick={()=>void control(String(b.license_id),"unlock-installation",String(i.installation_id))}>{busy===("unlock-installation:"+b.license_id+":"+i.installation_id)?"Releasing…":"Unlock / release"}</button>}</div>)}
        </div>}
        </div>
       </details>
      })}
     </div>:<div className="orbitReferenceEmpty compact"><b>No licence is linked to this customer.</b><span>Use Auto-link or open the License Manager inventory below to link an existing licence.</span></div>}
    </section>

    <section className="orbitReferenceSection">
     <div className="orbitReferenceSectionHead"><div><b>Issue additional licence</b><small>Explicit admin override. Creates another independent Base licence set without replacing the customer's existing current licence.</small></div><span>1 system per licence</span></div>
     <div className="orbitReferenceInstallations">
      <div><span><b>OrbitFS Base</b><small>Always included</small></span><span className="orbitMiniState live">Included</span></div>
      <div><span><b>APEX</b><small>Optional entitlement on the new licence</small></span><input type="checkbox" checked={issueComponents.orbitfs_apex} onChange={e=>setIssueComponents(v=>({...v,orbitfs_apex:e.target.checked}))}/></div>
      <div><span><b>MCP</b><small>Optional entitlement on the new licence</small></span><input type="checkbox" checked={issueComponents.orbitfs_mcp} onChange={e=>setIssueComponents(v=>({...v,orbitfs_mcp:e.target.checked}))}/></div>
      <div><span><b>Studio</b><small>Optional entitlement on the new licence</small></span><input type="checkbox" checked={issueComponents.orbitfs_studio} onChange={e=>setIssueComponents(v=>({...v,orbitfs_studio:e.target.checked}))}/></div>
     </div>
     <div className="orbitReferenceActions"><button disabled={!!busy||!selectedCustomer} onClick={()=>void issueAdditional()}>{busy==="issue-additional"?"Issuing…":"Issue additional licence"}</button></div>
    </section>

    <details className="orbitReferenceInventory">
     <summary><div><b>Link an existing licence</b><span>Open License Manager inventory</span></div><span>＋</span></summary>
     <div className="orbitReferenceInventoryBody">
      <p>These are existing License Manager records. Linking creates the Billing Store customer association only; it does not issue a licence.</p>
      <input value={masterQuery} onChange={e=>setMasterQuery(e.target.value)} placeholder="Search licence ID, product, status, customer reference or order…"/>
      <div className="orbitReferenceGrantList inventory">
       {available.slice(0,50).map((x:any)=><div className="orbitReferenceGrantRow" key={String(x.id||x.license_id)}><div><b>{productName(x.product_code||x.product)}</b><small>{x.id||x.license_id} · {canonicalStatusLabel(canonicalLicenseStatus(x))}{x.customer_external_id?" · Customer ref "+x.customer_external_id:""}</small></div><button disabled={!!busy} onClick={()=>void link(String(x.id||x.license_id))}>{busy==="manual:"+String(x.id||x.license_id)?"Linking…":"Link to customer"}</button></div>)}
       {!available.length&&<div className="orbitReferenceEmpty compact">No unlinked licences match this search.</div>}
      </div>
     </div>
    </details>
   </>:<div className="orbitReferenceEmpty">Select a customer to review linked licences.</div>}
   </section>
  </div>
  {confirmState&&<div className="orbitConfirmBackdrop" role="presentation" onMouseDown={closeConfirmation}>
   <section className="orbitConfirmDialog" role="dialog" aria-modal="true" aria-labelledby="orbit-confirm-title" onMouseDown={event=>event.stopPropagation()}>
    <p className="eyebrow">CONFIRM ACTION</p>
    <h2 id="orbit-confirm-title">{confirmState.title}</h2>
    <p>{confirmState.message}</p>
    <div className="orbitReferenceDecision"><button className="secondary" type="button" onClick={closeConfirmation}>Cancel</button><button type="button" onClick={acceptConfirmation}>Confirm</button></div>
   </section>
  </div>}
 </main>;
}
