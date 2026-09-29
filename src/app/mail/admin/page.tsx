"use client";
import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";

async function readJson(r:Response){const t=await r.text();if(!t)return {};try{return JSON.parse(t)}catch{return {error:t||`Request failed (${r.status})`}}}
const panel:any={background:'#fff',border:'1px solid #e1e6ef',borderRadius:16,padding:18};
const input:any={width:'100%',padding:'10px 12px',border:'1px solid #d9dee8',borderRadius:9,boxSizing:'border-box'};
const muted:any={fontSize:13,opacity:.65};
const danger:any={color:'#b42318',border:'1px solid #efc1bd',background:'#fff7f6',borderRadius:7,padding:'7px 10px'};
const mailboxTypes=[
  {value:'shared',label:'Shared',description:'Team mailbox controlled by mailbox view/send permissions.'},
  {value:'no-reply',label:'No-reply',description:'Automated/outbound mailbox not intended as a personal inbox.'},
  {value:'personal',label:'Personal',description:'Assigned to one active staff member.'},
  {value:'system',label:'System',description:'Internal/system mailbox controlled by explicit Mail permissions.'}
];

export default function MailConfig(){
  const sb=createClient();
  const [caps,setCaps]=useState<any>({}),[adminData,setAdminData]=useState<any>(null),[spamData,setSpamData]=useState<any>({rules:[],events:[]}),[loading,setLoading]=useState(true),[error,setError]=useState(''),[msg,setMsg]=useState('');
  async function token(){const {data}=await sb.auth.getSession();return data.session?.access_token||''}
  async function load(){
    setLoading(true);setError('');
    try{
      const t=await token();if(!t){location.href='/login';return}
      const cr=await fetch('/api/mail/accounts',{headers:{Authorization:`Bearer ${t}`},cache:'no-store'});
      const cj:any=await readJson(cr);if(!cr.ok)throw new Error(cj.error||'Could not load Mail permissions.');
      const nextCaps=cj.capabilities||{};setCaps(nextCaps);
      if(!(nextCaps.admin||nextCaps.settings||nextCaps.templates))throw new Error('Mail Config permission denied.');
      const ar=await fetch('/api/mail/admin',{headers:{Authorization:`Bearer ${t}`},cache:'no-store'});
      const aj:any=await readJson(ar);if(!ar.ok)throw new Error(aj.error||'Could not load Mail Config.');setAdminData(aj);
      if(nextCaps.settings){const sr=await fetch('/api/mail/spam',{headers:{Authorization:`Bearer ${t}`},cache:'no-store'});const sj:any=await readJson(sr);if(sr.ok)setSpamData(sj)}
    }catch(e:any){setError(e.message)}finally{setLoading(false)}
  }
  useEffect(()=>{load()},[]);
  async function save(body:any){
    setMsg('Saving…');const t=await token();
    const r=await fetch('/api/mail/admin',{method:'PUT',headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j:any=await readJson(r);if(!r.ok){setMsg(j.error||'Save failed.');return false}
    setMsg('Saved.');await load();return true;
  }
  const settings=useMemo(()=>Object.fromEntries((adminData?.settings||[]).map((x:any)=>[x.key,x.value])),[adminData]);

  return <main style={{minHeight:'100vh',background:'#f4f6fa',fontFamily:'Arial,sans-serif',color:'#172033'}}>
    <header style={{background:'#111827',color:'#fff',padding:'20px 18px'}}><div style={{maxWidth:1280,margin:'0 auto',display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}><div><h1 style={{margin:0,fontSize:24}}>Mail Config</h1><p style={{margin:'5px 0 0',opacity:.7}}>OrbitFS Mail settings and mailbox management.</p></div><div style={{display:'flex',gap:16,flexWrap:'wrap'}}><Link href="/mail" style={{color:'#fff',fontWeight:700,textDecoration:'none'}}>Mail & Queue</Link><Link href="/admin" style={{color:'#fff',fontWeight:700,textDecoration:'none'}}>Back to Admin</Link></div></div></header>
    <div style={{maxWidth:1280,margin:'0 auto',padding:'20px 16px 30px'}}>
      {error&&<div style={{padding:14,border:'1px solid #f2b8b5',background:'#fff5f5',borderRadius:12,color:'#a52727',marginBottom:16}}>{error}</div>}
      {msg&&<div style={{padding:12,background:'#eef4ff',borderRadius:10,marginBottom:14}}>{msg}</div>}
      {loading&&<p>Loading Mail Config…</p>}
      {!loading&&adminData&&<section style={{display:'grid',gap:12}}>
        {caps.settings&&<details open style={panel}><summary style={{cursor:'pointer',fontWeight:700,fontSize:17}}>Mail settings</summary><div style={{marginTop:14}}><MainSettings settings={settings} provider={adminData.provider||{}} save={save}/></div></details>}
        {caps.settings&&<details open style={panel}><summary style={{cursor:'pointer',fontWeight:700,fontSize:17}}>Mailbox settings</summary><div style={{marginTop:14}}><MailboxSettings rows={adminData.accounts||[]} users={adminData.users||[]} save={save}/></div></details>}
        {caps.settings&&<details style={panel}><summary style={{cursor:'pointer',fontWeight:700,fontSize:17}}>Spam protection</summary><div style={{marginTop:14}}><SpamProtection data={spamData} token={token} reload={load}/></div></details>}
        {caps.templates&&<details style={panel}><summary style={{cursor:'pointer',fontWeight:700,fontSize:17}}>Templates</summary><div style={{marginTop:14}}><Templates rows={adminData.templates||[]} save={save}/></div></details>}
        {caps.admin&&<details style={panel}><summary style={{cursor:'pointer',fontWeight:700,fontSize:17}}>Delivery history</summary><div style={{marginTop:14}}><Delivery rows={adminData.logs||[]}/></div></details>}
        {!caps.settings&&!caps.templates&&caps.admin&&<div style={panel}><b>Mail administration overview</b><p style={{...muted,marginBottom:0}}>You can view Mail administration status, but changing config requires the Mail settings or Mail templates permission.</p></div>}
      </section>}
    </div>
  </main>
}

function MainSettings({settings,provider,save}:{settings:any,provider:any,save:(b:any)=>Promise<boolean>}){
  const outbound=settings.outbound||{};
  const [senderName,setSenderName]=useState(outbound.sender_name||'OrbitFS'),[systemSender,setSystemSender]=useState(outbound.system_sender||outbound.default_from||'info@orbitfs.cc'),[reply,setReply]=useState(outbound.reply_to||'support@orbitfs.cc'),[supportSender,setSupportSender]=useState(outbound.support_sender||outbound.customer_sender||'support@orbitfs.cc'),[customerName,setCustomerName]=useState(outbound.customer_sender_name||'OrbitFS Support'),[billingSender,setBillingSender]=useState(outbound.billing_sender||'billing@orbitfs.cc'),[domain,setDomain]=useState(settings.inbound?.domain||'orbitfs.cc'),[enabled,setEnabled]=useState(settings.inbound?.enabled!==false);
  const rows=[
    {label:'System & notification sender',value:systemSender,set:setSystemSender,help:'Used for account, release, deployment and general system notifications. Standard OrbitFS address: info@orbitfs.cc.'},
    {label:'Standard Reply-To',value:reply,set:setReply,help:'Replies to system/notification mail are routed here. Support mail keeps its own support address.'},
    {label:'Support sender',value:supportSender,set:setSupportSender,help:'Used for support and customer-service mail. Standard OrbitFS address: support@orbitfs.cc.'},
    {label:'Billing sender',value:billingSender,set:setBillingSender,help:'Used for invoices, payments, refunds and other billing mail. Standard OrbitFS address: billing@orbitfs.cc.'}
  ];
  return <div>
    <p style={{...muted,marginTop:0}}>Sender roles are runtime Mail settings, not deployment environment variables. Templates can use the role aliases <code>role:system</code>, <code>role:support</code> and <code>role:billing</code>, or a specific configured mailbox.</p>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:14}}>
      <div><label>Default sender name</label><input style={input} value={senderName} onChange={e=>setSenderName(e.target.value)}/><div style={{...muted,marginTop:4}}>Fallback display name when a mailbox does not define its own display name.</div></div>
      {rows.map(r=><div key={r.label}><label>{r.label}</label><input style={input} type="email" value={r.value} onChange={e=>r.set(e.target.value)}/><div style={{...muted,marginTop:4}}>{r.help}</div></div>)}
      <div><label>Support sender display name</label><input style={input} value={customerName} onChange={e=>setCustomerName(e.target.value)}/><div style={{...muted,marginTop:4}}>Compatibility display name used by customer/support workflows.</div></div>
      <div><label>Inbound domain</label><input style={input} value={domain} onChange={e=>setDomain(e.target.value)}/></div>
      <div><label>Transport</label><div style={{...input,background:'#f7f8fb'}}>{provider.name||'Mail transport'} · outbound {provider.apiKeyConfigured?'configured':'missing'} · inbox {provider.mailApiKeyConfigured?'configured':'missing'}</div><div style={{...muted,marginTop:4}}>Outbound uses RESEND_API_KEY. Inbox can use RESEND_MAIL_API_KEY or fall back to the outbound key.</div></div>
      <label style={{display:'flex',alignItems:'center',gap:8}}><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> Inbound mail enabled</label>
      <div><button onClick={()=>save({action:'settings',rows:[{key:'outbound',value:{sender_name:senderName.trim(),default_from:systemSender.trim().toLowerCase(),reply_to:reply.trim().toLowerCase(),customer_sender:supportSender.trim().toLowerCase(),customer_sender_name:customerName.trim(),system_sender:systemSender.trim().toLowerCase(),support_sender:supportSender.trim().toLowerCase(),billing_sender:billingSender.trim().toLowerCase()}},{key:'inbound',value:{domain:domain.trim().toLowerCase(),enabled}},{key:'provider',value:{name:'resend'}}]})}>Save Mail settings</button></div>
    </div>
  </div>
}

function TypeSelect({value,onChange}:{value:string,onChange:(v:string)=>void}){
  const type=mailboxTypes.find(x=>x.value===value)||mailboxTypes[0];
  return <div><label>Mailbox type</label><select style={input} value={value} onChange={e=>onChange(e.target.value)}>{mailboxTypes.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select><div style={{...muted,marginTop:4}}>{type.description}</div></div>
}

function StaffSelect({users,value,onChange}:{users:any[],value:string,onChange:(v:string)=>void}){
  return <div><label>Assigned staff member</label><select style={input} value={value} onChange={e=>onChange(e.target.value)}><option value="">Select staff member…</option>{users.map(u=><option key={u.id} value={u.id}>{u.display_name||u.email||u.id}{u.email&&u.display_name?` · ${u.email}`:''}</option>)}</select><div style={{...muted,marginTop:4}}>Assignment automatically gives this user effective Mail view + send access to this personal mailbox.</div></div>
}

function MailboxSettings({rows,users,save}:{rows:any[],users:any[],save:(b:any)=>Promise<boolean>}){
  const [address,setAddress]=useState(''),[name,setName]=useState(''),[kind,setKind]=useState('shared'),[assignedUserId,setAssignedUserId]=useState('');
  function changeKind(v:string){setKind(v);if(v!=='personal')setAssignedUserId('')}
  async function create(){if(!address.trim())return;const ok=await save({action:'account_create',address:address.trim().toLowerCase(),displayName:name.trim(),kind,assignedUserId:kind==='personal'?assignedUserId:null});if(ok){setAddress('');setName('');setKind('shared');setAssignedUserId('')}}
  return <div>
    <div style={{padding:14,border:'1px solid #dfe4ec',borderRadius:12,background:'#f8fafc',marginBottom:16}}><b>Create mailbox</b><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10,alignItems:'end',marginTop:10}}><div><label>Address</label><input style={input} type="email" value={address} onChange={e=>setAddress(e.target.value)} placeholder="team@orbitfs.cc"/></div><div><label>Display name</label><input style={input} value={name} onChange={e=>setName(e.target.value)} placeholder="Team"/></div><TypeSelect value={kind} onChange={changeKind}/>{kind==='personal'&&<StaffSelect users={users} value={assignedUserId} onChange={setAssignedUserId}/>}<div><button onClick={create}>Create mailbox</button></div></div><p style={{...muted,marginBottom:0}}>Shared, No-reply and System mailboxes use the existing mailbox permission keys. Personal mailboxes are assigned directly to one active staff member.</p></div>
    {rows.length?rows.map(a=><AccountSettings key={a.id} account={a} users={users} save={save}/>):<p style={muted}>No mailboxes configured.</p>}
  </div>
}

