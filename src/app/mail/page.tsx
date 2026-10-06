"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {createClient} from "@/lib/supabase";
import "./mail-v6.css";

async function readJson(r:Response){const t=await r.text();if(!t)return {};try{return JSON.parse(t)}catch{return {error:t||`Request failed (${r.status})`}}}

export default function MailHome(){
  const sb=createClient();
  const [accounts,setAccounts]=useState<any[]>([]),[caps,setCaps]=useState<any>({}),[queueData,setQueueData]=useState<any>(null),[loading,setLoading]=useState(true),[error,setError]=useState(""),[msg,setMsg]=useState(""),[confirmClearQueue,setConfirmClearQueue]=useState(false);

  async function token(){const {data}=await sb.auth.getSession();return data.session?.access_token||""}
  async function load(){
    setLoading(true);setError("");
    try{
      const t=await token();if(!t){location.href="/login";return}
      const r=await fetch("/api/mail/accounts",{headers:{Authorization:`Bearer ${t}`},cache:"no-store"});
      const j:any=await readJson(r);if(!r.ok)throw new Error(j.error||"Could not load mail accounts.");
      const nextCaps=j.capabilities||{};
      setAccounts(j.accounts||[]);setCaps(nextCaps);
      if(nextCaps.queueView){
        const ar=await fetch("/api/mail/admin",{headers:{Authorization:`Bearer ${t}`},cache:"no-store"});
        const aj:any=await readJson(ar);if(!ar.ok)throw new Error(aj.error||"Could not load Mail queue.");
        setQueueData(aj.queue||{summary:{},queue:[],stuck_logs:[]});
      }else setQueueData(null);
    }catch(e:any){setError(e.message)}finally{setLoading(false)}
  }
  useEffect(()=>{void load()},[]);

  async function processQueueNow(){
    setMsg("Processing queue…");
    const t=await token();
    const r=await fetch("/api/mail/admin",{method:"PUT",headers:{Authorization:`Bearer ${t}`,"Content-Type":"application/json"},body:JSON.stringify({action:"process_queue_now"})});
    const j:any=await readJson(r);if(!r.ok){setMsg(j.error||"Queue processing failed.");return}
    const q=j.queue||{};setMsg(`Queue processed: ${Number(q.sent||0)} sent, ${Number(q.failed||0)} failed.`);await load();
  }

  async function queueAction(queueAction:string,extra:any={}){
    setMsg("Working…");
    const t=await token();
    const r=await fetch("/api/mail/admin",{method:"PUT",headers:{Authorization:`Bearer ${t}`,"Content-Type":"application/json"},body:JSON.stringify({action:"queue",queueAction,...extra})});
    const j:any=await readJson(r);if(!r.ok){setMsg(j.error||"Queue action failed.");return}
    setMsg("Queue updated.");await load();
  }

  const canOpenConfig=!!(caps.admin||caps.settings||caps.templates);
  return <main className="mailV6">
    <header className="mailV6Topbar">
      <Link className="mailV6Brand" href="/admin"><span className="mailV6BrandMark">M</span><span className="mailV6BrandText"><b>OrbitFS Mail</b><span>Billing Store communications</span></span></Link>
      <div className="mailV6TopSearch"><input aria-label="Search Mail" placeholder="Open a mailbox to search messages…"/><button type="button" disabled aria-label="Search available inside a mailbox">⌕</button></div>
      <div className="mailV6TopActions">{canOpenConfig&&<Link href="/mail/admin">Mail Config</Link>}<Link href="/admin">Admin</Link><span className="mailV6StatusDot" aria-label="Mail system active"/></div>
    </header>

    <div className="mailV6Shell">
      <div className="mailV6TitleRow"><div><h1>Mail</h1><p>Your authorised OrbitFS mailboxes and the existing transactional delivery queue.</p></div></div>
      <nav className="mailV6SectionTabs" aria-label="Mail sections"><Link className="active" href="/mail">Mailboxes & Queue</Link>{canOpenConfig&&<Link href="/mail/admin">Configuration</Link>}</nav>

      {error&&<div className="mailV6Notice error">{error}</div>}
      {msg&&<div className="mailV6Notice">{msg}</div>}

      <div className="mailV6HomeGrid">
        <section className="mailV6Panel mailV6MailboxRail">
          <div className="mailV6MailboxRailHeader"><h2>Mailboxes</h2><p>Only mailboxes allowed by your staff permissions appear here.</p></div>
          {loading?<div className="mailV6Empty">Loading mailboxes…</div>:accounts.length?<div className="mailV6MailboxList">{accounts.map(a=><Link key={a.id} href={`/mail/mailbox/${encodeURIComponent(a.address.split("@")[0])}`} className="mailV6MailboxCard">
            <small>{a.kind||"shared"} mailbox</small><strong>{a.display_name||a.address}</strong><span>{a.address}</span><em>{a.can_send?"View + Send":"View only"}{a.can_manage?" · Config access":""}</em>
          </Link>)}</div>:!error&&<div className="mailV6Empty">No mailboxes are assigned to your account.</div>}
        </section>

        {caps.queueView?<section className="mailV6Panel mailV6QueuePanel">
          <div className="mailV6QueueHead"><div><h2>Mail Queue</h2><p>Pending, processing, failed and stuck transactional mail jobs.</p></div></div>
          {loading&&!queueData?<div className="mailV6Empty">Loading queue…</div>:<MailQueue data={queueData||{summary:{},queue:[],stuck_logs:[]}} reload={load} action={queueAction} processNow={processQueueNow} canManage={!!caps.queueManage} requestClearQueue={()=>setConfirmClearQueue(true)}/>}
        </section>:<section className="mailV6Panel mailV6QueuePanel"><div className="mailV6QueueHead"><div><h2>Mail Queue</h2><p>Your account does not have Mail queue permission.</p></div></div><div className="mailV6Empty">Queue controls are hidden by your current staff permissions.</div></section>}
      </div>
    </div>
    {confirmClearQueue&&<div className="mailV6ConfirmBackdrop" role="presentation" onMouseDown={()=>setConfirmClearQueue(false)}><section className="mailV6ConfirmDialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-mail-queue-title" aria-describedby="clear-mail-queue-description" onMouseDown={e=>e.stopPropagation()}><h2 id="clear-mail-queue-title">Clear Mail queue?</h2><p id="clear-mail-queue-description">All non-sent queue items will be cleared. Sent delivery history is kept.</p><div className="mailV6ConfirmActions"><button type="button" autoFocus onClick={()=>setConfirmClearQueue(false)}>Cancel</button><button type="button" className="danger" onClick={async()=>{setConfirmClearQueue(false);await queueAction("clear_queue")}}>Clear queue</button></div></section></div>}
  </main>
}

