"use client";
import {useEffect,useState} from "react";
import {usePathname} from "next/navigation";
import {createClient} from "@/lib/supabase";
import styles from "./AdminGuestSupportContext.module.css";
export default function AdminGuestSupportContext(){
 const path=usePathname(),[sb]=useState(()=>createClient()),[guest,setGuest]=useState<any>(null);
 useEffect(()=>{
  const match=path.match(/^\/admin\/support\/([0-9a-f-]{36})$/i);
  if(!match){setGuest(null);return}
  let active=true;
  sb.from("support_tickets").select("user_id,metadata").eq("id",match[1]).maybeSingle().then(({data})=>{
   if(!active)return;
   if(data&&!data.user_id&&data.metadata?.guest)setGuest({name:data.metadata.contact_name||"Guest",email:data.metadata.contact_email||"Email unavailable"});
   else setGuest(null);
  });
  return()=>{active=false};
 },[path,sb]);
 if(!guest)return null;
 return <div className={styles.banner}><b>Guest support request</b><span>{guest.name} · {guest.email}</span><small>No OrbitFS account is attached. Staff replies are emailed to this address.</small></div>;
}
