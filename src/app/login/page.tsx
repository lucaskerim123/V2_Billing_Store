"use client";
import {FormEvent,useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {createClient} from "@/lib/supabase";

export default function LoginPage(){
 const [message,setMessage]=useState("");
 const [unverifiedEmail,setUnverifiedEmail]=useState("");
 const [id,setId]=useState<any>({site_name:"OrbitFS",login_title:"Welcome back"});
 const router=useRouter();
 const sb=useMemo(()=>createClient(),[]);
 useEffect(()=>{sb.from('app_settings').select('key,value').eq('category','identity').then(({data})=>{const m=Object.fromEntries((data||[]).map((x:any)=>[x.key.split('.').pop(),x.value]));setId((v:any)=>({...v,...m}));document.title=m.login_title||`Sign in · ${m.site_name||'OrbitFS'}`})},[sb]);
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setMessage("");setUnverifiedEmail("");
  const f=new FormData(e.currentTarget),email=String(f.get("email")||"").trim().toLowerCase(),password=String(f.get("password")||"");
  const r=await fetch("/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok){setMessage(d.error||"Could not sign in.");if(r.status===403)setUnverifiedEmail(email);return;}
  try{localStorage.removeItem("orbitfs_account_blocked");sessionStorage.removeItem("orbitfs_account_blocked")}catch{}
  router.push("/portal");
 }
 async function resendVerification(){if(!unverifiedEmail)return;setMessage("Sending a new verification email…");const r=await fetch("/api/auth/email-verification/resend",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:unverifiedEmail})});const d=await r.json().catch(()=>({}));setMessage(d.message||"If the account still needs verification, a new email has been sent.")}
 return <main className="orbitAuthPage orbitAuthCustomer">
  <header className="orbitAuthTop">
   <Link className="orbitAuthBrand" href="/"><span className="orbitAuthMark" aria-hidden="true"/><span>{id.site_name||"OrbitFS"}</span></Link>
   <nav className="orbitAuthNav"><Link href="/">Home</Link><Link href="/#components">Components</Link><Link href="/support">Support</Link><Link className="orbitAuthNavCta" href="/register">Create account</Link></nav>
  </header>
  <div className="orbitAuthStage">
   <section className="orbitAuthStory">
    <p className="orbitAuthEyebrow">OrbitFS account</p>
    <h2>Your OrbitFS system.<br/><span>One connected account.</span></h2>
    <p>Access your OrbitFS Base setup, licensed components, downloads, support and account services from one secure identity.</p>
    <div className="orbitAuthOrbitVisual" aria-hidden="true"><span className="orbitAuthRing"/><span className="orbitAuthRing orbitAuthRingTwo"/><span className="orbitAuthPlanet"/><span className="orbitAuthTile orbitAuthTileOne">BASE</span><span className="orbitAuthTile orbitAuthTileTwo">COMPONENTS</span><span className="orbitAuthTile orbitAuthTileThree">SUPPORT</span></div>
    <p className="orbitAuthStoryFoot">Base system · Component access · Account support</p>
   </section>
   <section className="orbitAuthCard">
    <p className="orbitAuthEyebrow">OrbitFS sign in</p>
    <h1>{id.login_title||"Welcome back"}</h1>
    <p className="orbitAuthDescription">Sign in to access your OrbitFS account, licences, downloads, support and connected components.</p>
    <form onSubmit={submit} className="orbitAuthForm">
     <label className="orbitAuthFieldLabel">Email address<span className="orbitAuthField"><span className="orbitAuthFieldIcon">@</span><input name="email" type="email" autoComplete="email" placeholder="you@example.com" required/></span></label>
     <label className="orbitAuthFieldLabel">Password<span className="orbitAuthField"><span className="orbitAuthFieldIcon">●</span><input name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required/></span></label>
     <div className="orbitAuthFormMeta"><span/><Link href="/reset-password">Forgot your password?</Link></div>
     <button className="orbitAuthSubmit" type="submit">Sign in <span aria-hidden="true">→</span></button>
    </form>
    {message&&<p className="orbitAuthMessage" role="alert">{message}</p>}
    {unverifiedEmail&&<button className="orbitAuthSubmit" type="button" onClick={resendVerification}>Resend verification email <span aria-hidden="true">→</span></button>}
    <div className="orbitAuthDivider">New to OrbitFS?</div>
    <p className="orbitAuthSwitch">Create your OrbitFS account. <Link href="/register">Create account</Link></p>
    <p className="orbitAuthSupport"><Link href="/support">Contact support without an account</Link></p>
    <div className="orbitAuthTrust" aria-label="Platform features"><span>◎<small>SECURE ACCOUNT</small></span><span>◇<small>COMPONENT ACCESS</small></span><span>⌁<small>LICENCE ACCESS</small></span></div>
   </section>
  </div>
 </main>
}
