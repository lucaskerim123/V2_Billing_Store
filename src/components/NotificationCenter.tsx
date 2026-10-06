"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import type {CSSProperties} from "react";
import {usePathname,useRouter} from "next/navigation"
import {createPortal} from "react-dom";
import {createClient} from "@/lib/supabase";
import styles from "./NotificationCenter.module.css";

type Surface="admin"|"portal";
type Severity="info"|"success"|"warning"|"error";
type AlertKind="notification"|"message"|"alert"|"announcement"|"maintenance";
type NotificationRow={
  id:string;
  category:string;
  event_type:string;
  title:string;
  message:string;
  severity:Severity;
  action_url?:string|null;
  metadata?:Record<string,any>|null;
  read_at?:string|null;
  created_at:string;
};

type ClientSettings={enabled:boolean;realtime_enabled:boolean;feed_limit:number};

const kindLabels:Record<AlertKind,string>={notification:"Notification",message:"Message",alert:"Alert",announcement:"Announcement",maintenance:"Maintenance"};
const kindMarks:Record<AlertKind,string>={notification:"i",message:"✉",alert:"!",announcement:"A",maintenance:"⚙"};
const severityLabels:Record<Severity,string>={info:"Info",success:"Success",warning:"Warning",error:"Critical"};

function BellIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a5 5 0 0 0-5 5v2.7c0 .8-.24 1.57-.69 2.23L5 14.85V17h14v-2.15l-1.31-1.92A4 4 0 0 1 17 10.7V8a5 5 0 0 0-5-5Zm-2.2 16a2.35 2.35 0 0 0 4.4 0H9.8Z" fill="currentColor"/></svg>}
function prettyTime(value:string){try{return new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(value))}catch{return value}}
function notificationKind(n:NotificationRow):AlertKind{
  const raw=typeof n.metadata?.kind==="string"?String(n.metadata.kind).toLowerCase():"";
  if(raw==="notification"||raw==="message"||raw==="alert"||raw==="announcement"||raw==="maintenance")return raw;
  const category=String(n.category||"").toLowerCase();
  if(category.includes("maintenance"))return "maintenance";
  if(category.includes("announcement"))return "announcement";
  if(category.includes("alert"))return "alert";
  if(category.includes("message"))return "message";
  return "notification";
}

