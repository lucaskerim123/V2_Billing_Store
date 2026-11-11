"use client";

import {useCallback,useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

type Row=Record<string,any>;
const statusOf=(row:Row)=>String(row.canonical_status||row.effective_status||row.status||row.storage_status||"unknown").toLowerCase();
const idOf=(row:Row)=>String(row.id||row.license_id||row.license?.id||"");

export default function ProductLicensesPage(){
  const sb=useMemo(()=>createClient(),[]);
  const [products,setProducts]=useState<Row[]>([]);
  const [customers,setCustomers]=useState<Row[]>([]);
  const [licenses,setLicenses]=useState<Row[]>([]);
  const [product,setProduct]=useState("");
  const [customerId,setCustomerId]=useState("");
  const [expiry,setExpiry]=useState("");
  const [maxInstallations,setMaxInstallations]=useState("1");
  const [featureText,setFeatureText]=useState("");
  const [query,setQuery]=useState("");
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [newKey,setNewKey]=useState("");

  const token=useCallback(async()=>{
    const {data:{session}}=await sb.auth.getSession();
    if(!session?.access_token)throw new Error("Administrator session expired. Sign in again.");
    return session.access_token;
  },[sb]);

  const request=useCallback(async(method:"GET"|"POST",body?:Row)=>{
    const access=await token();
    const response=await fetch("/api/admin/product-licenses",{method,headers:{authorization:`Bearer ${access}`,"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"Product licence request failed");
    return data;
  },[token]);

  const refresh=useCallback(async()=>{
    setBusy("load");setError("");
    try{
      const data=await request("GET");
      const nextProducts=Array.isArray(data.products)?data.products:[];
      const nextCustomers=Array.isArray(data.customers)?data.customers:[];
      setProducts(nextProducts);setCustomers(nextCustomers);setLicenses(Array.isArray(data.licenses)?data.licenses:[]);
      setProduct(current=>current||String(nextProducts[0]?.slug||nextProducts[0]?.product_code||""));
      setCustomerId(current=>current||String(nextCustomers[0]?.id||""));
    }catch(e:any){setError(e?.message||"Could not load licences")}
    finally{setBusy("")}
  },[request]);

  useEffect(()=>{void refresh()},[refresh]);

  const selectedCustomer=customers.find(x=>String(x.id)===customerId);
  const filtered=licenses.filter(row=>{
    const haystack=[row.id,row.license_id,row.product,row.product_code,row.customer_external_id,row.external_reference,row.status,row.license_key_last4].join(" ").toLowerCase();
    return haystack.includes(query.toLowerCase());
  });
  const productGroups=new Map(products.map(p=>[String(p.slug||p.product_code||"").toLowerCase(),String(p.group_name||"Ungrouped")]));
  const groupedLicenses=filtered.reduce((groups,row)=>{
    const productCode=String(row.product_code||row.product||"").toLowerCase();
    const groupName=productGroups.get(productCode)||"Ungrouped";
    (groups[groupName] ||= []).push(row);
    return groups;
  },{} as Record<string,Row[]>);

  function featuresObject(){
    return Object.fromEntries([...new Set(featureText.split(",").map(x=>x.trim().toLowerCase()).filter(Boolean))].map(x=>[x,true]));
  }

  async function issue(){
    setBusy("issue");setError("");setNotice("");setNewKey("");
    try{
      const result=await request("POST",{action:"issue",product,customerId,expires_at:expiry?new Date(expiry).toISOString():null,max_installations:Number(maxInstallations),features:featuresObject()});
      const key=String(result.key||result.license?.license_key||result.license?.key||"");
      setNewKey(key);setNotice("Licence issued through License Manager.");
      await refresh();
    }catch(e:any){setError(e?.message||"Could not issue licence")}
    finally{setBusy("")}
  }

  async function control(row:Row,action:string){
    const id=idOf(row);if(!id)return;
    if((action==="terminate"||action==="rotate")&&!window.confirm(action==="terminate"?"Permanently terminate this licence and burn its current key?":"Rotate this licence key? The previous key will stop working."))return;
    setBusy(action+":"+id);setError("");setNotice("");setNewKey("");
    try{
      const result=await request("POST",{action,licenseId:id,reason:"Billing Store product licence management"});
      if(result.key)setNewKey(String(result.key));
      setNotice(result.message||(`Licence ${action} completed.`));
      await refresh();
    }catch(e:any){setError(e?.message||`Could not ${action} licence`)}
    finally{setBusy("")}
  }

  async function save(row:Row,form:HTMLFormElement){
    const id=idOf(row);const data=new FormData(form);
    const rawFeatures=String(data.get("features")||"");
    const features=Object.fromEntries([...new Set(rawFeatures.split(",").map(x=>x.trim().toLowerCase()).filter(Boolean))].map(x=>[x,true]));
    setBusy("save:"+id);setError("");setNotice("");
    try{
      await request("POST",{action:"update",licenseId:id,customer_external_id:String(data.get("customer_external_id")||"").trim()||null,external_reference:String(data.get("external_reference")||"").trim()||null,expires_at:String(data.get("expires_at")||"")?new Date(String(data.get("expires_at"))).toISOString():null,max_installations:Number(data.get("max_installations")),features});
      setNotice("Licence details updated in License Manager.");await refresh();
    }catch(e:any){setError(e?.message||"Could not update licence")}
    finally{setBusy("")}
  }

  return <main className="lmPage">
    <header className="orbitReferenceHero">
      <div><p className="eyebrow">BILLING STORE · CENTRAL LICENSING</p><h1>Product Licences</h1><p className="muted">Issue and manage licences for every registered License Manager product. License Manager remains the authority.</p></div>
      <button className="secondary" type="button" onClick={()=>void refresh()} disabled={busy==="load"}>{busy==="load"?"Refreshing…":"Refresh"}</button>
    </header>
    {error&&<div className="orbitReferenceNotice danger" role="alert">{error}</div>}
    {notice&&<div className="orbitReferenceNotice" role="status">{notice}</div>}
    {newKey&&<section className="orbitReferenceKeyBox"><div><b>New licence key</b><span>Shown once. Copy and securely deliver it to the customer.</span></div><code>{newKey}</code><button type="button" onClick={()=>void navigator.clipboard?.writeText(newKey)}>Copy key</button></section>}

    <section className="orbitReferenceSection">
      <div className="orbitReferenceSectionHead"><div><b>Issue a licence</b><small>Creates a licence for the selected registered product and links it to the Billing Store customer.</small></div></div>
      <div className="orbitReferenceActions" style={{flexWrap:"wrap",alignItems:"end"}}>
        <label>Product<select value={product} onChange={e=>setProduct(e.target.value)}>{products.map(p=><option key={p.id||p.slug} value={p.slug||p.product_code}>{p.group_name?`${p.group_name} · `:""}{p.name||p.slug||p.product_code}</option>)}</select></label>
        <label>Customer<select value={customerId} onChange={e=>setCustomerId(e.target.value)}><option value="">Select customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name||c.email||c.customer_number}</option>)}</select></label>
        <label>Expiry (optional)<input type="datetime-local" value={expiry} onChange={e=>setExpiry(e.target.value)}/></label>
        <label>Maximum installations<input type="number" min="1" max="1000" value={maxInstallations} onChange={e=>setMaxInstallations(e.target.value)}/></label>
        <label>Feature entitlements (comma separated)<input value={featureText} onChange={e=>setFeatureText(e.target.value)} placeholder="feature.one, feature.two"/></label>
        <button type="button" disabled={!!busy||!product||!customerId||!selectedCustomer} onClick={()=>void issue()}>{busy==="issue"?"Issuing…":"Issue licence"}</button>
      </div>
      {selectedCustomer&&<small className="muted">Customer reference: {selectedCustomer.customer_number||"Missing customer number"}</small>}
    </section>

    <section className="orbitReferenceSection">
      <div className="orbitReferenceSectionHead"><div><b>License Manager inventory</b><small>All registered product licences visible to the Billing Store integration.</small></div><span>{filtered.length} records</span></div>
      <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search product, customer reference, status, licence ID…"/>
      <div className="orbitReferenceLicenceList">
        {Object.entries(groupedLicenses).map(([groupName,groupRows])=><section key={groupName} className="orbitReferenceGroup"><div className="orbitReferenceSectionHead"><div><b>{groupName}</b><small>{groupRows.length} licences</small></div></div>{groupRows.map((row:Row)=>{
          const id=idOf(row);const status=statusOf(row);const policy=row.metadata?.license_policy||{};
          const expires=row.expires_at?new Date(row.expires_at).toISOString().slice(0,16):"";
          const featureNames=Object.entries(policy.features||row.features||{}).filter(([,v])=>Boolean(v)).map(([k])=>k).join(", ");
          return <details className="orbitReferenceLicenceCard" key={id}>
            <summary className="orbitReferenceLicenceTop"><div><h3>{row.product||row.product_code||"Product"}</h3><p>{id} · {row.license_key_last4?"••••-"+row.license_key_last4:"Key protected"} · {row.customer_external_id||"Unassigned customer"}</p></div><span className="orbitMiniState">{status}</span></summary>
            <div className="orbitReferenceLicenceBody">
              <form onSubmit={e=>{e.preventDefault();void save(row,e.currentTarget)}} className="orbitReferenceActions" style={{flexWrap:"wrap"}}>
                <label>Customer reference<input name="customer_external_id" defaultValue={row.customer_external_id||""}/></label>
                <label>Order/reference<input name="external_reference" defaultValue={row.external_reference||""}/></label>
                <label>Expiry<input name="expires_at" type="datetime-local" defaultValue={expires}/></label>
                <label>Max installations<input name="max_installations" type="number" min="1" max="1000" defaultValue={String(policy.max_installations||row.max_installations||1)}/></label>
                <label>Features (comma separated)<input name="features" defaultValue={featureNames}/></label>
                <button type="submit" disabled={!!busy}>{busy==="save:"+id?"Saving…":"Save changes"}</button>
              </form>
              <div className="orbitReferenceLicenceActions">
                {(status==="active"||status==="locked")&&<button className="secondary" disabled={!!busy} onClick={()=>void control(row,"suspend")}>Suspend</button>}
                {(status==="restricted"||status==="suspended")&&<button className="secondary" disabled={!!busy} onClick={()=>void control(row,"activate")}>Reactivate</button>}
                {(status==="active"||status==="locked")&&<button className="secondary" disabled={!!busy} onClick={()=>void control(row,"rotate")}>Rotate key</button>}
                {status!=="terminated"&&status!=="revoked"&&<button className="danger" disabled={!!busy} onClick={()=>void control(row,"terminate")}>Terminate</button>}
              </div>
            </div>
          </details>;
        })}</section>)}
        {!filtered.length&&<div className="orbitReferenceEmpty compact">No licences match this search.</div>}
      </div>
    </section>
  </main>;
}
