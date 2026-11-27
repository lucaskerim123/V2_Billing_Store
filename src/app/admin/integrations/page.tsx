"use client";

import Link from "next/link";
import {useCallback,useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

type IntegrationRow={
  id:string;name:string;description:string;version:string;route:string;installable:boolean;
  requiredEnvironment:string[];features:string[];
  state:{installed:boolean;enabled:boolean;version:string;updated_at:string|null};
  configured:boolean;connectionConfigured?:boolean;
};

export default function IntegrationManagerPage(){
  const sb=useMemo(()=>createClient(),[]);
  const [rows,setRows]=useState<IntegrationRow[]>([]);
  const [canManage,setCanManage]=useState(false);
  const [counts,setCounts]=useState({installed:0,installable:0});
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");

  const headers=useCallback(async()=>{
    const {data:{session}}=await sb.auth.getSession();
    if(!session?.access_token)throw new Error("Administrator session expired.");
    return {authorization:`Bearer ${session.access_token}`,"content-type":"application/json"};
  },[sb]);

  const load=useCallback(async()=>{
    setLoading(true);setMessage("");
    try{
      const response=await fetch("/api/admin/integrations",{headers:await headers(),cache:"no-store"});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Could not load Integration Manager.");
      setRows(data.integrations||[]);
      setCounts({installed:Number(data.summary?.installedCount||0),installable:Number(data.summary?.installableCount||0)});
      setCanManage(data.permissions?.canManage===true);
    }catch(error:any){setMessage(error?.message||"Could not load Integration Manager.");}
    finally{setLoading(false);}
  },[headers]);

  useEffect(()=>{void load()},[load]);

  async function change(id:string,action:string){
    setBusy(id);setMessage("");
    try{
      const response=await fetch("/api/admin/integrations",{method:"PATCH",headers:await headers(),body:JSON.stringify({integration_id:id,action})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Integration update failed.");
      await load();
      setMessage(action==="uninstall"?"Integration uninstalled. Its registration, configuration and integration-owned data were removed.":`Integration ${action} completed.`);
    }catch(error:any){setMessage(error?.message||"Integration update failed.");}
    finally{setBusy("")}
  }

  return <main style={{maxWidth:1120,margin:"0 auto",padding:"24px 18px 48px",color:"var(--admin-text,inherit)"}}>
    <header style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:16,flexWrap:"wrap",marginBottom:22}}>
      <div><p style={{fontSize:12,letterSpacing:1.2,opacity:.65,margin:0}}>SYSTEM / EXTENSIONS</p><h1 style={{margin:"6px 0"}}>Integration Manager</h1><p style={{margin:0,opacity:.75}}>Manage separately registered integrations installed in Billing Store.</p></div>
      <span style={{fontSize:12,opacity:.7}}>Installed: {counts.installed} · Installable: {counts.installable}</span>
    </header>
    {message&&<p role="status" style={{padding:12,border:"1px solid var(--admin-border,#d5dbe5)",borderRadius:8}}>{message}</p>}
    {loading?<p>Loading registered integrations…</p>:rows.length===0?<p>No modules installed or installable. The integration installation folder is empty and ready for a module package.</p>:rows.map(item=><section key={item.id} style={{border:"1px solid var(--admin-border,#d5dbe5)",borderRadius:12,padding:18,marginBottom:14,background:"var(--admin-surface,transparent)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:18,flexWrap:"wrap"}}>
        <div style={{minWidth:220,flex:"1 1 400px"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <h2 style={{fontSize:19,margin:0}}>{item.name}</h2>
            <span style={{fontSize:12,padding:"3px 8px",borderRadius:20,border:"1px solid var(--admin-border,#d5dbe5)"}}>{item.state.installed?(item.state.enabled?"Enabled":"Installed · Disabled"):"Not installed"}</span>
            <span style={{fontSize:12,opacity:.65}}>v{item.state.version||item.version}</span>
          </div>
          <p style={{margin:"8px 0",opacity:.8}}>{item.description}</p>
          <p style={{fontSize:13,margin:"8px 0"}}>{item.id==="mailsystem"?"Connection: "+(item.connectionConfigured?"Configured":"Set up after enabling"):"Server credentials: "+(item.configured?"Configured":"Missing")}</p>
          <p style={{fontSize:12,opacity:.65,margin:"10px 0 0"}}>Features: {item.features.join(" · ")}</p>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          {item.state.installed&&item.route&&<Link href={item.route} style={{padding:"8px 12px",border:"1px solid var(--admin-border,#d5dbe5)",borderRadius:8,textDecoration:"none"}}>Configure</Link>}
          {canManage&&!item.state.installed&&<button disabled={!!busy} onClick={()=>void change(item.id,"install")}>Install</button>}
          {canManage&&item.state.installed&&!item.state.enabled&&<button disabled={!!busy||!item.configured} title={!item.configured?"Required server environment variables are missing.":undefined} onClick={()=>void change(item.id,"enable")}>Enable</button>}
          {canManage&&item.state.enabled&&<button disabled={!!busy} onClick={()=>void change(item.id,"disable")}>Disable</button>}
          {canManage&&item.state.installed&&<button disabled={!!busy} onClick={()=>{if(window.confirm("Uninstall this integration? Its registration, configuration and all data stored in the integration data store will be permanently deleted."))void change(item.id,"uninstall")}}>Uninstall</button>}
        </div>
      </div>
    </section>)}
    {!canManage&&!loading&&<p style={{fontSize:13,opacity:.7}}>You have view access. Integration changes require the integrations.manage permission.</p>}
    <p style={{fontSize:12,opacity:.65,marginTop:20}}>Billing Store owns business events independently of installed modules. Modules may configure how those events are handled, but cannot define or remove Billing events.</p>
  </main>;
}
