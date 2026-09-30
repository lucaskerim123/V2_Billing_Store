"use client";
import {FormEvent,useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {createClient} from "@/lib/supabase";

export default function RegisterPage(){
 const [message,setMessage]=useState("");
 const [id,setId]=useState<any>({site_name:"OrbitFS",register_title:"Create your OrbitFS account"});
 const sb=useMemo(()=>createClient(),[]);
 useEffect(()=>{sb.from('app_settings').select('key,value').eq('category','identity').then(({data})=>{const m=Object.fromEntries((data||[]).map((x:any)=>[x.key.split('.').pop(),x.value]));setId((v:any)=>({...v,...m}));document.title=m.register_title||`Create account · ${m.site_name||'OrbitFS'}`})},[sb]);
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setMessage("Creating account…");const form=new FormData(e.currentTarget),payload={first_name:String(form.get("first_name")||"").trim(),last_name:String(form.get("last_name")||"").trim(),username:String(form.get("username")||""),email:String(form.get("email")||""),password:String(form.get("password")||"")};const r=await fetch('/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),d=await r.json();setMessage(r.ok?(d.message||"Account created. Check your email to verify it."):(d.error||"Could not create account."))}
 return <main className="orbitAuthPage orbitAuthRegister">
  <header className="orbitAuthTop">
   <Link className="orbitAuthBrand" href="/"><span className="orbitAuthMark" aria-hidden="true"/><span>{id.site_name||"OrbitFS"}</span></Link>
   <nav className="orbitAuthNav"><Link href="/">Home</Link><Link href="/#components">Components</Link><Link href="/support">Support</Link><Link className="orbitAuthNavCta" href="/login">Sign in</Link></nav>
  </header>
  <div className="orbitAuthStage">
   <section className="orbitAuthStory">
    <p className="orbitAuthEyebrow">Join OrbitFS</p>
    <h2>Create the account behind<br/><span>your OrbitFS system.</span></h2>
    <p>Your OrbitFS account connects Base, licensed components, downloads, support and account services without turning the product itself into a billing platform.</p>
    <div className="orbitAuthOrbitVisual" aria-hidden="true"><span className="orbitAuthRing"/><span className="orbitAuthRing orbitAuthRingTwo"/><span className="orbitAuthPlanet"/><span className="orbitAuthTile orbitAuthTileOne">BASE</span><span className="orbitAuthTile orbitAuthTileTwo">ADD-ONS</span><span className="orbitAuthTile orbitAuthTileThree">ACCOUNT</span></div>
    <p className="orbitAuthStoryFoot">One account · Your components · Your OrbitFS access</p>
   </section>
   <section className="orbitAuthCard">
    <p className="orbitAuthEyebrow">Create account</p>
    <h1>{id.register_title||"Create your OrbitFS account"}</h1>
    <p className="orbitAuthDescription">Enter your name, then choose a username, email and password for your OrbitFS account.</p>
    <form onSubmit={submit} className="orbitAuthForm">
     <div className="two"><label className="orbitAuthFieldLabel">First name<span className="orbitAuthField"><input name="first_name" autoComplete="given-name" placeholder="First name" maxLength={100} required/></span></label><label className="orbitAuthFieldLabel">Last name<span className="orbitAuthField"><input name="last_name" autoComplete="family-name" placeholder="Last name" maxLength={100} required/></span></label></div>
     <label className="orbitAuthFieldLabel">Username<span className="orbitAuthField"><span className="orbitAuthFieldIcon">◎</span><input name="username" autoComplete="username" placeholder="Choose a username" minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]+" title="Use 3–32 letters, numbers, dots, underscores or hyphens." required/></span></label>
     <label className="orbitAuthFieldLabel">Email address<span className="orbitAuthField"><span className="orbitAuthFieldIcon">@</span><input name="email" type="email" autoComplete="email" placeholder="you@example.com" required/></span></label>
     <label className="orbitAuthFieldLabel">Password<span className="orbitAuthField"><span className="orbitAuthFieldIcon">●</span><input name="password" type="password" minLength={8} autoComplete="new-password" placeholder="Minimum 8 characters" required/></span></label>
     <button className="orbitAuthSubmit" type="submit">Create account <span aria-hidden="true">→</span></button>
    </form>
    {message&&<p className="orbitAuthMessage" role="status">{message}</p>}
    <div className="orbitAuthDivider">Already registered?</div>
    <p className="orbitAuthSwitch"><Link href="/login">Sign in to your existing account</Link></p>
    <div className="orbitAuthTrust" aria-label="Platform features"><span>◎<small>SECURE ACCOUNT</small></span><span>◇<small>BASE + ADD-ONS</small></span><span>⌁<small>LICENCE ACCESS</small></span></div>
   </section>
  </div>
 </main>
}
