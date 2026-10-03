"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {createClient} from "@/lib/supabase";

async function readJson(r:Response){const t=await r.text();if(!t)return {};try{return JSON.parse(t)}catch{return {error:t||`Request failed (${r.status})`}}}
const panel:any={background:'#fff',border:'1px solid #e1e6ef',borderRadius:16,padding:18};
const muted:any={fontSize:13,opacity:.65};
const headerLink:any={color:'#fff',textDecoration:'none',fontWeight:700};

export default function MailHome(){
  const sb=createClient();
  const [accounts,setAccounts]=useState<any[]>([]),[caps,setCaps]=useState<any>({}),[queueData,setQueueData]=useState<any>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[msg,setMsg]=useState('');

  async function token(){const {data}=await sb.auth.getSession();return data.session?.access_token||''}
  async function load(){
    setLoading(true);setError('');
    try{
      const t=await token();if(!t){location.href='/login';return}
      const r=await fetch('/api/mail/accounts',{headers:{Authorization:`Bearer ${t}`},cache:'no-store'});
      const j:any=await readJson(r);if(!r.ok)throw new Error(j.error||'Could not load mail accounts.');
      const nextCaps=j.capabilities||{};
      setAccounts(j.accounts||[]);setCaps(nextCaps);
      if(nextCaps.queueView){
        const ar=await fetch('/api/mail/admin',{headers:{Authorization:`Bearer ${t}`},cache:'no-store'});
        const aj:any=await readJson(ar);if(!ar.ok)throw new Error(aj.error||'Could not load Mail queue.');
        setQueueData(aj.queue||{summary:{},queue:[],stuck_logs:[]});
      }else setQueueData(null);
    }catch(e:any){setError(e.message)}finally{setLoading(false)}
  }
  useEffect(()=>{load()},[]);

  async function processQueueNow(){
    setMsg('Processing queue…');
    const t=await token();
    const r=await fetch('/api/mail/admin',{method:'PUT',headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json'},body:JSON.stringify({action:'process_queue_now'})});
    const j:any=await readJson(r);if(!r.ok){setMsg(j.error||'Queue processing failed.');return}
    const q=j.queue||{};setMsg(`Queue processed: ${Number(q.sent||0)} sent, ${Number(q.failed||0)} failed.`);await load();
  }

  async function queueAction(queueAction:string,extra:any={}){
    setMsg('Working…');
    const t=await token();
    const r=await fetch('/api/mail/admin',{method:'PUT',headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json'},body:JSON.stringify({action:'queue',queueAction,...extra})});
    const j:any=await readJson(r);if(!r.ok){setMsg(j.error||'Queue action failed.');return}
    setMsg('Queue updated.');await load();
  }

  const canOpenConfig=!!(caps.admin||caps.settings||caps.templates);
  return <main style={{minHeight:'100vh',background:'#f4f6fa',fontFamily:'Arial,sans-serif',color:'#172033'}}>
    <header style={{background:'#111827',color:'#fff',padding:'20px 18px'}}><div style={{maxWidth:1280,margin:'0 auto',display:'flex',justifyContent:'space-between',alignItems:'center',gap:14,flexWrap:'wrap'}}>
      <div><h1 style={{margin:0,fontSize:24}}>OrbitFS Mail</h1><p style={{margin:'5px 0 0',opacity:.7}}>Your authorised mailboxes and Mail queue.</p></div>
      <div style={{display:'flex',gap:16,alignItems:'center',flexWrap:'wrap'}}>{canOpenConfig&&<Link href="/mail/admin" style={headerLink}>Mail Config</Link>}<Link href="/admin" style={headerLink}>Back to Admin</Link></div>
    </div></header>
    <div style={{maxWidth:1280,margin:'0 auto',padding:'20px 16px 30px'}}>
      {error&&<div style={{padding:14,border:'1px solid #f2b8b5',background:'#fff5f5',borderRadius:12,color:'#a52727',marginBottom:16}}>{error}</div>}
      {msg&&<div style={{padding:12,background:'#eef4ff',borderRadius:10,marginBottom:14}}>{msg}</div>}

      <section style={{marginBottom:22}}><h2 style={{marginBottom:4}}>Mailboxes</h2><p style={{marginTop:0,opacity:.68}}>Only mailboxes your staff permissions allow are shown here.</p>
        {loading?<p>Loading mailboxes…</p>:<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:14}}>{accounts.map(a=><Link key={a.id} href={`/mail/mailbox/${encodeURIComponent(a.address.split('@')[0])}`} style={{display:'block',padding:20,background:'#fff',border:'1px solid #e1e6ef',borderRadius:16,textDecoration:'none',color:'inherit',boxShadow:'0 2px 12px rgba(15,23,42,.05)'}}>
          <small style={{opacity:.58,textTransform:'uppercase'}}>{a.kind||'shared'} mailbox</small><h3 style={{margin:'8px 0 5px',fontSize:20}}>{a.display_name}</h3><div style={{overflowWrap:'anywhere'}}>{a.address}</div>
          <div style={{display:'flex',gap:8,marginTop:12,fontSize:12,opacity:.7,flexWrap:'wrap'}}><span>{a.can_send?'View + Send':'View only'}</span>{a.can_manage&&<span>· Config access</span>}</div><div style={{marginTop:18,fontWeight:700}}>Open mailbox →</div>
        </Link>)}</div>}
        {!loading&&!accounts.length&&!error&&<div style={panel}>No mailboxes are assigned to your account.</div>}
      </section>

      {caps.queueView&&<section><div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'end',flexWrap:'wrap',marginBottom:10}}><div><h2 style={{margin:'0 0 4px'}}>Mail Queue</h2><p style={{margin:0,opacity:.68}}>Pending, processing, failed and stuck mail jobs.</p></div></div><div style={panel}>{loading&&!queueData?<p>Loading queue…</p>:<MailQueue data={queueData||{summary:{},queue:[],stuck_logs:[]}} reload={load} action={queueAction} processNow={processQueueNow} canManage={!!caps.queueManage}/>}</div></section>}
    </div>
  </main>
}

