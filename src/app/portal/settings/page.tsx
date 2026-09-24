"use client";

import {FormEvent,useEffect,useState} from "react";
import {createClient} from "@/lib/supabase";
import {trackCustomerActivity} from "@/lib/customer-activity";

const money=(cents:any)=>new Intl.NumberFormat("en-AU",{style:"currency",currency:"AUD"}).format(Number(cents||0)/100);
type Tab="profile"|"billing"|"wallet"|"preferences"|"security";
type WalletBusy="topup"|"coupon"|null;
const validTabs:Tab[]=["profile","billing","wallet","preferences","security"];

export default function Settings(){
 const sb=createClient();
 const [tab,setTab]=useState<Tab>("profile"),[profile,setProfile]=useState<any>(),[customer,setCustomer]=useState<any>();
 const [prefs,setPrefs]=useState<any>({theme:"system",accent:"blue",locale:"en-AU",email_news:true,email_support:true,email_orders:true});
 const [wallet,setWallet]=useState<any>({available_cents:0}),[ledger,setLedger]=useState<any[]>([]),[recharges,setRecharges]=useState<any[]>([]),[walletGateways,setWalletGateways]=useState<any[]>([]);
 const [walletAmount,setWalletAmount]=useState("20.00"),[walletCoupon,setWalletCoupon]=useState(""),[walletGateway,setWalletGateway]=useState(""),[walletMsg,setWalletMsg]=useState(""),[walletBusy,setWalletBusy]=useState<WalletBusy>(null),[openReceipt,setOpenReceipt]=useState<string|null>(null);
 const [billingCfg,setBillingCfg]=useState<any>({allowCredit:true,topups:true,minTopup:500,maxTopup:100000});
 const [msg,setMsg]=useState(""),[pw,setPw]=useState({current:"",next:"",confirm:""});

 async function load(){
  const {data:{user}}=await sb.auth.getUser();if(!user)return;
  const [{data:p},{data:c},{data:x},{data:b},{data:l},{data:r},{data:g},{data:s}]=await Promise.all([
   sb.from("user_profiles").select("*").eq("id",user.id).single(),
   sb.from("customers").select("id,customer_number,email,name,auth_user_id").eq("auth_user_id",user.id).maybeSingle(),
   sb.from("user_preferences").select("*").eq("user_id",user.id).maybeSingle(),
   sb.from("account_balances").select("*").eq("user_id",user.id).maybeSingle(),
   sb.from("credit_ledger").select("*").eq("user_id",user.id).order("created_at",{ascending:false}).limit(20),
   sb.from("wallet_recharges").select("*").eq("auth_user_id",user.id).order("created_at",{ascending:false}).limit(30),
   sb.rpc("wallet_recharge_gateways"),
   sb.from("app_settings").select("key,value").in("key",["billing.allow_account_credit","billing.credit_topups_enabled","billing.minimum_credit_topup_cents","billing.maximum_credit_topup_cents"])
  ]);
  const cfg=Object.fromEntries((s||[]).map((x:any)=>[x.key,x.value]));
  setBillingCfg({allowCredit:cfg["billing.allow_account_credit"]!==false,topups:cfg["billing.credit_topups_enabled"]!==false,minTopup:Number(cfg["billing.minimum_credit_topup_cents"]||500),maxTopup:Number(cfg["billing.maximum_credit_topup_cents"]||100000)});
  setProfile({...p,email:user.email});setCustomer(c||null);if(x)setPrefs(x);setWallet(b||{available_cents:0});setLedger(l||[]);setRecharges(r||[]);
  const gateways=Array.isArray(g)?g:[];setWalletGateways(gateways);setWalletGateway(v=>v&&gateways.some((z:any)=>z.code===v)?v:(gateways[0]?.code||""));
 }
 useEffect(()=>{const q=new URLSearchParams(location.search),requested=q.get("tab") as Tab|null;if(requested&&validTabs.includes(requested))setTab(requested);const result=q.get("recharge");if(result==="success")setWalletMsg("Wallet recharge completed. Your balance and recharge receipt are now updated.");else if(result==="cancelled")setWalletMsg("Wallet recharge checkout was cancelled. No funds were added.");else if(result==="error")setWalletMsg(q.get("payment_error")||"Wallet recharge payment could not be completed.");load()},[]);

 async function save(e?:FormEvent){
  e?.preventDefault();setMsg("Saving…");
  const {data:{user}}=await sb.auth.getUser();if(!user)return;
  const [{error:a},{error:b}]=await Promise.all([
   sb.from("user_profiles").update({first_name:profile.first_name,last_name:profile.last_name,display_name:profile.display_name,company_name:profile.company_name,phone:profile.phone,address_line1:profile.address_line1,address_line2:profile.address_line2,city:profile.city,state_region:profile.state_region,postal_code:profile.postal_code,country_code:profile.country_code,timezone:profile.timezone,language:profile.language}).eq("id",user.id),
   sb.from("user_preferences").upsert({...prefs,user_id:user.id,updated_at:new Date().toISOString()})
  ]);
  setMsg(a?.message||b?.message||"Settings saved.");
  await trackCustomerActivity("account.settings_updated",{entityType:"account",entityId:user.id,success:!a&&!b});
  if(!a&&!b)await load();
 }

 async function changePassword(){
  if(pw.next.length<8)return setMsg("New password must be at least 8 characters.");
  if(pw.next!==pw.confirm)return setMsg("New passwords do not match.");
  const {data:{user}}=await sb.auth.getUser();if(!user?.email)return;
  const {error:verify}=await sb.auth.signInWithPassword({email:user.email,password:pw.current});if(verify)return setMsg("Current password is incorrect.");
  const {error}=await sb.auth.updateUser({password:pw.next});setMsg(error?.message||"Password changed successfully.");
  if(!error){setPw({current:"",next:"",confirm:""});await trackCustomerActivity("account.password_changed",{source:"security",entityType:"account",entityId:user.id})}
 }

 async function addFunds(){
  if(walletBusy)return;
  const dollars=Number(walletAmount),cents=Math.round(dollars*100);
  if(!Number.isFinite(dollars))return setWalletMsg("Enter a valid recharge amount.");
  if(!billingCfg.topups)return setWalletMsg("Wallet top-ups are currently disabled.");
  if(cents<billingCfg.minTopup)return setWalletMsg(`Minimum Wallet recharge is ${money(billingCfg.minTopup)}.`);
  if(cents>billingCfg.maxTopup)return setWalletMsg(`Maximum Wallet recharge is ${money(billingCfg.maxTopup)}.`);
  if(!walletGateway)return setWalletMsg("Choose a payment gateway.");
  setWalletBusy("topup");setWalletMsg("Creating Wallet recharge receipt…");
  const {data:recharge,error:createError}=await sb.rpc("create_wallet_recharge",{p_amount_cents:cents});
  if(createError){setWalletBusy(null);return setWalletMsg(createError.message)}
  const {data:attempt,error:startError}=await sb.rpc("start_wallet_recharge_payment",{p_recharge_id:recharge.recharge_id,p_gateway_code:walletGateway});
  if(startError){setWalletBusy(null);await load();return setWalletMsg(startError.message)}
  if(attempt?.status==="succeeded"){setWalletBusy(null);setWalletMsg("Wallet recharge is already complete.");await load();return}
  const {data:{session}}=await sb.auth.getSession();if(!session?.access_token){setWalletBusy(null);return setWalletMsg("Your session expired. Sign in again before recharging your Wallet.")}
  setWalletMsg(`Opening ${walletGateways.find((g:any)=>g.code===walletGateway)?.name||walletGateway}…`);
  const res=await fetch("/api/wallet/recharge/start",{method:"POST",headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({attempt_id:attempt.attempt_id})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||!data?.url){setWalletBusy(null);await load();return setWalletMsg(data?.error||"Unable to open the payment gateway.")}
  location.assign(data.url);
 }

 async function redeem(){
  if(walletBusy)return;
  const code=walletCoupon.trim().toUpperCase();if(!code)return setWalletMsg("Enter a Wallet coupon code.");
  setWalletBusy("coupon");setWalletMsg("Redeeming Wallet coupon…");
  const {data,error}=await sb.rpc("redeem_wallet_coupon",{p_coupon_code:code});
  if(error){setWalletBusy(null);return setWalletMsg(error.message)}
  setWalletCoupon("");setWalletMsg(`${data.code} added ${money(data.credit_cents)} to your Wallet.`);await load();setWalletBusy(null);
 }

 if(!profile)return <section>Loading settings…</section>;
 const tabs:[Tab,string][]=[["profile","Profile"],["billing","Billing details"],["wallet","Wallet"],["preferences","Preferences"],["security","Security"]];
 const customerId=customer?.customer_number||profile?.customer_number||"—";
 const gatewayName=(code:string)=>walletGateways.find((g:any)=>g.code===code)?.name||code||"Not selected";
 const statusLabel=(status:string)=>({action_required:"Awaiting payment",processing:"Processing",succeeded:"Paid",failed:"Failed",cancelled:"Cancelled",expired:"Expired",refunded:"Refunded",pending:"Pending"} as any)[status]||status;

 return <div className="accountSettingsV2">
  <header className="accountSettingsHero"><div><p className="eyebrow">MY ACCOUNT</p><h1>Account settings</h1><p className="muted">Manage your details, billing information, Wallet, preferences and security.</p></div><div className="accountIdentity"><small>CUSTOMER ID</small><b>{customerId}</b><span>{profile.email}</span></div></header>
  <nav className="accountSettingsNav" role="tablist" aria-label="Account settings sections">{tabs.map(([k,l])=><button type="button" role="tab" aria-selected={tab===k} className={tab===k?"active":""} onClick={()=>{setMsg("");setWalletMsg("");setTab(k)}} key={k}>{l}</button>)}</nav>

  {(tab==="profile"||tab==="billing"||tab==="preferences")&&<form onSubmit={save} className="accountSettingsSections">
   {tab==="profile"&&<section className="panel accountSettingsCard"><div className="settingsSectionHead"><div><p className="eyebrow">PROFILE</p><h2>Personal details</h2><p className="muted">Used across your OrbitFS account, customer record and invoice presentation.</p></div></div><div className="form"><div className="two"><label>First name<input value={profile.first_name||""} onChange={e=>setProfile({...profile,first_name:e.target.value})}/></label><label>Last name<input value={profile.last_name||""} onChange={e=>setProfile({...profile,last_name:e.target.value})}/></label></div><label>Display name<input value={profile.display_name||""} onChange={e=>setProfile({...profile,display_name:e.target.value})}/></label><div className="two"><label>Company<input value={profile.company_name||""} onChange={e=>setProfile({...profile,company_name:e.target.value})}/></label><label>Phone<input value={profile.phone||""} onChange={e=>setProfile({...profile,phone:e.target.value})}/></label></div><label>Email<input value={profile.email||""} disabled/></label><div className="settingsReadOnlyRow"><span>Customer ID</span><b>{customerId}</b></div></div></section>}

   {tab==="billing"&&<section className="panel accountSettingsCard"><div className="settingsSectionHead"><div><p className="eyebrow">BILLING</p><h2>Billing details</h2><p className="muted">These fields are the canonical customer billing details used on invoices.</p></div></div><div className="form"><label>Address line 1<input value={profile.address_line1||""} onChange={e=>setProfile({...profile,address_line1:e.target.value})}/></label><label>Address line 2<input value={profile.address_line2||""} onChange={e=>setProfile({...profile,address_line2:e.target.value})}/></label><div className="two"><label>City<input value={profile.city||""} onChange={e=>setProfile({...profile,city:e.target.value})}/></label><label>State / region<input value={profile.state_region||""} onChange={e=>setProfile({...profile,state_region:e.target.value})}/></label></div><div className="two"><label>Postcode<input value={profile.postal_code||""} onChange={e=>setProfile({...profile,postal_code:e.target.value})}/></label><label>Country code<input value={profile.country_code||""} onChange={e=>setProfile({...profile,country_code:e.target.value.toUpperCase()})} placeholder="AU"/></label></div><div className="billingPreview"><small>INVOICE PREVIEW</small><b>{[profile.first_name,profile.last_name].filter(Boolean).join(" ")||profile.display_name||"Customer"}</b>{profile.company_name&&<span>{profile.company_name}</span>}<span>{customerId}</span><span>{[profile.address_line1,profile.address_line2,profile.city,profile.state_region,profile.postal_code,profile.country_code].filter(Boolean).join(", ")||"No billing address set"}</span></div></div></section>}

   {tab==="preferences"&&<section className="panel accountSettingsCard"><div className="settingsSectionHead"><div><p className="eyebrow">PREFERENCES</p><h2>Experience & notifications</h2></div></div><div className="settingsPreferenceGrid"><div className="form"><label>Theme<select value={prefs.theme||"system"} onChange={e=>setPrefs({...prefs,theme:e.target.value})}><option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option></select></label><label>Accent<select value={prefs.accent||"blue"} onChange={e=>setPrefs({...prefs,accent:e.target.value})}><option value="blue">Blue</option><option value="violet">Violet</option><option value="green">Green</option><option value="orange">Orange</option></select></label></div><div className="settingsToggles">{[["email_orders","Orders & licences"],["email_support","Support replies"],["email_news","OrbitFS news"]].map(([k,l])=><label className="toggle" key={k}><input type="checkbox" checked={!!prefs[k]} onChange={e=>setPrefs({...prefs,[k]:e.target.checked})}/><span><b>{l}</b><small>Email notifications</small></span></label>)}</div></div></section>}
   <div className="settingsSaveBar"><span>{msg}</span><button>Save changes</button></div>
  </form>}

  {tab==="wallet"&&<section className="panel accountSettingsCard walletSettingsCard"><div className="settingsSectionHead walletSettingsHead"><div><p className="eyebrow">ORBITFS WALLET</p><h2>{money(wallet.available_cents)} available</h2><p className="muted">Wallet recharges are kept separate from normal orders and invoices. Each recharge gets its own Wallet receipt and history entry.</p></div><div className="walletBalanceBadge"><small>AVAILABLE</small><strong>{money(wallet.available_cents)}</strong></div></div><div className="walletSettingsActions"><div className="walletActionBox"><h3>Add funds</h3><p className="muted">Choose an amount and external gateway. This creates a Wallet recharge receipt only — no store order and no main invoice.</p><label>Amount (AUD)<input type="number" min={(billingCfg.minTopup/100).toFixed(2)} max={(billingCfg.maxTopup/100).toFixed(2)} step="0.01" value={walletAmount} onChange={e=>setWalletAmount(e.target.value)} disabled={!!walletBusy||!billingCfg.topups}/></label><label>Payment gateway<select value={walletGateway} onChange={e=>setWalletGateway(e.target.value)} disabled={!!walletBusy}>{walletGateways.length?<>{walletGateways.map((g:any)=><option value={g.code} key={g.code}>{g.name}</option>)}</>:<option value="">No recharge gateway available</option>}</select></label><button type="button" onClick={addFunds} disabled={!!walletBusy||!walletGateway||!billingCfg.topups}>{walletBusy==="topup"?"Opening payment…":"Recharge Wallet"}</button><small className="muted">Minimum {money(billingCfg.minTopup)} · Maximum {money(billingCfg.maxTopup)}{!billingCfg.topups?" · Top-ups disabled":""}</small></div>{billingCfg.allowCredit&&<div className="walletActionBox"><h3>Redeem Wallet coupon</h3><p className="muted">Wallet-credit coupons add their configured AUD value directly to your balance and are recorded in Wallet activity.</p><label>Coupon code<input value={walletCoupon} onChange={e=>setWalletCoupon(e.target.value.toUpperCase())} placeholder="Enter coupon code" disabled={!!walletBusy}/></label><button type="button" className="secondary" onClick={redeem} disabled={!!walletBusy}>{walletBusy==="coupon"?"Redeeming…":"Redeem coupon"}</button></div>}</div>{walletMsg&&<p className="inlineStatus">{walletMsg}</p>}

  <div className="walletRechargeHistory"><div className="settingsSectionHead compact"><div><h3>Recharge history</h3><p className="muted">Wallet top-ups live here instead of Orders or Invoices. Open any entry for its mini receipt.</p></div></div>{recharges.length?recharges.map((x:any)=><div className="walletRechargeEntry" key={x.id}><div className="walletRechargeRow"><div className="walletRechargeMain"><b>{x.receipt_number}</b><span>{new Date(x.created_at).toLocaleString()} · {gatewayName(x.gateway_code)}</span></div><span className={`walletRechargeStatus status-${x.status}`}>{statusLabel(x.status)}</span><strong>{money(x.amount_cents)}</strong><button type="button" className="secondary" onClick={()=>setOpenReceipt(openReceipt===x.id?null:x.id)}>{openReceipt===x.id?"Close":"Receipt"}</button></div>{openReceipt===x.id&&<div className="walletMiniReceipt"><div className="walletReceiptHead"><div><small>ORBITFS WALLET RECEIPT</small><h3>{x.receipt_number}</h3></div><b>{statusLabel(x.status)}</b></div><div className="walletReceiptGrid"><span>Customer</span><b>{customerId}</b><span>Recharge amount</span><b>{money(x.amount_cents)} {x.currency||"AUD"}</b><span>Payment gateway</span><b>{gatewayName(x.gateway_code)}</b><span>Created</span><b>{new Date(x.created_at).toLocaleString()}</b>{x.completed_at&&<><span>Completed</span><b>{new Date(x.completed_at).toLocaleString()}</b></>}{x.provider_reference&&<><span>Payment reference</span><b className="receiptReference">{x.provider_reference}</b></>}{x.status==="succeeded"&&<><span>Wallet credited</span><b>{money(x.credited_cents||x.amount_cents)}</b><span>Balance after</span><b>{money(x.balance_after_cents)}</b></>}</div><small className="muted">This Wallet recharge receipt is separate from OrbitFS store orders and invoices.</small></div>}</div>):<p className="muted">No Wallet recharges yet.</p>}</div>

  <div className="walletActivity"><div className="settingsSectionHead compact"><div><h3>Wallet activity</h3><p className="muted">Latest credits, coupon grants, refunds and Wallet payments.</p></div></div>{ledger.length?ledger.map((x:any)=><div className="walletActivityRow" key={x.id}><div><b>{x.reason||"Wallet activity"}</b><span>{new Date(x.created_at).toLocaleString()}</span></div><div><strong className={x.direction==="debit"?"walletDebit":"walletCredit"}>{x.direction==="debit"?"-":"+"}{money(x.amount_cents)}</strong><span>Balance {money(x.balance_after_cents)}</span></div></div>):<p className="muted">No Wallet activity yet.</p>}</div></section>}

  {tab==="security"&&<section className="panel accountSettingsCard"><div className="settingsSectionHead"><div><p className="eyebrow">SECURITY</p><h2>Change password</h2><p className="muted">Confirm your current password before setting a new one.</p></div></div><div className="form securityForm"><label>Current password<input type="password" value={pw.current} onChange={e=>setPw({...pw,current:e.target.value})} autoComplete="current-password"/></label><div className="two"><label>New password<input type="password" value={pw.next} onChange={e=>setPw({...pw,next:e.target.value})} autoComplete="new-password"/></label><label>Confirm new password<input type="password" value={pw.confirm} onChange={e=>setPw({...pw,confirm:e.target.value})} autoComplete="new-password"/></label></div><button type="button" onClick={changePassword}>Change password</button>{msg&&<p className="inlineStatus">{msg}</p>}</div></section>}
 </div>
}