function AccountSettings({account,users,save}:{account:any,users:any[],save:(b:any)=>Promise<boolean>}){
  const [name,setName]=useState(account.display_name||''),[kind,setKind]=useState(account.kind||'shared'),[active,setActive]=useState(account.active!==false),[assignedUserId,setAssignedUserId]=useState(account.assigned_user_id||'');
  function changeKind(v:string){setKind(v);if(v!=='personal')setAssignedUserId('')}
  async function remove(){if(!confirm(`Delete mailbox ${account.address}? This removes the mailbox configuration. Existing delivery history is kept.`))return;await save({action:'account_delete',address:account.address})}
  return <div style={{padding:'14px 0',borderBottom:'1px solid #edf0f5'}}><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10,alignItems:'end'}}><div><b style={{overflowWrap:'anywhere'}}>{account.address}</b><div style={{...muted,marginTop:4}}>Permission key: mail.account.{String(account.address).split('@')[0]}</div><input style={{...input,marginTop:7}} value={name} onChange={e=>setName(e.target.value)} placeholder="Display name"/></div><TypeSelect value={kind} onChange={changeKind}/>{kind==='personal'&&<StaffSelect users={users} value={assignedUserId} onChange={setAssignedUserId}/>}<label style={{display:'flex',alignItems:'center',gap:7,padding:'10px 0'}}><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> Active</label><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button onClick={()=>save({action:'account',address:account.address,displayName:name,kind,active,assignedUserId:kind==='personal'?assignedUserId:null})}>Save</button><button style={danger} onClick={remove}>Delete</button></div></div></div>
}

