"use client";
import {useEffect,useState} from "react";
import {createClient} from "@/lib/supabase";
import {trackCustomerActivity} from "@/lib/customer-activity";

export default function Downloads(){
 const sb=createClient();
 const [ents,setEnts]=useState<any[]>([]),[artifacts,setArtifacts]=useState<any[]>([]),[downloading,setDownloading]=useState(""),[settings,setSettings]=useState<any>({enabled:true,requirePaid:true,showChecksums:true});

 async function downloadArtifact(a:any){
  if(a.download_url){
   trackCustomerActivity("download.started",{entityType:"artifact",entityId:a.id,detail:{label:a.label,version:a.version,platform:a.platform,source:"link"}});
   window.open(a.download_url,"_blank","noopener,noreferrer");return;
  }
  if(!a.storage_path)return;
  setDownloading(a.id);
  const {data,error}=await sb.storage.from("product-downloads").createSignedUrl(a.storage_path,300,{download:a.label||true});
  setDownloading("");
  if(error||!data?.signedUrl){alert(error?.message||"Could not prepare download.");return}
  trackCustomerActivity("download.started",{entityType:"artifact",entityId:a.id,detail:{label:a.label,version:a.version,platform:a.platform,source:"storage"}});
  location.href=data.signedUrl;
 }

 useEffect(()=>{(async()=>{
  const {data:{user}}=await sb.auth.getUser();if(!user){location.href="/login";return}
  const [{data:s},{data:e}]=await Promise.all([
   sb.from("app_settings").select("key,value").in("key",["downloads.enabled","downloads.require_paid_invoice","downloads.show_checksums"]),
   sb.from("download_entitlements").select("*").eq("auth_user_id",user.id).eq("status","active").order("granted_at",{ascending:false})
  ]);
  const cfg=Object.fromEntries((s||[]).map((x:any)=>[x.key,x.value]));
  const enabled=cfg["downloads.enabled"]!==false,requirePaid=cfg["downloads.require_paid_invoice"]!==false,showChecksums=cfg["downloads.show_checksums"]!==false;
  setSettings({enabled,requirePaid,showChecksums});
  let allowed=e||[];
  if(requirePaid){
   const orderIds=[...new Set(allowed.map((x:any)=>x.order_id).filter(Boolean))];
   if(orderIds.length){
    const {data:o}=await sb.from("orders").select("id,payment_status").in("id",orderIds);
    const paid=new Set((o||[]).filter((x:any)=>String(x.payment_status||"").toLowerCase().startsWith("paid")).map((x:any)=>x.id));
    allowed=allowed.filter((x:any)=>!x.order_id||paid.has(x.order_id));
   }
  }
  const pids=[...new Set(allowed.map((x:any)=>x.product_id).filter(Boolean))];
  let a:any[]=[];
  if(enabled&&pids.length){const {data}=await sb.from("product_artifacts").select("*").in("product_id",pids).eq("active",true).order("sort_order");a=data||[]}
  setEnts(allowed);setArtifacts(a);
 })()},[]);

 return <main className="portalPage downloadsPageV3">
  <header className="portalTop downloadsHead">
   <div><p className="eyebrow">DOWNLOADS</p><h1>Product downloads</h1><p className="muted">Files available through your paid OrbitFS entitlements.</p></div>
   <div className="downloadsSummary"><small>ACTIVE ENTITLEMENTS</small><strong>{ents.length}</strong></div>
  </header>

  {!settings.enabled?<section className="panel downloadsEmpty"><h2>Downloads temporarily unavailable</h2><p className="muted">Customer downloads have been disabled by OrbitFS administration. Your entitlements remain on your account.</p></section>:
   ents.length?<div className="downloadsEntitlementList">{ents.map(e=>{
    const files=artifacts.filter(a=>a.product_id===e.product_id);
    return <section className="panel downloadEntitlement" key={e.id}>
     <div className="downloadEntitlementHead"><div><p className="eyebrow">ENTITLEMENT</p><h2>{e.metadata?.license_product_key||"OrbitFS product"}</h2><span>Granted {new Date(e.granted_at).toLocaleString()}</span></div><span className="state ready">Active</span></div>
     <div className="downloadFiles">{files.length?files.map(a=><div className="downloadFileRow" key={a.id}>
      <div className="downloadFileIdentity"><b>{a.label}</b><span>{a.version||"Current"} · {a.platform} · {a.artifact_type}</span>{settings.showChecksums&&a.checksum_sha256&&<small>SHA-256 · {a.checksum_sha256}</small>}</div>
      <div className="downloadFileAction">{a.download_url||a.storage_path?<button disabled={downloading===a.id} onClick={()=>downloadArtifact(a)}>{downloading===a.id?"Preparing…":"Download"}</button>:<span className="muted">Not published</span>}</div>
     </div>):<div className="downloadsEmptyRow">No download file has been published for this entitlement yet.</div>}</div>
    </section>
   })}</div>:<section className="panel downloadsEmpty"><h2>No downloads yet</h2><p className="muted">Paid product downloads will appear here automatically when an entitlement is active.</p></section>}
 </main>;
}
