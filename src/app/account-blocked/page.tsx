"use client";
import Link from "next/link";
import {useEffect,useState} from "react";

export default function AccountBlocked(){
 const [d,setD]=useState<any>(null);
 useEffect(()=>{try{
  const raw=localStorage.getItem("orbitfs_account_blocked")||sessionStorage.getItem("orbitfs_account_blocked");
  if(!raw){setD({missing:true});return}
  const parsed=JSON.parse(raw);
  if(parsed?.expires_at&&new Date(parsed.expires_at).getTime()<=Date.now()){localStorage.removeItem("orbitfs_account_blocked");sessionStorage.removeItem("orbitfs_account_blocked");setD({expired:true});return}
  setD(parsed);
 }catch{setD({missing:true})}},[]);
 if(!d)return <main className="shell narrow"><section className="panel"><p>Loading account status…</p></section></main>;
 if(d.expired)return <main className="shell narrow"><section className="panel"><p className="eyebrow">ACCOUNT ACCESS</p><h1>Termination period ended</h1><p>The stored termination period has expired. Sign in again so OrbitFS can confirm your current account status.</p><div className="inlineActions"><Link className="buttonlink" href="/login">Sign in</Link><Link className="buttonlink secondary" href="/support">Contact support</Link></div></section></main>;
 const expiry=d.expires_at?new Date(d.expires_at).toLocaleString():"Permanent";
 return <main className="shell narrow"><section className="panel"><p className="eyebrow">ACCOUNT ACCESS</p><h1>OrbitFS account terminated</h1><p>Your account cannot sign in or use OrbitFS licences while this termination is active.</p>{d.missing?<div className="notice"><b>Account restriction details unavailable on this device</b><span>Sign in again to reload the current termination reason and expiry, or contact OrbitFS Support.</span></div>:<><div className="notice"><b>Reason</b><span>{d.reason||"No reason provided."}</span></div><div className="listrow"><b>Termination expiry</b><span>{expiry}</span></div></>}<p>For help, contact OrbitFS Support by opening a support ticket or emailing <a href="mailto:support@orbitfs.cc">support@orbitfs.cc</a>.</p><div className="inlineActions"><Link className="buttonlink" href="/support">Open support</Link><Link className="buttonlink secondary" href="/login">Back to sign in</Link></div></section></main>
}