function Templates({rows,save}:{rows:any[],save:(x:any)=>Promise<boolean>}){
  const [q,setQ]=useState(''),[edit,setEdit]=useState<any>(null);const list=rows.filter(r=>`${r.name} ${r.category} ${r.template_key}`.toLowerCase().includes(q.toLowerCase()));
  return <div><input placeholder="Search templates" value={q} onChange={e=>setQ(e.target.value)} style={{...input,marginBottom:10}}/>{list.map(t=><button key={t.id} onClick={()=>setEdit({...t})} style={{display:'block',width:'100%',textAlign:'left',padding:12,background:'#fff',border:0,borderBottom:'1px solid #edf0f5'}}><b>{t.name}</b><div style={muted}>{t.category} · {t.template_key} · {t.subject}</div></button>)}{edit&&<div style={{marginTop:16,padding:16,border:'1px solid #dfe4ec',borderRadius:12,display:'grid',gap:9}}><input style={input} placeholder="Template key" value={edit.template_key} onChange={e=>setEdit({...edit,template_key:e.target.value})}/><input style={input} placeholder="Name" value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value})}/><input style={input} placeholder="Category" value={edit.category} onChange={e=>setEdit({...edit,category:e.target.value})}/><input style={input} placeholder="Subject" value={edit.subject} onChange={e=>setEdit({...edit,subject:e.target.value})}/><input style={input} placeholder="From account" value={edit.from_account} onChange={e=>setEdit({...edit,from_account:e.target.value})}/><textarea style={input} rows={6} placeholder="Plain-text body" value={edit.text_body||''} onChange={e=>setEdit({...edit,text_body:e.target.value})}/><textarea style={input} rows={6} placeholder="HTML body" value={edit.html||''} onChange={e=>setEdit({...edit,html:e.target.value})}/><div><button onClick={()=>save({action:'template',template:edit})}>Save template</button> <button onClick={()=>setEdit(null)}>Close</button></div></div>}</div>
}