function MailQueue({data,reload,action,processNow,canManage,requestClearQueue}:{data:any,reload:()=>Promise<void>,action:(name:string,extra?:any)=>Promise<void>,processNow:()=>Promise<void>,canManage:boolean,requestClearQueue:()=>void}){
  const s=data.summary||{},rows=data.queue||[],stuck=data.stuck_logs||[];
  return <div>
    <div className="mailV6QueueStats">{["pending","processing","failed","stuck"].map(k=><div className="mailV6QueueStat" key={k}><small>{k}</small><b>{s[k]||0}</b></div>)}</div>
    <div className="mailV6QueueActions"><button type="button" onClick={()=>void reload()}>Refresh queue</button>{canManage&&<><button type="button" className="primary" onClick={()=>void processNow()}>Process queue now</button><button type="button" onClick={()=>void action("retry_all")}>Retry stuck / failed</button><button type="button" onClick={()=>void action("clear_failed")}>Clear exhausted / stuck</button></>}</div>
    {rows.length?<div className="mailV6QueueList">{rows.map((r:any)=><div className="mailV6QueueRow" key={r.id}>
      <div><div className="mailV6QueueRowMeta"><b>{r.event_key}</b><span className={`mailV6QueueState ${r.stuck?"stuck":""}`}>{r.stuck?"STUCK":String(r.state||"").toUpperCase()}</span></div><span>{r.related_type} · {r.related_id}</span><div className="mailV6QueueRowMeta"><small>Attempts {r.attempts||0}</small><small>Created {new Date(r.created_at).toLocaleString()}</small><small>Next {r.next_attempt_at?new Date(r.next_attempt_at).toLocaleString():"—"}</small></div>{r.recipient&&<small>{r.sender||"—"} → {r.recipient}</small>}{r.sent_at&&<small>Sent {new Date(r.sent_at).toLocaleString()} · provider {r.provider_id||"—"}</small>}{(r.last_error||r.delivery_error)&&<div className="mailV6QueueError">{r.last_error||r.delivery_error}</div>}</div>
      <div className="mailV6QueueActions">{canManage&&r.state!=="sent"&&<><button type="button" onClick={()=>void action("retry",{outboxId:r.id})}>Retry</button><button type="button" onClick={()=>void action("clear",{outboxId:r.id})}>Clear</button></>}</div>
    </div>)}</div>:<div className="mailV6Empty">No queued mail events.</div>}
    {stuck.length>0&&<div style={{marginTop:16}}><div className="mailV6QueueHead"><div><h2>Stuck preparing records</h2><p>Delivery records that never finalized.</p></div></div><div className="mailV6QueueList">{stuck.map((l:any)=><div className="mailV6QueueRow" key={l.id}><div><b>{l.subject}</b><div className="mailV6QueueRowMeta"><small>{l.sender} → {l.recipient}</small><small>Created {new Date(l.created_at).toLocaleString()}</small></div></div>{canManage&&<div><button type="button" onClick={()=>void action("clear_log",{logId:l.id})}>Clear</button></div>}</div>)}</div></div>}
    {canManage&&rows.some((r:any)=>r.state!=="sent")&&<div className="mailV6QueueActions" style={{marginTop:12}}><button type="button" className="danger" onClick={requestClearQueue}>Clear queue</button></div>}
  </div>
}
