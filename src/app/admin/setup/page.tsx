"use client";
import {FormEvent,useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {createClient} from "@/lib/supabase";

export default function AdminSetupPage(){
 const router=useRouter();
 const sb=useMemo(()=>createClient(),[]);
 const [available,setAvailable]=useState<boolean|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;(async()=>{const {data:{user}}=await sb.auth.getUser();if(user){router.replace("/admin");return}const r=await fetch("/api/admin/bootstrap",{cache:"no-store"});const j=await r.json().catch(()=>({}));if(live)setAvailable(!!j.available)})();return()=>{live=false}},[router,sb]);
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy)return;setBusy(true);setMessage("");
  const f=new FormData(e.currentTarget),email=String(f.get("email")||""),password=String(f.get("password")||""),name=String(f.get("name")||"");
  const r=await fetch("/api/admin/bootstrap",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password,name})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){setMessage(j.error||"Administrator setup failed.");setBusy(false);return;}
  const {error}=await sb.auth.signInWithPassword({email,password});
  if(error){setMessage(`Administrator created, but sign in failed: ${error.message}`);setBusy(false);return;}
  router.replace("/admin");router.refresh();
 }
 if(available===false)return <main className="orbitAuthPage orbitAuthAdmin"><section className="orbitAuthCard" style={{margin:"8vh auto"}}><div className="orbitAuthAdminBadge">Setup complete</div><p className="orbitAuthEyebrow" style={{marginTop:18}}>Billing Store administration</p><h1>Administrator already configured</h1><p className="orbitAuthDescription">The first administrator has already been created. Use the normal admin sign-in page.</p><Link className="orbitAuthSubmit" href="/admin/login">Go to admin sign in <span>→</span></Link></section></main>;
 if(available===null)return <main className="orbitAuthPage orbitAuthAdmin"><section className="orbitAuthCard" style={{margin:"8vh auto"}}><h1>Checking setup…</h1></section></main>;
 return <main className="orbitAuthPage orbitAuthAdmin">
  <header className="orbitAuthTop"><Link className="orbitAuthBrand" href="/"><span className="orbitAuthMark" aria-hidden="true"/><span>OrbitFS Billing Store</span></Link><nav className="orbitAuthNav"><Link href="/">Public site</Link><Link href="/login">Customer sign in</Link></nav></header>
  <div className="orbitAuthStage">
   <section className="orbitAuthStory"><p className="orbitAuthEyebrow">First deployment</p><h2>Set up the<br/><span>store administrator.</span></h2><p>This creates the first Billing Store administrator and locks the bootstrap once an administrator exists.</p><p className="orbitAuthStoryFoot">Initial admin · Staff permissions · Store control</p></section>
   <section className="orbitAuthCard"><div className="orbitAuthAdminBadge">Initial setup</div><p className="orbitAuthEyebrow" style={{marginTop:18}}>Billing Store administration</p><h1>Create administrator</h1><p className="orbitAuthDescription">Use the account you want to own and manage this Billing Store. This setup is available only before the first staff account exists.</p>
    <form onSubmit={submit} className="orbitAuthForm">
     <label className="orbitAuthFieldLabel">Name<span className="orbitAuthField"><span className="orbitAuthFieldIcon">N</span><input name="name" type="text" autoComplete="name" placeholder="Your name" required/></span></label>
     <label className="orbitAuthFieldLabel">Administrator email<span className="orbitAuthField"><span className="orbitAuthFieldIcon">@</span><input name="email" type="email" autoComplete="email" placeholder="admin@example.com" required/></span></label>
     <label className="orbitAuthFieldLabel">Password<span className="orbitAuthField"><span className="orbitAuthFieldIcon">●</span><input name="password" type="password" autoComplete="new-password" placeholder="At least 8 characters" minLength={8} required/></span></label>
     <button className="orbitAuthSubmit" type="submit" disabled={busy}>{busy?"Creating administrator…":"Create administrator"}<span aria-hidden="true">→</span></button>
    </form>
    {message&&<p className="orbitAuthMessage" role="alert">{message}</p>}
    <p className="orbitAuthAdminNotice">The administrator receives Superadmin access to the Billing Store. The account is confirmed immediately so you can enter the admin area after setup.</p>
   </section>
  </div>
 </main>
}