function Delivery({rows}:{rows:any[]}){return rows.length?<div>{rows.map((l:any)=><div key={l.id} style={{display:'flex',justifyContent:'space-between',gap:12,padding:'12px 0',borderBottom:'1px solid #edf0f5'}}><div><b>{l.subject}</b><div style={muted}>{l.sender} → {l.recipient}</div>{l.provider_id&&<div style={muted}>Provider ID: {l.provider_id}</div>}{l.error&&<div style={{fontSize:12,color:'#b42318'}}>{l.error}</div>}</div><div style={{textAlign:'right'}}><b>{l.status}</b><div style={muted}>Created {new Date(l.created_at).toLocaleString()}</div>{l.sent_at&&<div style={muted}>Sent {new Date(l.sent_at).toLocaleString()}</div>}</div></div>)}</div>:<p style={muted}>No delivery records yet.</p>}

function SpamProtection({data,token,reload}:{data:any,token:()=>Promise<string>,reload:()=>Promise<void>}){
  const [type,setType]=useState('email'),[value,setValue]=useState('');
  async function add(){if(!value.trim())return;const t=await token();await fetch('/api/mail/spam',{method:'POST',headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json'},body:JSON.stringify({scope:'global',rule_type:type,value:value.trim(),action:'block',reason:'Mail spam blocklist'})});setValue('');await reload()}
  async function del(id:string){const t=await token();await fetch('/api/mail/spam',{method:'DELETE',headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json'},body:JSON.stringify({id})});await reload()}
  return <div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><select value={type} onChange={e=>setType(e.target.value)}><option value="email">Email</option><option value="domain">Domain</option><option value="ip">IP address</option></select><input style={{...input,maxWidth:360}} value={value} onChange={e=>setValue(e.target.value)} placeholder={`Block ${type}`}/><button onClick={add}>Add block</button></div><div style={{marginTop:14}}><b>Blocked senders / domains / IPs</b>{(data.rules||[]).map((r:any)=><div key={r.id} style={{display:'flex',justifyContent:'space-between',gap:10,padding:'8px 0',borderBottom:'1px solid #edf0f5'}}><span>{r.rule_type}: {r.value}</span><button onClick={()=>del(r.id)}>Remove</button></div>)}</div><div style={{marginTop:16}}><b>Spam records</b>{(data.events||[]).slice(0,50).map((e:any)=><div key={e.id} style={{padding:'8px 0',borderBottom:'1px solid #edf0f5'}}><div>{e.sender_email||'Unknown sender'} {e.sender_ip?`· ${e.sender_ip}`:''}</div><div style={muted}>{e.decision} · score {e.score} · {new Date(e.created_at).toLocaleString()}</div></div>)}</div></div>
}
