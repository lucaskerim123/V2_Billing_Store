"use client";

import {FormEvent,useEffect,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";
import styles from "./support.module.css";

const guestDepartmentNames=new Set(["General Support","Sales Enquiries","Sales"]);
const departmentLabel=(name:string)=>name==="Sales Enquiries"?"Sales":name;
const pretty=(value:string)=>String(value||"").replaceAll("_"," ").replace(/\b\w/g,x=>x.toUpperCase());

export default function SupportPage(){
  const sb=createClient();
  const [user,setUser]=useState<any>(null),[departments,setDepartments]=useState<any[]>([]),[tickets,setTickets]=useState<any[]>([]),[message,setMessage]=useState(""),[submitting,setSubmitting]=useState(false);
  const [settings,setSettings]=useState<any>({enabled:true,guestEnabled:true,intro:""});
  const [guestCode,setGuestCode]=useState(""),[guestTicket,setGuestTicket]=useState<any>(null),[accessMessage,setAccessMessage]=useState(""),[accessing,setAccessing]=useState(false),[created,setCreated]=useState<any>(null),[replyText,setReplyText]=useState(""),[replying,setReplying]=useState(false);

  async function load(){
    const {data:{user:u}}=await sb.auth.getUser();
    setUser(u||null);
    const [d,s]=await Promise.all([
      sb.from("support_departments").select("id,name,description").eq("enabled",true).order("sort_order"),
      sb.from("app_settings").select("key,value").in("key",["support.enabled","support.guest_enabled","support.intro"])
    ]);
    const cfg=Object.fromEntries((s.data||[]).map((x:any)=>[x.key,x.value]));
    setSettings({enabled:cfg["support.enabled"]!==false,guestEnabled:cfg["support.guest_enabled"]!==false,intro:String(cfg["support.intro"]||"")});
    setDepartments((d.data||[]).filter((x:any)=>u||guestDepartmentNames.has(String(x.name))));
    if(u){const t=await sb.from("support_tickets").select("id,ticket_number,subject,status,priority,updated_at").eq("user_id",u.id).order("updated_at",{ascending:false});setTickets(t.data||[])}else setTickets([]);
  }
  useEffect(()=>{load()},[]);

  async function openGuestCode(codeOverride?:string){
    const code=String(codeOverride||guestCode).trim();
    if(!code){setAccessMessage("Enter your guest ticket code.");return}
    setAccessing(true);setAccessMessage("Opening ticket…");
    const r=await fetch("/api/support/guest-ticket",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"open",code})});
    const j=await r.json().catch(()=>({}));setAccessing(false);
    if(!r.ok){setGuestTicket(null);setAccessMessage(j.error||"Could not open that ticket.");return}
    setGuestCode(code);setGuestTicket(j);setAccessMessage("");
  }

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!settings.enabled){setMessage("Support is temporarily unavailable.");return}if(!user&&!settings.guestEnabled){setMessage("Guest support is currently disabled. Sign in to contact Support.");return}setSubmitting(true);setMessage("Opening ticket…");setCreated(null);
    const form=e.currentTarget,f=new FormData(form);const {data:{session}}=await sb.auth.getSession();
    const r=await fetch("/api/support/public-ticket",{method:"POST",headers:{"Content-Type":"application/json",...(session?.access_token?{Authorization:`Bearer ${session.access_token}`}:{})},body:JSON.stringify({name:f.get("name"),email:f.get("email"),department:f.get("department"),priority:f.get("priority"),subject:f.get("subject"),body:f.get("body")})});
    const j=await r.json().catch(()=>({}));setSubmitting(false);
    if(!r.ok){setMessage(j.error||"Could not open ticket.");return}
    form.reset();
    if(user){setMessage(j.message||"Ticket opened.");await load();return}
    setMessage("");setCreated(j);setGuestCode(j.access_code||"");
    if(j.access_code)await openGuestCode(j.access_code);
  }

  async function guestReply(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!replyText.trim()||!guestCode)return;
    setReplying(true);setAccessMessage("Sending reply…");
    const r=await fetch("/api/support/guest-ticket",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"reply",code:guestCode,body:replyText.trim()})});
    const j=await r.json().catch(()=>({}));setReplying(false);
    if(!r.ok){setAccessMessage(j.error||"Could not send reply.");return}
    setReplyText("");setAccessMessage("");await openGuestCode(guestCode);
  }

  async function copyCode(){if(created?.access_code)await navigator.clipboard?.writeText(created.access_code).catch(()=>null)}
  const guest=!user;

  return <main className={styles.page}>
    <header className={styles.nav}>
      <Link href="/" className={styles.brand}><span className={styles.mark} aria-hidden="true"/><span>OrbitFS</span></Link>
      <nav className={styles.navlinks}><Link href="/support/knowledge-base">Knowledge Base</Link><Link href="/news">News</Link><Link href="/">Store</Link>{user?<Link className={styles.navButton} href="/portal">Customer Portal</Link>:<Link className={styles.navButton} href="/login">Sign in</Link>}</nav>
    </header>

    <section className={styles.hero}>
      <div><p className={styles.eyebrow}>OrbitFS Support</p><h1>{guest?<>Support without <span>needing an account.</span></>:<>Your OrbitFS <span>support centre.</span></>}</h1><p className={styles.lead}>{settings.intro||(guest?"Open a basic support request with General Support or Sales. You’ll receive a private ticket code so you can come back, read replies and continue the conversation without signing in.":"Open a new request, track your active tickets and continue conversations with OrbitFS Support.")}</p></div>
      <div className={styles.heroSide}>{guest?<><div className={styles.heroFact}><b>General Support</b><span>Help with OrbitFS, account questions and general enquiries.</span></div><div className={styles.heroFact}><b>Sales</b><span>Questions before purchasing, products, licensing and availability.</span></div><div className={styles.heroFact}><b>48-hour guest access</b><span>Guest tickets and their conversation are automatically removed after 2 days.</span></div></>:<><div className={styles.heroFact}><b>Account-linked tickets</b><span>Your support history stays connected to your OrbitFS account.</span></div><div className={styles.heroFact}><b>Full support access</b><span>Use the departments and priority levels available to your account.</span></div></>}</div>
    </section>

    <section className={styles.shell}>
      {user&&<div className={styles.accountBar}><span>Signed in as <b>{user.email}</b></span><Link className={styles.navButton} href="/portal">Return to Customer Portal →</Link></div>}

      {guest&&created?.access_code&&<section className={styles.successCard}><div className={styles.successTop}><div><h3>Ticket #{created.ticket_number} created</h3><p>Save this code. It is the key to opening and replying to this guest ticket for the next 48 hours.</p></div><button className={styles.copy} onClick={copyCode}>Copy code</button></div><div className={styles.accessCode}>{created.access_code}</div><div className={styles.successActions}><button className={styles.primary} onClick={()=>openGuestCode(created.access_code)}>Open ticket</button><span className={styles.notice}>Expires {created.expires_at?new Date(created.expires_at).toLocaleString("en-AU"):"48 hours after creation"}.</span></div></section>}

      {!settings.enabled&&<section className={styles.successCard}><div><h3>Support is temporarily unavailable</h3><p>New tickets and replies are paused by OrbitFS administration.</p></div></section>}
      {guest&&settings.enabled&&!settings.guestEnabled&&<section className={styles.successCard}><div><h3>Guest support is disabled</h3><p>Sign in to your OrbitFS account to contact Support.</p></div></section>}
      <div className={styles.grid}>
        <section className={styles.card}><div className={styles.cardHead}><h2>{guest?"Open a guest ticket":"Open a support ticket"}</h2><p>{guest?"Basic support is available through General Support and Sales only.":"Tell us what you need help with and choose the best department."}</p></div><div className={styles.cardBody}><form className={styles.form} onSubmit={submit}>{guest&&<div className={styles.row2}><div className={styles.field}><label>Your name</label><input name="name" autoComplete="name" placeholder="Name" required/></div><div className={styles.field}><label>Email address</label><input name="email" type="email" autoComplete="email" placeholder="you@example.com" required/></div></div>}<div className={styles.row2}><div className={styles.field}><label>Department</label><select name="department" required defaultValue=""><option value="">Choose support type</option>{departments.map(d=><option key={d.id} value={d.id}>{departmentLabel(String(d.name))}</option>)}</select></div>{user&&<div className={styles.field}><label>Priority</label><select name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>}</div><div className={styles.field}><label>Subject</label><input name="subject" placeholder="What do you need help with?" required/></div><div className={styles.field}><label>Message</label><textarea name="body" rows={8} placeholder="Give us the details so we can help…" required/></div><button className={styles.primary} disabled={submitting||!settings.enabled||(guest&&!settings.guestEnabled)}>{submitting?"Opening ticket…":"Open ticket"}</button>{message&&<p className={`${styles.notice} ${message.toLowerCase().includes("could")||message.toLowerCase().includes("required")?styles.error:""}`}>{message}</p>}</form></div></section>

        <aside className={styles.card}>{guest?<><div className={styles.cardHead}><h2>Open an existing ticket</h2><p>Already contacted us? Enter the private code you received when the ticket was created.</p></div><div className={styles.cardBody}><div className={styles.accessWrap}><div className={styles.codeForm}><input className={styles.codeInput} value={guestCode} onChange={e=>setGuestCode(e.target.value.toUpperCase())} onKeyDown={e=>{if(e.key==="Enter")openGuestCode()}} placeholder="XX-XX-XX" autoComplete="off"/><button className={styles.primary} onClick={()=>openGuestCode()} disabled={accessing}>{accessing?"Opening…":"Open ticket"}</button></div>{accessMessage&&<p className={`${styles.notice} ${accessMessage.toLowerCase().includes("could")||accessMessage.toLowerCase().includes("invalid")||accessMessage.toLowerCase().includes("expired")?styles.error:""}`}>{accessMessage}</p>}<div className={styles.accessHelp}><span><strong>No account required.</strong> Your code only opens the guest ticket it belongs to.</span><span><strong>Guest support is temporary.</strong> The ticket is automatically deleted after 48 hours.</span><span><strong>Need long-term history?</strong> Create an account and use normal account-linked support.</span></div><div className={styles.quickLinks}><Link className={styles.quickLink} href="/support/knowledge-base"><b>Knowledge Base</b><span>Check guides and common answers first.</span></Link><Link className={styles.quickLink} href="/register"><b>Create account</b><span>Keep support history and access full customer features.</span></Link></div></div></div></>:<><div className={styles.cardHead}><h2>Your tickets</h2><p>Recent support requests attached to your OrbitFS account.</p></div><div className={styles.cardBody}><div className={styles.ticketList}>{tickets.length?tickets.map(t=><Link className={styles.ticketItem} href={`/support/${t.id}`} key={t.id}><div><b>#{t.ticket_number} · {t.subject}</b><span>{pretty(t.status)} · {pretty(t.priority)} · updated {new Date(t.updated_at).toLocaleDateString("en-AU")}</span></div><em>View →</em></Link>):<p className={styles.notice}>You have no support tickets yet.</p>}</div></div></>}</aside>
      </div>

      {guest&&guestTicket?.ticket&&<section className={styles.ticketView}><header className={styles.ticketHeader}><div><p className={styles.eyebrow}>Guest ticket #{guestTicket.ticket.ticket_number}</p><h2>{guestTicket.ticket.subject}</h2><div className={styles.ticketMeta}><span className={styles.pill}>{pretty(guestTicket.ticket.status)}</span><span className={styles.pill}>{guestTicket.ticket.department}</span><span className={`${styles.pill} ${styles.expiry}`}>Deletes {new Date(guestTicket.ticket.expires_at).toLocaleString("en-AU")}</span></div></div><button className={styles.secondary} onClick={()=>{setGuestTicket(null);setAccessMessage("")}}>Close view</button></header><div className={styles.thread}>{(guestTicket.messages||[]).length?(guestTicket.messages||[]).map((m:any)=><article key={m.id} className={`${styles.message} ${m.author_role!=="user"?styles.messageStaff:""}`}><div className={styles.messageHead}><b>{m.author_role==="user"?"You":"OrbitFS Support"}</b><span>{new Date(m.created_at).toLocaleString("en-AU")}</span></div><p>{m.body}</p></article>):<p className={styles.notice}>No conversation messages found.</p>}</div><form className={styles.reply} onSubmit={guestReply}><h3>Reply to OrbitFS Support</h3><textarea className={styles.replyBox} value={replyText} onChange={e=>setReplyText(e.target.value)} placeholder="Write your reply…" required/><div className={styles.replyActions}><span>Basic guest support · General Support / Sales · expires after 48 hours</span><button className={styles.primary} disabled={replying}>{replying?"Sending…":"Send reply"}</button></div></form></section>}
    </section>

    <footer className={styles.footer}><span>OrbitFS Support · guest requests are temporary and limited to basic support.</span><nav><Link href="/support/knowledge-base">Knowledge Base</Link><Link href="/news">News</Link><Link href="/">OrbitFS</Link></nav></footer>
  </main>
}
