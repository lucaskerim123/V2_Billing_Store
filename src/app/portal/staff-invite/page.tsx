"use client";
import {Suspense,useEffect,useState} from "react";
import {useSearchParams} from "next/navigation";
import Link from "next/link";
import {createClient} from "@/lib/supabase";
function StaffInvitationAcceptanceInner(){
 const params=useSearchParams(),token=params.get("token")||"";
 const [sb]=useState(()=>createClient()),[email,setEmail]=useState(""),[status,setStatus]=useState(""),[busy,setBusy]=useState(false),[authenticated,setAuthenticated]=useState(false);
 useEffect(()=>{let valid=true;(async()=>{const {data:{user}}=await sb.auth.getUser();if(valid){setEmail(user?.email||"");setAuthenticated(Boolean(user))}})();return()=>{valid=false}},[sb]);
 async function accept(){if(!token||busy)return;setBusy(true);setStatus("");const {error}=await sb.rpc("accept_staff_invitation",{p_token:token});setBusy(false);if(error){setStatus(error.message);return}setStatus("Staff access activated. Your customer account and staff groups are now linked.");window.history.replaceState(null,"","/portal/staff-invite")}
 return <main className="portalPage" style={{maxWidth:680,margin:"50px auto",padding:"16px"}}><section className="panel" style={{padding:24}}><p className="eyebrow">ORBITFS · STAFF INVITATION</p><h1>Accept staff invitation</h1><p>Staff access is added to your existing customer account only after you accept this invitation.</p>{!token?<p role="alert">Invitation token missing or already used.</p>:!authenticated?<><p>Sign in or register with the invited email address to continue.</p><Link href={`/login?next=${encodeURIComponent("/portal/staff-invite?token="+token)}`}>Sign in to customer account</Link></>:<><p>Signed in as <strong>{email}</strong>.</p><button type="button" disabled={busy} onClick={()=>void accept()}>{busy?"Accepting…":"Accept staff invitation"}</button></>}{status&&<p role="status">{status}</p>}<p><Link href="/portal">Return to customer portal</Link></p></section></main>;
}
export default function StaffInvitationAcceptance(){return <Suspense fallback={<main className="portalPage">Loading invitation…</main>}><StaffInvitationAcceptanceInner/></Suspense>}
