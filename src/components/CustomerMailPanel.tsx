"use client";

import {useEffect,useState} from "react";
import {createClient} from "@/lib/supabase";

type Template={template_key:string;display_name:string;subject:string;variables:string[]};
const SERVER_VARIABLES=new Set(["customer_name","customer_email","customer_number","first_name","last_name","company_name","site_url","currency","country_code","phone"]);

export default function CustomerMailPanel({customerId}:{customerId:string}){
  const sb=createClient();
  const [templates,setTemplates]=useState<Template[]>([]);
  const [selected,setSelected]=useState("");
  const [values,setValues]=useState<Record<string,string>>({});
  const [enabled,setEnabled]=useState(false);
  const [email,setEmail]=useState("");
  const [message,setMessage]=useState("");
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);

  async function authHeaders(){
    const {data:{session}}=await sb.auth.getSession();
    if(!session?.access_token)throw new Error("Administrator session expired. Sign in again.");
    return {authorization:`Bearer ${session.access_token}`};
  }
  async function load(){
    setLoading(true);setMessage("");
    try{
      const response=await fetch(`/api/admin/customers/${customerId}/mail`,{headers:await authHeaders(),cache:"no-store"});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"Could not load customer email options.");
      setTemplates(data.templates||[]);setEnabled(!!data.enabled);setEmail(data.email||"");
      setSelected((data.templates||[])[0]?.template_key||"");
    }catch(error){setMessage(error instanceof Error?error.message:"Could not load customer email options.");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load()},[customerId]);

  const template=templates.find(item=>item.template_key===selected);
  const editableVariables=(template?.variables||[]).filter(key=>!SERVER_VARIABLES.has(key));

  async function send(){
    if(!selected)return;
    setBusy(true);setMessage("");
    try{
      const response=await fetch(`/api/admin/customers/${customerId}/mail`,{
        method:"POST",
        headers:{"content-type":"application/json",...await authHeaders()},
        body:JSON.stringify({templateKey:selected,variables:values})
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"Email could not be sent.");
      setMessage(data.message||"Email sent through Mail System.");
      setValues({});
    }catch(error){setMessage(error instanceof Error?error.message:"Email could not be sent.");}
    finally{setBusy(false);}
  }

  if(loading)return <section className="panel"><h2>Customer email</h2><p className="muted">Loading email options…</p></section>;
  return <section className="panel">
    <div className="panelTitle"><div><p className="eyebrow">CUSTOMER COMMUNICATION</p><h2>Send email</h2><p className="muted">Uses the Billing mail configuration and the customer's verified Billing email address.</p></div></div>
    {!enabled?<div className="notice"><b>Mail module disabled</b><span>Enable and configure Outbound Mail before sending customer messages.</span></div>:
      <>
        <p className="muted">Recipient: <strong>{email||"No customer email address"}</strong></p>
        {!templates.length?<p className="muted">No active email templates are available.</p>:
          <>
            <label className="form"><span>Email template</span><select value={selected} onChange={e=>{setSelected(e.target.value);setValues({})}}>{templates.map(item=><option key={item.template_key} value={item.template_key}>{item.display_name}</option>)}</select></label>
            {template&&<div className="form">
              <p className="muted">Subject preview: {template.subject||"Uses template variables"}</p>
              {editableVariables.map(key=><label key={key}><span>{key.replace(/_/g," ")}</span><input value={values[key]||""} onChange={e=>setValues(current=>({...current,[key]:e.target.value}))} maxLength={2000}/></label>)}
              <p className="muted">Customer identity fields are resolved from Billing and cannot be overridden here.</p>
              <button type="button" onClick={()=>void send()} disabled={busy||!email}>{busy?"Sending…":"Send email"}</button>
            </div>}
          </>
        }
      </>
    }
    {message&&<p role="status" className="muted">{message}</p>}
  </section>;
}
