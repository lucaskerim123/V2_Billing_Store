"use client";
import {useEffect} from "react";
import {usePathname} from "next/navigation";
import {createClient} from "@/lib/supabase";

export default function LicenseProvisioningWatcher(){
  const pathname=usePathname();
  useEffect(()=>{
    const match=pathname?.match(/^\/admin\/orders\/([^/]+)$/);
    const orderId=match?.[1];
    if(!orderId)return;
    const sb=createClient();
    let stopped=false;
    let attempts=0;
    const run=async()=>{
      if(stopped||attempts>=12)return;
      attempts++;
      try{
        const {data:{session}}=await sb.auth.getSession();
        if(!session?.access_token)return;
        const response=await fetch("/api/admin/license-master/fulfill",{method:"POST",headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({orderId}),cache:"no-store"});
        if(response.ok){
          const result=await response.json().catch(()=>null);
          if(result?.ok===true||result?.fulfillmentStatus==="fulfilled"||result?.failed===0)stopped=true;
        }
      }catch{}
    };
    void run();
    const timer=setInterval(()=>void run(),5000);
    return()=>{stopped=true;clearInterval(timer)};
  },[pathname]);
  return null;
}