export default function NotificationCenter({surface,compact=false}:{surface:Surface;compact?:boolean}){
  const router=useRouter();
  const pathname=usePathname();
  const rootRef=useRef<HTMLDivElement|null>(null);
  const panelRef=useRef<HTMLElement|null>(null);
  const [mounted,setMounted]=useState(false);
  useEffect(()=>{setMounted(true)},[]);
  const [sb]=useState(()=>createClient());
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(true);
  const [items,setItems]=useState<NotificationRow[]>([]);
  const [unread,setUnread]=useState(0);
  const [error,setError]=useState("");
  const [canSend,setCanSend]=useState(false);
  const [configReady,setConfigReady]=useState(false);
  const [systemEnabled,setSystemEnabled]=useState(true);
  const [feedLimit,setFeedLimit]=useState(40);
  const [userId,setUserId]=useState("");
  const [realtimeEnabled,setRealtimeEnabled]=useState(true);
  const [panelStyle,setPanelStyle]=useState<CSSProperties>({});

  const load=useCallback(async(limit=40)=>{
    const {data,error:e}=await sb.rpc("notification_feed",{p_surface:surface,p_limit:limit});
    if(e){setError(e.message);setLoading(false);return}
    setItems((data?.notifications||[]) as NotificationRow[]);
    setUnread(Number(data?.unread_count||0));
    setError("");
    setLoading(false);
  },[sb,surface]);

  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      const {data:{user}}=await sb.auth.getUser();
      if(!user||cancelled){setConfigReady(true);return}
      setUserId(user.id);

      const settingsResult=await sb.rpc("orbitfs_alert_client_settings");
      const cfg:ClientSettings=settingsResult.error?{enabled:true,realtime_enabled:true,feed_limit:40}:settingsResult.data as ClientSettings;
      const limit=Math.max(10,Math.min(100,Number(cfg?.feed_limit||40)));
      setSystemEnabled(cfg?.enabled!==false);
      setRealtimeEnabled(cfg?.realtime_enabled!==false);
      setFeedLimit(limit);

      if(surface==="admin"){
        const {data:access}=await sb.rpc("get_my_staff_access");
        const accessRow:any=Array.isArray(access)?access[0]:access;
        const p:any=accessRow?.permissions||{};
        setCanSend(p?.all===true||(Array.isArray(p)?p.includes("notifications.send"):Boolean(p?.["notifications.send"])));
      }

      if(cfg?.enabled===false){setLoading(false);setConfigReady(true);return}
      await load(limit);
      if(cancelled)return;
      setConfigReady(true);

    })();
    return()=>{cancelled=true};
  },[sb,surface,load]);

  useEffect(()=>{setOpen(false)},[pathname]);

  useEffect(()=>{
    if(!configReady||!systemEnabled||!realtimeEnabled||!userId)return;
    let refreshTimer:ReturnType<typeof setTimeout>|undefined;
    const refresh=()=>{
      if(refreshTimer)clearTimeout(refreshTimer);
      refreshTimer=setTimeout(()=>{void load(feedLimit)},120);
    };
    const channel=sb.channel(`orbitfs-notifications-${surface}-${userId}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"notifications",filter:`recipient_user_id=eq.${userId}`},payload=>{
        const row=(payload.new&&Object.keys(payload.new).length?payload.new:payload.old) as Record<string,any>;
        if(!row?.surface||row.surface===surface)refresh();
      })
      .subscribe();
    const onFocus=()=>void load(feedLimit);
    window.addEventListener("focus",onFocus);
    return()=>{
      if(refreshTimer)clearTimeout(refreshTimer);
      window.removeEventListener("focus",onFocus);
      void sb.removeChannel(channel);
    };
  },[sb,surface,userId,configReady,systemEnabled,realtimeEnabled,feedLimit,load]);

  useEffect(()=>{
    if(!open||!mounted)return;
    const syncPanelToVisualViewport=()=>{
      const viewport=window.visualViewport;
      const width=Math.max(0,viewport?.width??window.innerWidth);
      const height=Math.max(0,viewport?.height??window.innerHeight);
      const offsetLeft=viewport?.offsetLeft??0;
      const offsetTop=viewport?.offsetTop??0;
      const mobile=width<=760;
      const panelWidth=mobile?Math.max(0,width-12):Math.min(460,Math.max(320,width-20));
      const panelHeight=mobile?Math.min(620,Math.max(260,Math.floor(height*.76))):Math.min(720,Math.max(260,height-70));
      const left=mobile?offsetLeft+6:offsetLeft+Math.max(10,width-panelWidth-10);
      const top=mobile?offsetTop+Math.max(6,height-panelHeight-6):offsetTop+58;
      setPanelStyle({position:"fixed",top:Math.round(top),left:Math.round(left),right:"auto",bottom:"auto",width:Math.round(panelWidth),height:mobile?Math.round(panelHeight):undefined,maxHeight:Math.round(panelHeight)});
    };
    syncPanelToVisualViewport();
    const viewport=window.visualViewport;
    viewport?.addEventListener("resize",syncPanelToVisualViewport);
    viewport?.addEventListener("scroll",syncPanelToVisualViewport);
    window.addEventListener("resize",syncPanelToVisualViewport);
    window.addEventListener("scroll",syncPanelToVisualViewport,true);
    return()=>{
      viewport?.removeEventListener("resize",syncPanelToVisualViewport);
      viewport?.removeEventListener("scroll",syncPanelToVisualViewport);
      window.removeEventListener("resize",syncPanelToVisualViewport);
      window.removeEventListener("scroll",syncPanelToVisualViewport,true);
    };
  },[open,mounted]);

  useEffect(()=>{
    if(!open)return;
    const close=(e:PointerEvent)=>{if(!rootRef.current?.contains(e.target as Node)&&!panelRef.current?.contains(e.target as Node))setOpen(false)};
    document.addEventListener("pointerdown",close);
    return()=>document.removeEventListener("pointerdown",close);
  },[open]);

  async function openNotification(n:NotificationRow){
    if(!n.read_at){
      setItems(v=>v.map(x=>x.id===n.id?{...x,read_at:new Date().toISOString()}:x));
      setUnread(v=>Math.max(0,v-1));
      const {error:markError}=await sb.rpc("notification_mark_read",{p_notification_id:n.id,p_read:true});
      if(markError){setError(markError.message);void load(feedLimit);return;}
    }
    setOpen(false);
    if(n.action_url)router.push(n.action_url);
  }

  async function markAllRead(){
    if(unread===0)return;
    const now=new Date().toISOString();
    setItems(v=>v.map(x=>x.read_at?x:{...x,read_at:now}));
    setUnread(0);
    const {error:e}=await sb.rpc("notification_mark_all_read",{p_surface:surface});
    if(e){setError(e.message);void load(feedLimit)}
  }

  if(!configReady||!systemEnabled)return null;

  return <div ref={rootRef} className={styles.root} data-surface={surface} data-compact={compact?"true":"false"}>
    <button className={styles.trigger} type="button" aria-label={`Open ${surface} notifications`} aria-expanded={open} onPointerDown={event=>event.stopPropagation()} onClick={()=>setOpen(current=>{const next=!current;if(next)void load(feedLimit);return next})}>
      <span className={styles.icon}><BellIcon/></span>
      <span className={styles.triggerText}>Notifications</span>
      {unread>0&&<span className={styles.badge}>{unread>99?"99+":unread}</span>}
    </button>
    {open&&mounted&&createPortal(<section ref={panelRef} data-surface={surface} className={styles.panel} style={panelStyle} aria-label={surface==="admin"?"Admin notifications":"Customer notifications"}>
      <header className={styles.header}>
        <div><small>{surface==="admin"?"ORBITFS ALERT SYSTEM":"CUSTOMER PORTAL"}</small><h2>Notifications</h2></div>
        <div className={styles.headerActions}>
          {surface==="admin"&&canSend&&<button className={styles.headerButton} type="button" onClick={()=>{setOpen(false);router.push("/admin/alerts")}}>Alert System</button>}
          <button className={styles.headerButton} type="button" onClick={()=>void load(feedLimit)}>Refresh</button>
          <button className={styles.markAll} type="button" onClick={markAllRead} disabled={unread===0}>Mark all read</button>
        </div>
      </header>
      <div className={styles.list}>
        {loading&&<p className={styles.empty}>Loading notifications…</p>}
        {!loading&&error&&<div className={styles.error}><b>Notifications unavailable</b><span>{error}</span><button type="button" onClick={()=>void load(feedLimit)}>Retry</button></div>}
        {!loading&&!error&&items.length===0&&<p className={styles.empty}>No notifications yet.</p>}
        {!loading&&!error&&items.map(n=>{
          const kind=notificationKind(n);
          const criticalAlert=kind==="alert"&&n.severity==="error";
          return <button key={n.id} type="button" className={`${styles.item} ${!n.read_at?styles.unread:""} ${criticalAlert?styles.criticalAlert:""}`} data-kind={kind} data-severity={n.severity} onClick={()=>void openNotification(n)}>
            <span className={styles.typeMark} aria-hidden="true">{kindMarks[kind]}</span>
            <span className={styles.copy}>
              <span className={styles.labels}><span className={styles.kindLabel}>{kindLabels[kind]}</span><span className={styles.severityLabel}>{severityLabels[n.severity]}</span>{criticalAlert&&<span className={styles.criticalLabel}>Requires attention</span>}</span>
              <span className={styles.itemTop}><b>{n.title}</b><small>{prettyTime(n.created_at)}</small></span>
              {n.message&&<span className={styles.message}>{n.message}</span>}
              {n.action_url&&<span className={styles.openHint}>Open details →</span>}
            </span>
          </button>;
        })}
      </div>
    </section>,document.body)}
  </div>;
}
