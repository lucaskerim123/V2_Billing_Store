"use client";
import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {useParams} from "next/navigation";
import {createClient} from "@/lib/supabase";
import "../../mail-v6.css";

const folders=["inbox","outbox","sent","spam","trash"] as const;
type Folder=typeof folders[number];
async function readJson(r:Response){const t=await r.text();if(!t)return {};try{return JSON.parse(t)}catch{return {error:t||`Request failed (${r.status})`}}}
function fmt(v:any){try{return v?new Date(v).toLocaleString():""}catch{return ""}}
function text(v:any){return Array.isArray(v)?v.join(", "):String(v||"")}
function folderLabel(v:string){return v.charAt(0).toUpperCase()+v.slice(1)}
function threadKey(v:any){return String(v?.subject||"(no subject)").replace(/^(re|fw|fwd):\s*/i,"").trim().toLowerCase()}

export default function Mailbox(){
 const {account}=useParams<{account:string}>();
 const sb=createClient();
 const address=`${String(account).toLowerCase()}@orbitfs.cc`;
 const [folder,setFolder]=useState<Folder>("inbox"),[items,setItems]=useState<any[]>([]),[selected,setSelected]=useState<any>(null),[accountInfo,setAccountInfo]=useState<any>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState(""),[query,setQuery]=useState("");
 const [compose,setCompose]=useState(false),[to,setTo]=useState(""),[cc,setCc]=useState(""),[bcc,setBcc]=useState(""),[subject,setSubject]=useState(""),[body,setBody]=useState(""),[sending,setSending]=useState(false);
 const [mobileReader,setMobileReader]=useState(false),[moveTo,setMoveTo]=useState("inbox");
 const [thread,setThread]=useState<any[]>([]),[inlineReply,setInlineReply]=useState(false),[inlineReplyAll,setInlineReplyAll]=useState(false),[inlineBody,setInlineBody]=useState("");
 async function token(){const {data}=await sb.auth.getSession();return data.session?.access_token||""}
 async function authFetch(url:string,init:RequestInit={}){const t=await token();if(!t){location.href="/login";throw new Error("Authentication required.")}return fetch(url,{...init,headers:{...(init.headers||{}),Authorization:`Bearer ${t}`},cache:"no-store"})}
 async function loadAccount(){const r=await authFetch("/api/mail/accounts");const j:any=await readJson(r);if(!r.ok)throw new Error(j.error||"Could not load mailbox access.");const info=(j.accounts||[]).find((x:any)=>String(x.address).toLowerCase()===address);if(!info)throw new Error("You do not have access to this mailbox.");setAccountInfo(info)}
 async function load(){setLoading(true);setError("");try{const r=await authFetch(`/api/mail?account=${encodeURIComponent(String(account))}&folder=${folder}`);const j:any=await readJson(r);if(!r.ok)throw new Error(j.error||"Could not load mailbox.");if(folder==="inbox"){const sr=await authFetch(`/api/mail?account=${encodeURIComponent(String(account))}&folder=sent`);const sj:any=await readJson(sr);const incoming=j.data||[],sent=sr.ok?(sj.data||[]):[];setItems([...incoming,...sent])}else setItems(j.data||[]);if(selected&&!j.data?.some((x:any)=>x.id===selected.id)){setSelected(null);setThread([]);setMobileReader(false)}}catch(e:any){setError(e.message)}finally{setLoading(false)}}
 useEffect(()=>{loadAccount().catch((e:any)=>setError(e.message))},[account]);
 useEffect(()=>{setSelected(null);setMobileReader(false);load()},[account,folder]);
 const displayItems=useMemo(()=>{if(folder!=="inbox")return items;const groups=new Map<string,any[]>();for(const m of items){const k=threadKey(m);groups.set(k,[...(groups.get(k)||[]),m])}return [...groups.values()].filter(g=>g.some((m:any)=>m.direction==="inbound")).map(g=>{const sorted=[...g].sort((a,b)=>new Date(a.created_at||a.sent_at||a.received_at||0).getTime()-new Date(b.created_at||b.sent_at||b.received_at||0).getTime());const inbound=sorted.filter((m:any)=>m.direction==="inbound");const lastInbound=inbound[inbound.length-1];const unreadInbound=inbound.filter((m:any)=>!m.is_read);const anchor=unreadInbound[unreadInbound.length-1]||lastInbound;return {...anchor,_thread:sorted,thread_count:sorted.length,is_read:unreadInbound.length===0,direction:"inbound",_has_unread_reply:unreadInbound.length>0}}).sort((a,b)=>new Date(b.created_at||b.sent_at||b.received_at||0).getTime()-new Date(a.created_at||a.sent_at||a.received_at||0).getTime())},[items,folder]);
 const filtered=useMemo(()=>{const q=query.trim().toLowerCase();if(!q)return displayItems;return displayItems.filter((m:any)=>`${text(m.from)} ${text(m.to)} ${m.subject||""}`.toLowerCase().includes(q))},[displayItems,query]);
 async function openMail(m:any){setError("");setInlineReply(false);setInlineBody("");if(folder==="outbox"){setSelected(m);setThread([m]);setMobileReader(true);return}try{const members=m._thread||[m];const details=await Promise.all(members.map(async(x:any)=>{const r=await authFetch(`/api/mail/${encodeURIComponent(x.id)}?account=${encodeURIComponent(String(account))}&direction=${x.direction}`);const j:any=await readJson(r);if(!r.ok)throw new Error(j.error||"Could not open message.");return {...j,id:x.id,direction:x.direction,folder:x.folder,is_read:true}}));details.sort((a:any,b:any)=>new Date(a.created_at||0).getTime()-new Date(b.created_at||0).getTime());setThread(details);setSelected(details[details.length-1]);setMobileReader(true);for(const x of members){if(x.direction==="inbound"&&!x.is_read)await mutate(x,"read",undefined,false)}}catch(e:any){setError(e.message)}}
 async function blockSender(){if(!selected)return;const raw=text(selected.from||selected.sender);const mm=raw.match(/<([^>]+)>/);const email=(mm?mm[1]:raw).trim().toLowerCase();if(!email)return;try{const r=await authFetch("/api/mail/spam",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scope:"mailbox",mailbox_address:address,rule_type:"email",value:email,action:"block",reason:"Blocked from mailbox"})});const j:any=await readJson(r);if(!r.ok)throw new Error(j.error||"Could not block sender.");await mutate(selected,"spam")}catch(e:any){setError(e.message)}}
 async function mutate(m:any,action:string,target?:string,reload=true){try{const r=await authFetch("/api/mail",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({account,id:m.id,direction:m.direction,action,folder:target})});const j:any=await readJson(r);if(!r.ok)throw new Error(j.error||"Mail action failed.");if(reload){setSelected(null);setMobileReader(false);await load()}}catch(e:any){setError(e.message)}}
 function resetCompose(){setTo("");setCc("");setBcc("");setSubject("");setBody("")}
 function newMessage(){resetCompose();setCompose(true)}
 function reply(all=false){if(!selected)return;setInlineReplyAll(all);setInlineBody("");setInlineReply(true)}
 function forward(){if(!selected)return;setTo("");setCc("");setBcc("");setSubject(String(selected.subject||"").match(/^fwd:/i)?selected.subject:`Fwd: ${selected.subject||""}`);setBody(`\n\n---------- Forwarded message ----------\nFrom: ${text(selected.from)}\nDate: ${fmt(selected.created_at)}\nSubject: ${selected.subject||""}\nTo: ${text(selected.to)}\n\n${selected.text||""}`);setCompose(true)}
 async function sendInlineReply(){if(!selected||!inlineBody.trim())return;const latest=thread[thread.length-1]||selected;const target=text(latest.reply_to?.[0]||latest.from);const replyCc=inlineReplyAll?[...((latest.to||[]).filter((x:string)=>String(x).toLowerCase()!==address)),...(latest.cc||[])].join(", "):"";setSending(true);setError("");try{const r=await authFetch("/api/mail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({account,to:target,cc:replyCc,subject:String(latest.subject||"").match(/^re:/i)?latest.subject:`Re: ${latest.subject||""}`,text:inlineBody,inReplyTo:latest.message_id,references:latest.references})});const j:any=await readJson(r);if(!r.ok)throw new Error(j.error||"Could not send reply.");setInlineBody("");setInlineReply(false);await load();}catch(e:any){setError(e.message)}finally{setSending(false)}}
 async function send(){if(!to.trim()||!subject.trim()||!body.trim()){setError("To, subject and message are required.");return}setSending(true);setError("");try{const r=await authFetch("/api/mail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({account,to,cc,bcc,subject,text:body,inReplyTo:selected?.message_id,references:selected?.references})});const j:any=await readJson(r);if(!r.ok)throw new Error(j.error||"Could not send email.");setCompose(false);resetCompose();setFolder("sent")}catch(e:any){setError(e.message)}finally{setSending(false)}}
 const canSend=!!accountInfo?.can_send;
 const title=accountInfo?.display_name||address;
 const isTrash=folder==="trash",isSpam=folder==="spam";
 return <main className="mailV6 mailWorkspace">
  <header className="mailV6Topbar">
    <Link className="mailV6Brand" href="/mail"><span className="mailV6BrandMark">M</span><span className="mailV6BrandText"><b>{title}</b><span>{address}</span></span></Link>
    <div className="mailV6TopSearch"><input value={query} onChange={e=>setQuery(e.target.value)} aria-label={`Search ${folderLabel(folder)}`} placeholder={`Search ${folderLabel(folder)} messages…`}/>{query&&<button type="button" onClick={()=>setQuery("")} aria-label="Clear search">×</button>}</div>
    <div className="mailV6TopActions"><button type="button" onClick={()=>void load()}>Refresh</button>{canSend&&<button type="button" className="primary" onClick={newMessage}>Compose</button>}<Link href="/mail">Mail home</Link></div>
  </header>

  <div className="mailMobileFolders" aria-label="Mail folders">{folders.map(f=><button type="button" key={f} className={folder===f?"active":""} onClick={()=>setFolder(f)}>{folderLabel(f)}</button>)}</div>
  {error&&<div className="errorBar">{error}</div>}

  <div className="mailWorkspaceGrid">
    <aside className="mailFolderRail">
      <div className="mailFolderIdentity"><small>OrbitFS Mailbox</small><b>{title}</b><span>{address}</span></div>
      {canSend&&<button type="button" className="primary mailComposeButton" onClick={newMessage}>Compose email</button>}
      <nav className="mailFolderNav" aria-label="Mail folders">{folders.map(f=><button type="button" key={f} className={folder===f?"active":""} onClick={()=>setFolder(f)}><span>{folderLabel(f)}</span>{folder===f&&<small>{filtered.length}</small>}</button>)}</nav>
      <div className="mailRailLinks"><Link href="/mail">Mailboxes & Queue</Link><Link href="/admin">Back to Admin</Link></div>
    </aside>

    <section className={`mailMessageColumn ${mobileReader?"mobileHide":""}`}>
      <div className="mailListToolbar"><input value={query} onChange={e=>setQuery(e.target.value)} aria-label={`Search ${folderLabel(folder)}`} placeholder={`Search ${folderLabel(folder)}…`}/><div className="mailListToolbarMeta"><span>{filtered.length} message{filtered.length===1?"":"s"}</span><button type="button" onClick={()=>void load()} aria-label="Refresh mailbox">↻</button></div></div>
      <div className="mailMessageList">{loading?<div className="mailV6Empty">Loading mail…</div>:filtered.length?filtered.map((m:any)=><button type="button" key={m.id} className={`mailMessageRow ${selected?.id===m.id?"selected":""} ${!m.is_read&&m.direction==="inbound"?"unread":""}`} onClick={()=>void openMail(m)}><div className="who">{folder==="sent"||m.direction==="outbound"?text(m.to||m.recipient):text(m.from||m.sender)||"Unknown"}</div><div className="subj">{m.subject||"(no subject)"}{folder==="inbox"&&m.thread_count>1?<span className="threadCount"> · {m.thread_count}</span>:null}</div><div className="meta"><span>{m.status&&folder==="outbox"?m.status:""}</span><time>{fmt(m.created_at||m.sent_at||m.received_at||m.last_event_at)}</time></div></button>):<div className="mailV6Empty"><b>No {folder} mail.</b><div>{folder==="inbox"?"New incoming messages will appear here.":"This folder is empty."}</div></div>}</div>
    </section>

    <section className={`mailReader ${!mobileReader?"mobileReaderHide":""}`}>
      {selected?<><div className="readerMobile"><button type="button" onClick={()=>setMobileReader(false)}>← {folderLabel(folder)}</button></div><article>
        <div className="mailReaderHead"><h1>{selected.subject||"(no subject)"}</h1>{folder!=="outbox"&&<div className="mailReaderActions">
          {canSend&&<><button type="button" onClick={()=>reply(false)}>Reply</button><button type="button" onClick={()=>reply(true)}>Reply all</button><button type="button" onClick={forward}>Forward</button></>}
          <button type="button" onClick={()=>void mutate(selected,selected.is_read?"unread":"read")}>{selected.is_read?"Mark unread":"Mark read"}</button>
          <select aria-label="Move message to folder" value={moveTo} onChange={e=>setMoveTo(e.target.value)}>{folders.filter(f=>f!=="outbox"&&f!=="trash").map(f=><option key={f} value={f}>{folderLabel(f)}</option>)}</select>
          <button type="button" onClick={()=>void mutate(selected,"move",moveTo)}>Move</button>
          {isSpam?<button type="button" onClick={()=>void mutate(selected,"not_spam")}>Not spam</button>:<><button type="button" onClick={()=>void mutate(selected,"spam")}>Spam</button><button type="button" onClick={()=>void blockSender()}>Block sender</button></>}
          {isTrash?<><button type="button" onClick={()=>void mutate(selected,"restore")}>Restore</button><button type="button" className="danger" onClick={()=>void mutate(selected,"delete_forever")}>Delete forever</button></>:<button type="button" className="danger" onClick={()=>void mutate(selected,"trash")}>Delete</button>}
        </div>}</div>

        {thread.map((msg:any,i:number)=><section className="threadMessage" key={msg.id||i}><div className="threadHead"><div><b>{text(msg.from||msg.sender)}</b><span>to {text(msg.to||msg.recipient)}</span></div><time>{fmt(msg.created_at||msg.sent_at||msg.received_at)}</time></div>{msg.html?<iframe title={`Email ${i+1}`} sandbox="" srcDoc={msg.html}/>:<pre>{msg.text||msg.error||"No message body."}</pre>}{msg.attachments?.length>0&&<div className="attachments"><h3>Attachments</h3>{msg.attachments.map((a:any)=><div key={a.id||a.filename}>{a.filename||"Attachment"}</div>)}</div>}</section>)}

        {canSend&&folder!=="outbox"&&<div className="inlineReply"><div className="inlineReplyTop"><b>{inlineReplyAll?"Reply all":"Reply"}</b>{!inlineReply&&<div><button type="button" onClick={()=>reply(false)}>Reply</button><button type="button" onClick={()=>reply(true)}>Reply all</button></div>}</div>{inlineReply&&<><textarea autoFocus value={inlineBody} onChange={e=>setInlineBody(e.target.value)} placeholder="Write your reply…"/><div className="inlineReplyActions"><button type="button" onClick={()=>{setInlineReply(false);setInlineBody("")}}>Cancel</button><button type="button" className="primary" disabled={sending||!inlineBody.trim()} onClick={()=>void sendInlineReply()}>{sending?"Sending…":"Send reply"}</button></div></>}</div>}
      </article></>:<div className="readerEmpty"><div>✉</div><h2>Select an email</h2><p>The conversation opens here.</p></div>}
    </section>
  </div>

  {compose&&<div className="composeBackdrop"><section className="composer" role="dialog" aria-modal="true" aria-label="New email"><header><div><b>New message</b><span>From {address}</span></div><button type="button" onClick={()=>setCompose(false)} aria-label="Close composer">×</button></header><label><span>To</span><input autoFocus value={to} onChange={e=>setTo(e.target.value)}/></label><label><span>Cc</span><input value={cc} onChange={e=>setCc(e.target.value)}/></label><label><span>Bcc</span><input value={bcc} onChange={e=>setBcc(e.target.value)}/></label><label><span>Subject</span><input value={subject} onChange={e=>setSubject(e.target.value)}/></label><textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Write your message…"/><footer><button type="button" onClick={()=>setCompose(false)}>Cancel</button><button type="button" className="primary" disabled={sending} onClick={()=>void send()}>{sending?"Sending…":"Send"}</button></footer></section></div>}
 </main>
}
