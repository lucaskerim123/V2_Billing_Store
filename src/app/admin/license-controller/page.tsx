"use client";
import {useEffect,useState} from "react";
import {getClientAccessToken} from "@/lib/license-api";

type LicenseRow=Record<string,any>;

export default function LicenseControllerPage(){
  const [licenses,setLicenses]=useState<LicenseRow[]>([]);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    let cancelled=false;
    async function load(){
      try{
        const token=await getClientAccessToken();
        const response=await fetch("/api/admin/license-master?path=/api/licenses",{headers:token?{authorization:`Bearer ${token}`}:undefined,cache:"no-store"});
        const data=await response.json().catch(()=>({}));
        if(!response.ok) throw new Error(data?.error||`License Master request failed (${response.status})`);
        const rows=Array.isArray(data?.licenses)?data.licenses:Array.isArray(data)?data:[];
        if(!cancelled)setLicenses(rows);
      }catch(e){
        if(!cancelled)setError(e instanceof Error?e.message:"Failed to load licences");
      }finally{
        if(!cancelled)setLoading(false);
      }
    }
    load();
    return()=>{cancelled=true;};
  },[]);

  return <main style={{padding:24,maxWidth:1200,margin:"0 auto"}}>
    <h1>License Controller</h1>
    {loading&&<p>Loading licences…</p>}
    {error&&<p role="alert">{error}</p>}
    {!loading&&!error&&<div>
      <p>{licenses.length} licence{licenses.length===1?"":"s"} available.</p>
      <pre style={{whiteSpace:"pre-wrap",overflowX:"auto"}}>{JSON.stringify(licenses,null,2)}</pre>
    </div>}
  </main>;
}
