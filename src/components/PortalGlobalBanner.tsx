"use client";

import {useEffect,useMemo,useState} from "react";
import styles from "./PortalGlobalBanner.module.css";

export type PortalBannerConfig={
  enabled:boolean;
  level:"info"|"warning"|"alert";
  title:string;
  message:string;
  dismissible:boolean;
  revision:string;
};

export default function PortalGlobalBanner({config}:{config:PortalBannerConfig|null}){
  const [hidden,setHidden]=useState(false);
  const storageKey=useMemo(()=>config?.revision?"orbitfs_portal_banner_dismissed:"+config.revision:"",[config?.revision]);

  useEffect(()=>{
    if(!config?.enabled||!storageKey){setHidden(false);return}
    try{setHidden(localStorage.getItem(storageKey)==="1")}catch{setHidden(false)}
  },[config?.enabled,storageKey]);

  if(!config?.enabled||hidden||(!config.title.trim()&&!config.message.trim()))return null;

  function dismiss(){
    if(!config?.dismissible)return;
    if(!confirm("Dismiss this notice?"))return;
    try{if(storageKey)localStorage.setItem(storageKey,"1")}catch{}
    setHidden(true);
  }

  return <section className={styles.banner+" "+styles[config.level]} role={config.level==="alert"?"alert":"status"} aria-live={config.level==="alert"?"assertive":"polite"}>
    <div className={styles.icon} aria-hidden="true">{config.level==="info"?"i":config.level==="warning"?"!":"×"}</div>
    <div className={styles.copy}>
      {config.title.trim()&&<strong>{config.title}</strong>}
      {config.message.trim()&&<span>{config.message}</span>}
    </div>
    {config.dismissible&&<button type="button" onClick={dismiss}>Dismiss</button>}
  </section>;
}
