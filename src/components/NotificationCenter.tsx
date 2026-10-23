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
  acknowledged_at?:string|null;
  saved_at?:string|null;
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
  const [expanded,setExpanded]=useState<NotificationRow|null>(null);
  const [deleting,setDeleting]=useState<string|null>(null);
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
  const [interruptPrefs,setInterruptPrefs]=useState({do_not_disturb:false,quiet_start:"",quiet_end:"",muted_categories:[] as string[],allow_critical_override:true});
  const [clock,setClock]=useState(()=>Date.now());
  useEffect(()=>{if(!userId)return;const refresh=async()=>{const {data}=await sb.from("notification_preferences").select("do_not_disturb,quiet_start,quiet_end,muted_categories,allow_critical_override").eq("user_id",userId).eq("surface",surface).maybeSingle();if(data)setInterruptPrefs({do_not_disturb:!!data.do_not_disturb,quiet_start:String(data.quiet_start||"").slice(0,5),quiet_end:String(data.quiet_end||"").slice(0,5),muted_categories:Array.isArray(data.muted_categories)?data.muted_categories:[],allow_critical_override:data.allow_critical_override!==false});else setInterruptPrefs({do_not_disturb:false,quiet_start:"",quiet_end:"",muted_categories:[],allow_critical_override:true})};window.addEventListener("orbitfs-notification-preferences-updated",refresh);return()=>window.removeEventListener("orbitfs-notification-preferences-updated",refresh)},[sb,userId,surface]);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),60000);return()=>clearInterval(timer)},[]);

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
      const {data:preferences}=await sb.from("notification_preferences").select("do_not_disturb,quiet_start,quiet_end,muted_categories,allow_critical_override").eq("user_id",user.id).eq("surface",surface).maybeSingle();
      if(preferences)setInterruptPrefs({do_not_disturb:!!preferences.do_not_disturb,quiet_start:String(preferences.quiet_start||"").slice(0,5),quiet_end:String(preferences.quiet_end||"").slice(0,5),muted_categories:Array.isArray(preferences.muted_categories)?preferences.muted_categories:[],allow_critical_override:preferences.allow_critical_override!==false});

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
  useEffect(()=>{if(!open)return;const onEscape=(event:KeyboardEvent)=>{if(event.key==="Escape"){setExpanded(null);setOpen(false)}};document.addEventListener("keydown",onEscape);return()=>document.removeEventListener("keydown",onEscape)},[open]);

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
        if(!row?.surface||row.surface===surface){refresh();window.dispatchEvent(new Event("orbitfs-notifications-changed"))}
      })
      .subscribe();
    return()=>{
      if(refreshTimer)clearTimeout(refreshTimer);
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
      const anchor=rootRef.current?.getBoundingClientRect();
      const panelWidth=Math.min(mobile?340:370,Math.max(220,width-16));
      const panelHeight=Math.min(420,Math.max(200,height-90));
      const left=Math.max(offsetLeft+8,Math.min((anchor?.right??width)-panelWidth,offsetLeft+width-panelWidth-8));
      const below=(anchor?.bottom??50)+7;
      const top=below+panelHeight<=offsetTop+height-8?below:Math.max(offsetTop+8,(anchor?.top??50)-panelHeight-7);
      setPanelStyle({position:"fixed",top:Math.round(top),left:Math.round(left),right:"auto",bottom:"auto",width:Math.round(panelWidth),height:Math.round(panelHeight),maxHeight:Math.round(panelHeight),zIndex:100000});
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
  },[open,mounted,surface]);

  useEffect(()=>{
    if(!open)return;
    const close=(e:PointerEvent)=>{if(!rootRef.current?.contains(e.target as Node)&&!panelRef.current?.contains(e.target as Node))setOpen(false)};
    document.addEventListener("pointerdown",close);
    return()=>document.removeEventListener("pointerdown",close);
  },[open,surface]);

  function closePanel(){
    setOpen(false);
    setExpanded(null);
  }

  function togglePortalPanel(){
    void load(feedLimit);
    setOpen(current=>!current);
  }

  async function openNotification(n:NotificationRow){
    if(!n.read_at){
      setItems(v=>v.map(x=>x.id===n.id?{...x,read_at:new Date().toISOString()}:x));
      setUnread(v=>Math.max(0,v-1));
      const {error:markError}=await sb.rpc("notification_mark_read",{p_notification_id:n.id,p_read:true});
      if(markError){setError(markError.message);void load(feedLimit);return;}
    }
    closePanel();
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

  async function acknowledgeNotification(n:NotificationRow){
    if(n.acknowledged_at)return;
    const now=new Date().toISOString();
    const wasUnread=!n.read_at;
    setItems(v=>v.map(x=>x.id===n.id?{...x,read_at:x.read_at||now,acknowledged_at:now}:x));
    if(wasUnread)setUnread(v=>Math.max(0,v-1));
    const {error:e}=await sb.rpc("notification_acknowledge",{p_notification_id:n.id,p_acknowledged:true});
    if(e){setError(e.message);void load(feedLimit)}
  }

  async function deleteNotification(n:NotificationRow){
    if(deleting)return;
    setDeleting(n.id);
    const {error:deleteError}=await sb.rpc("notification_delete",{p_notification_id:n.id});
    setDeleting(null);
    if(deleteError){setError(deleteError.message);return}
    setItems(current=>current.filter(item=>item.id!==n.id));
    if(!n.read_at)setUnread(current=>Math.max(0,current-1));
    if(expanded?.id===n.id)setExpanded(null);
  }

  async function toggleSaved(n:NotificationRow){
    const next=!n.saved_at;
    const now=new Date().toISOString();
    setItems(v=>v.map(x=>x.id===n.id?{...x,saved_at:next?now:null}:x));
    const {error:e}=await sb.rpc("notification_set_saved",{p_notification_id:n.id,p_saved:next});
    if(e){setError(e.message);void load(feedLimit)}
  }


  const currentTime=new Date(clock);
  const nowMinute=currentTime.getHours()*60+currentTime.getMinutes();
  const asMinute=(value:string)=>{const [h,m]=value.split(":").map(Number);return Number.isFinite(h)&&Number.isFinite(m)?h*60+m:-1};
  const quietStart=asMinute(interruptPrefs.quiet_start),quietEnd=asMinute(interruptPrefs.quiet_end);
  const withinQuietHours=quietStart>=0&&quietEnd>=0&&quietStart!==quietEnd&&(quietStart<quietEnd?nowMinute>=quietStart&&nowMinute<quietEnd:nowMinute>=quietStart||nowMinute<quietEnd);
  const interruptionsMuted=interruptPrefs.do_not_disturb||withinQuietHours;
  const directBanners=items.filter(n=>n.metadata?.manual===true&&(notificationKind(n)==="alert"||notificationKind(n)==="announcement")&&!n.acknowledged_at&&(!(interruptionsMuted||interruptPrefs.muted_categories.includes(n.category))||n.metadata?.override_dnd===true||(n.severity==="error"&&interruptPrefs.allow_critical_override))).slice(0,3);

  if(!configReady||!systemEnabled)return null;

  return <div ref={rootRef} className={styles.root} data-surface={surface} data-compact={compact?"true":"false"}>
    <button className={styles.trigger} type="button" aria-label={`Open ${surface} notifications`} aria-expanded={open} aria-haspopup={surface==="admin"?"dialog":undefined} aria-controls={surface==="admin"?"admin-notification-popover":undefined} onClick={togglePortalPanel}>
      <span className={styles.icon}><BellIcon/></span>
      <span className={styles.triggerText}>Notifications</span>
      {unread>0&&<span className={styles.badge}>{unread>99?"99+":unread}</span>}
    </button>
    {mounted&&directBanners.length>0&&createPortal(<aside aria-label="Important OrbitFS messages" style={{position:"fixed",top:surface==="admin"?86:78,right:16,zIndex:99990,width:"min(420px,calc(100vw - 32px))",display:"grid",gap:8,pointerEvents:"none"}}>{directBanners.map(n=>{const bannerSeverity=n.severity==="error"?"error":n.severity==="warning"?"warning":n.severity==="success"?"success":"info";const theme={info:{background:"#29333e",border:"#8b98a6",text:"#f2f3f5",mark:"●"},success:{background:"#153b2c",border:"#39b979",text:"#d7ffe9",mark:"✓"},warning:{background:"#403116",border:"#e1ac36",text:"#fff0bd",mark:"⚠"},error:{background:"#5b1927",border:"#ff5266",text:"#fff0f2",mark:"!"}}[bannerSeverity];return <div role="alert" key={n.id} style={{pointerEvents:"auto",background:bannerSeverity==="warning"?"repeating-linear-gradient(135deg,#403116,#403116 12px,#493819 12px,#493819 16px)":theme.background,border:"2px solid "+theme.border,borderLeft:"7px solid "+theme.border,borderRadius:10,padding:14,boxShadow:"0 15px 45px #0009",color:theme.text}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"start",gap:12}}><div><small style={{fontWeight:800,letterSpacing:1}}>{theme.mark+" "+(notificationKind(n)==="alert"?"ALERT":"ANNOUNCEMENT")}</small><h3 style={{margin:"5px 0",fontSize:15}}>{n.title}</h3></div><button type="button" onClick={()=>void acknowledgeNotification(n)} aria-label={"Dismiss "+n.title} style={{background:"transparent",color:theme.text,border:"1px solid currentColor",borderRadius:6,padding:"4px 9px",cursor:"pointer"}}>Dismiss ×</button></div>{n.message&&<p style={{fontSize:12,lineHeight:1.5,margin:"7px 0"}}>{n.message}</p>}{n.action_url&&<button type="button" onClick={()=>void openNotification(n)} style={{border:0,background:"transparent",color:theme.text,padding:0,fontWeight:700,cursor:"pointer"}}>Open details →</button>}</div>})}</aside>,document.body)}
    {surface==="admin"&&open&&mounted&&createPortal(<section
      id="admin-notification-popover"
      ref={panelRef}
      style={panelStyle}
      data-surface="admin"
      className={styles.panel}
      role="dialog"
      aria-label="Admin notifications"
    >
      <header className={styles.header}>
        <div><small>{surface==="admin"?"ORBITFS ALERT SYSTEM":"CUSTOMER PORTAL"}</small><h2>Notifications</h2></div>
        <div className={styles.headerActions}>
          {surface==="admin"&&<button className={styles.headerButton} type="button" onClick={closePanel} aria-label="Close notifications">Close ✕</button>}
          {surface==="admin"&&canSend&&<button className={styles.headerButton} type="button" onClick={()=>{closePanel();router.push("/admin/alerts")}}>Alert System</button>}
          <button className={styles.headerButton} type="button" onClick={()=>void load(feedLimit)}>Refresh</button>
          <button className={styles.markAll} type="button" onClick={markAllRead} disabled={unread===0}>Mark all read</button>
        </div>
      </header>
      {error&&<div role="alert" style={{margin:"10px 12px",padding:"12px",border:"1px solid #c95162",background:"#421b24",color:"#ffe1e5",borderRadius:8,fontSize:13,lineHeight:1.5,overflowWrap:"anywhere"}}><b>Notification action failed</b><div>{error}</div><button type="button" onClick={()=>{setError("");void load(feedLimit)}} style={{marginTop:8,padding:"6px 10px",borderRadius:6}}>Retry</button></div>}
      <div className={styles.list}>
        {loading&&<p className={styles.empty}>Loading notifications…</p>}
        {!loading&&error&&<div className={styles.error}><b>Notifications unavailable</b><span>{error}</span><button type="button" onClick={()=>void load(feedLimit)}>Retry</button></div>}
        {!loading&&!error&&items.length===0&&<p className={styles.empty}>No notifications yet.</p>}
        {!loading&&!error&&items.map(n=>{
          const kind=notificationKind(n);
          const criticalAlert=kind==="alert"&&n.severity==="error";
          return <article key={n.id} className={`${styles.item} ${!n.read_at?styles.unread:""} ${criticalAlert?styles.criticalAlert:""}`} data-kind={kind} data-severity={n.severity} data-acknowledged={n.acknowledged_at?"true":"false"} data-saved={n.saved_at?"true":"false"}>
            <button type="button" className={styles.itemOpen} onClick={()=>setExpanded(n)} aria-label={"More details: "+n.title}>
              <span className={styles.typeMark} aria-hidden="true">{kindMarks[kind]}</span>
              <span className={styles.copy}>
                <span className={styles.labels}><span className={styles.kindLabel}>{kindLabels[kind]}</span><span className={styles.severityLabel}>{severityLabels[n.severity]}</span>{criticalAlert&&<span className={styles.criticalLabel}>Requires attention</span>}{n.acknowledged_at&&<span className={styles.ackLabel}>Acknowledged</span>}{n.saved_at&&<span className={styles.savedLabel}>Saved</span>}</span>
                <span className={styles.itemTop}><b>{n.title}</b><small>{prettyTime(n.created_at)}</small></span>
                {n.message&&<span className={styles.message}>{n.message.length>110?n.message.slice(0,110)+"…":n.message}</span>}
                {n.action_url&&<span className={styles.openHint}>Open details →</span>}
              </span>
            </button>
            <div className={styles.itemActions}><button type="button" className={styles.detailsAction} onClick={()=>setExpanded(n)}>Details</button><button type="button" className={styles.deleteAction} disabled={deleting===n.id} onClick={()=>void deleteNotification(n)}>{deleting===n.id?"Deleting…":"Delete"}</button>
              <button type="button" className={styles.saveAction} onClick={()=>void toggleSaved(n)}>{n.saved_at?"Unsave":"Save"}</button>
              {!n.acknowledged_at&&<button type="button" className={styles.ackAction} onClick={()=>void acknowledgeNotification(n)}>Acknowledge</button>}
              {n.acknowledged_at&&<span className={styles.retentionNote}>{n.saved_at?"Saved — kept until unsaved":"Deletes 3 days after acknowledgement"}</span>}
            </div>
          </article>;
        })}
      </div>
    </section>,document.body)}
    {surface==="portal"&&open&&mounted&&createPortal(<section
      ref={panelRef}
      data-surface="portal"
      className={styles.panel}
      style={panelStyle}
      role="dialog"
      aria-label="Customer notifications"
    >
      <header className={styles.header}>
        <div><small>CUSTOMER PORTAL</small><h2>Notifications</h2></div>
        <div className={styles.headerActions}>
          <button className={styles.headerButton} type="button" onClick={closePanel} aria-label="Close notifications">Close ✕</button>
          
          <button className={styles.headerButton} type="button" onClick={()=>void load(feedLimit)}>Refresh</button>
          <button className={styles.markAll} type="button" onClick={markAllRead} disabled={unread===0}>Mark all read</button>
        </div>
      </header>
      {error&&<div role="alert" style={{margin:"10px 12px",padding:"12px",border:"1px solid #c95162",background:"#421b24",color:"#ffe1e5",borderRadius:8,fontSize:13,lineHeight:1.5,overflowWrap:"anywhere"}}><b>Notification action failed</b><div>{error}</div><button type="button" onClick={()=>{setError("");void load(feedLimit)}} style={{marginTop:8,padding:"6px 10px",borderRadius:6}}>Retry</button></div>}
      <div className={styles.list}>
        {loading&&<p className={styles.empty}>Loading notifications…</p>}
        {!loading&&error&&<div className={styles.error}><b>Notifications unavailable</b><span>{error}</span><button type="button" onClick={()=>void load(feedLimit)}>Retry</button></div>}
        {!loading&&!error&&items.length===0&&<p className={styles.empty}>No notifications yet.</p>}
        {!loading&&!error&&items.map(n=>{
          const kind=notificationKind(n);
          const criticalAlert=kind==="alert"&&n.severity==="error";
          return <article key={n.id} className={`${styles.item} ${!n.read_at?styles.unread:""} ${criticalAlert?styles.criticalAlert:""}`} data-kind={kind} data-severity={n.severity} data-acknowledged={n.acknowledged_at?"true":"false"} data-saved={n.saved_at?"true":"false"}>
            <button type="button" className={styles.itemOpen} onClick={()=>setExpanded(n)} aria-label={"More details: "+n.title}>
              <span className={styles.typeMark} aria-hidden="true">{kindMarks[kind]}</span>
              <span className={styles.copy}>
                <span className={styles.labels}><span className={styles.kindLabel}>{kindLabels[kind]}</span><span className={styles.severityLabel}>{severityLabels[n.severity]}</span>{criticalAlert&&<span className={styles.criticalLabel}>Requires attention</span>}{n.acknowledged_at&&<span className={styles.ackLabel}>Acknowledged</span>}{n.saved_at&&<span className={styles.savedLabel}>Saved</span>}</span>
                <span className={styles.itemTop}><b>{n.title}</b><small>{prettyTime(n.created_at)}</small></span>
                {n.message&&<span className={styles.message}>{n.message.length>110?n.message.slice(0,110)+"…":n.message}</span>}
                {n.action_url&&<span className={styles.openHint}>Open details →</span>}
              </span>
            </button>
            <div className={styles.itemActions}><button type="button" className={styles.detailsAction} onClick={()=>setExpanded(n)}>Details</button><button type="button" className={styles.deleteAction} disabled={deleting===n.id} onClick={()=>void deleteNotification(n)}>{deleting===n.id?"Deleting…":"Delete"}</button>
              <button type="button" className={styles.saveAction} onClick={()=>void toggleSaved(n)}>{n.saved_at?"Unsave":"Save"}</button>
              {!n.acknowledged_at&&<button type="button" className={styles.ackAction} onClick={()=>void acknowledgeNotification(n)}>Acknowledge</button>}
              {n.acknowledged_at&&<span className={styles.retentionNote}>{n.saved_at?"Saved — kept until unsaved":"Deletes 3 days after acknowledgement"}</span>}
            </div>
          </article>;
        })}
      </div>
    </section>,document.body)}
    {expanded&&mounted&&createPortal(<div className={styles.detailBackdrop} onPointerDown={e=>{if(e.target===e.currentTarget)setExpanded(null)}}><section className={styles.detailDialog} role="dialog" aria-modal="true" aria-label={"Notification details: "+expanded.title}><header><div><small>{kindLabels[notificationKind(expanded)]} · {severityLabels[expanded.severity]}</small><h2>{expanded.title}</h2><small>{prettyTime(expanded.created_at)}</small></div><button type="button" onClick={()=>setExpanded(null)}>Close ×</button></header><p>{expanded.message||"No further details."}</p><footer>{expanded.action_url&&<button type="button" onClick={()=>{void openNotification(expanded);setExpanded(null)}}>Open link →</button>}<button type="button" className={styles.deleteAction} disabled={deleting===expanded.id} onClick={()=>void deleteNotification(expanded)}>Delete</button>{!expanded.acknowledged_at&&<button type="button" onClick={()=>{void acknowledgeNotification(expanded);setExpanded(null)}}>Acknowledge</button>}</footer></section></div>,document.body)}
  </div>;
}