function MailQueue({data,reload,action,processNow,canManage}:{data:any,reload:()=>Promise<void>,action:(name:string,extra?:any)=>Promise<void>,processNow:()=>Promise<void>,canManage:boolean}){
  const s=data.summary||{},rows=data.queue||[],stuck=data.stuck_logs||[];
  return <div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:8,marginBottom:12}}>{['pending','processing','failed','stuck'].map(k=><div key={k} style={{padding:10,border:'1px solid #e2e7ef',borderRadius:10,background:'#f8fafc'}}><small style={muted}>{k}</small><div style={{fontSize:18,fontWeight:800}}>{s[k]||0}</div></div>)}</div>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}><button onClick={()=>reload()}>Refresh queue</button>{canManage&&<><button onClick={()=>processNow()}>Process queue now</button><button onClick={()=>action('retry_all')}>Retry stuck / failed</button><button onClick={()=>action('clear_failed')}>Clear exhausted / stuck</button><button onClick={()=>{if(confirm('Clear all non-sent items from the Mail queue? Sent delivery history will be kept.'))action('clear_queue')}}>Clear queue</button></>}</div>
    {rows.length?<div>{rows.map((r:any)=><div key={r.id} style={{padding:'10px 0',borderBottom:'1px solid #edf0f5',display:'grid',gridTemplateColumns:'minmax(0,1fr) auto',gap:10}}>
      <div style={{minWidth:0}}><div style={{display:'flex',gap:7,alignItems:'center',flexWrap:'wrap'}}><b>{r.event_key}</b><span style={{fontSize:11,fontWeight:700,color:r.stuck?'#b45309':'#475569'}}>{r.stuck?'STUCK':String(r.state||'').toUpperCase()}</span></div><div style={muted}>{r.related_type} · {r.related_id}</div><div style={{...muted,marginTop:3}}>Attempts {r.attempts||0} · created {new Date(r.created_at).toLocaleString()} · next {r.next_attempt_at?new Date(r.next_attempt_at).toLocaleString():'—'}</div>{r.recipient&&<div style={muted}>{r.sender||'—'} → {r.recipient}</div>}{r.sent_at&&<div style={muted}>Sent {new Date(r.sent_at).toLocaleString()} · provider {r.provider_id||'—'}</div>}{(r.last_error||r.delivery_error)&&<div style={{fontSize:12,color:'#b42318',marginTop:4}}>{r.last_error||r.delivery_error}</div>}</div>
      <div style={{display:'flex',gap:6,alignItems:'start',flexWrap:'wrap',justifyContent:'end'}}>{canManage&&r.state!=='sent'&&<button onClick={()=>action('retry',{outboxId:r.id})}>Retry</button>}{canManage&&r.state!=='sent'&&<button onClick={()=>action('clear',{outboxId:r.id})}>Clear</button>}</div>
    </div>)}</div>:<p style={muted}>No queued mail events.</p>}
    {stuck.length>0&&<div style={{marginTop:16}}><b>Stuck preparing delivery records</b><p style={muted}>These created a delivery record but never finalized. Clear them so they stop looking active.</p>{stuck.map((l:any)=><div key={l.id} style={{padding:'9px 0',borderBottom:'1px solid #edf0f5',display:'flex',justifyContent:'space-between',gap:10,alignItems:'center'}}><div><b>{l.subject}</b><div style={muted}>{l.sender} → {l.recipient} · created {new Date(l.created_at).toLocaleString()}</div></div>{canManage&&<button onClick={()=>action('clear_log',{logId:l.id})}>Clear</button>}</div>)}</div>}
  </div>
}
