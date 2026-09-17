"use client";
import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";
import "./licensing.css";

export default function LicensingAdmin(){
 const sb=useMemo(()=>createClient(),[]),[data,setData]=useState<any>(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
 async function load(){
  setLoading(true);setError("");
  try{
   const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)throw Error("Administrator session expired.");
   const h={Authorization:`Bearer ${session.access_token}`};
   const [health,products]=await Promise.all([
    fetch(`/api/admin/license-master?path=${encodeURIComponent("/api/health")}`,{headers:h,cache:"no-store"}),
    fetch(`/api/admin/license-master?path=${encodeURIComponent("/api/products")}`,{headers:h,cache:"no-store"})
   ]);
   const hj=await health.json().catch(()=>({})),pj=await products.json().catch(()=>({}));
   if(!health.ok)throw Error(hj.error||`License Master health failed (${health.status})`);
   if(!products.ok)throw Error(pj.error||`License Master products failed (${products.status})`);
   setData({health:hj,products:Array.isArray(pj.products)?pj.products:[]});
  }catch(e:any){setError(String(e?.message||"License Master unavailable"));}finally{setLoading(false)}
 }
 useEffect(()=>{void load()},[]);
 const products=data?.products||[];
 return <main className="lmPage"><div className="lmHero"><div><div className="lmEyebrow">MY ORBITFS · STANDALONE AUTHORITY</div><h1>License Master</h1><p>License Master is the standalone licensing, release and deployment authority. Billing Store only connects to it through the authenticated API.</p></div><div className="lmHeroActions"><a href="https://panel.incendiarynetworks.cc" target="_blank" rel="noreferrer">Open Master Panel</a><Link href="/admin/license-controller">License Controller</Link><Link href="/admin/settings/license-master">Product Connections</Link><button onClick={()=>void load()} disabled={loading}>{loading?"Checking…":"Refresh"}</button></div></div>{loading?<div className="lmCard lmLoading">Checking License Master…</div>:error?<div className="lmCard"><b>License Master unavailable</b><p>{error}</p><p>Billing Store does not create replacement licensing state.</p></div>:<><section className="lmCard"><header><div><div className="lmKicker">AUTHORITY</div><h2>Connection</h2></div><span className="state ready">Online</span></header><div className="lmKV"><div><span>Authority</span><b>orbitfs-license-master-v2</b></div><div><span>API</span><b>https://incendiarynetworks.cc/api</b></div><div><span>Health</span><b>OK</b></div><div><span>Products</span><b>{products.length}</b></div></div></section><section className="lmCard" style={{marginTop:14}}><div className="lmKicker">CANONICAL CATALOGUE</div><h2>Connected OrbitFS products</h2><div className="lmRuntimeList">{products.map((p:any)=><div key={p.id||p.code||p.slug}><b>{p.code||p.slug}</b><span>{p.name||"Unnamed product"}</span></div>)}{!products.length&&<div><b>No products returned</b><span>Register the OrbitFS products in License Master before using Billing checkout or licensing.</span></div>}</div></section></>}</main>;
}
