"use client";

import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import {canonicalLicenseStatus,canonicalStatusLabel,isCanonicalLicenseUsable} from "@/lib/license-status";
import V6ConfirmDialog from "@/components/V6ConfirmDialog";

const componentLabels:Record<string,string>={
  orbitfs_base:"OrbitFS Base",
  orbitfs_apex:"OrbitFS APEX",
  orbitfs_mcp:"OrbitFS MCP",
  orbitfs_studio:"OrbitFS Studio"
};

function enabledComponents(binding:any){
  const components=binding?.components&&typeof binding.components==="object"?binding.components:{};
  const enabled=Object.entries(componentLabels).filter(([id])=>{
    const value:any=components[id];
    return value===true||value?.allowed===true||["active","enabled","locked"].includes(String(value?.state||"").toLowerCase());
  }).map(([,label])=>label);
  if(binding?.license_product_key==="orbitfs_base"&&!enabled.includes("OrbitFS Base"))enabled.unshift("OrbitFS Base");
  return enabled;
}

function licenceName(binding:any){
  return componentLabels[String(binding?.license_product_key||"").toLowerCase()]||binding?.label||binding?.license_product_key||"OrbitFS licence";
}

function shortId(value:any){
  const text=String(value||"");
  if(!text)return "Not available";
  return text.length>22?text.slice(0,9)+"…"+text.slice(-8):text;
}

type ConfirmState={action:"rotate"|"unlock";title:string;description:string}|null;

export default function OrbitFSLicenseController(){
  const sb=useMemo(()=>createClient(),[]);
  const [data,setData]=useState<any>(null);
  const [channelData,setChannelData]=useState<any>({channels:[],access:[]});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [newKey,setNewKey]=useState("");
  const [busy,setBusy]=useState("");
  const [selectedLicenseId,setSelectedLicenseId]=useState("");
  const [confirmState,setConfirmState]=useState<ConfirmState>(null);

  async function authHeaders(){
    const {data:{session}}=await sb.auth.getSession();
    if(!session?.access_token)throw new Error("Your session has expired. Sign in again.");
    return {Authorization:"Bearer "+session.access_token};
  }

  async function load(options?:{preserveFeedback?:boolean}){
    setLoading(true);
    if(!options?.preserveFeedback){setError("");setNotice("")}
    try{
      const headers=await authHeaders();
      const [statusResult,channelResult]=await Promise.all([
        fetch("/api/orbitfs/status",{headers,cache:"no-store"}),
        fetch("/api/orbitfs/release-channels",{headers,cache:"no-store"}).catch(()=>null)
      ]);
      const status=await statusResult.json().catch(()=>({}));
      if(!statusResult.ok)throw new Error(status.error||"Could not load your licence.");
      setData(status);
      const channels=channelResult?await channelResult.json().catch(()=>({})):{};
      setChannelData(channelResult?.ok?channels:{channels:[],access:[]});
      const rows=Array.isArray(status.bindings)?status.bindings:[];
      setSelectedLicenseId(current=>{
        if(rows.some((row:any)=>String(row.license_id)===current))return current;
        const primary=rows.find((row:any)=>row.license_product_key==="orbitfs_base"||row.components?.orbitfs_base)||rows[0];
        return String(primary?.license_id||"");
      });
    }catch(e:any){
      setData(null);
      setError(e?.message||"Could not load your licence.");
    }finally{setLoading(false)}
  }

  useEffect(()=>{void load()},[]);

  const bindings=Array.isArray(data?.bindings)?data.bindings:[];
  const installations=Array.isArray(data?.installations)?data.installations:[];
  const selectedBinding=bindings.find((row:any)=>String(row.license_id)===selectedLicenseId)
    ||bindings.find((row:any)=>row.license_product_key==="orbitfs_base"||row.components?.orbitfs_base)
    ||bindings[0]
    ||null;
  const selectedInstall=selectedBinding
    ?installations.find((row:any)=>String(row.license_binding_id)===String(selectedBinding.id))
    :null;
  const selectedComponents=enabledComponents(selectedBinding);
  const selectedStatus=canonicalLicenseStatus(selectedBinding);
  const selectedUsable=isCanonicalLicenseUsable(selectedBinding);
  const isBase=Boolean(selectedBinding&&(selectedBinding.license_product_key==="orbitfs_base"||selectedBinding.components?.orbitfs_base));
  const customerUnlockEnabled=data?.settings?.customer_self_unlock_enabled!==false;
  const pendingBaseForceReinstall=selectedInstall?.metadata?.pendingBaseForceReinstall&&typeof selectedInstall.metadata.pendingBaseForceReinstall==="object"
    ?selectedInstall.metadata.pendingBaseForceReinstall
    :null;

  const channelDefinitions=Array.isArray(channelData?.channels)?channelData.channels:[];
  const explicitAccess=(Array.isArray(channelData?.access)?channelData.access:[]).filter((row:any)=>{
    const licenseId=String(row?.license_id||"");
    return !licenseId||licenseId===String(selectedBinding?.license_id||"");
  });
  const selectedChannels=channelDefinitions.filter((channel:any)=>{
    if(channel?.enabled===false||channel?.customer_visible===false)return false;
    const automatic=channel.channel==="stable"||channel.access_mode==="open";
    const explicit=explicitAccess.some((row:any)=>String(row.channel||"").toLowerCase()===String(channel.channel||"").toLowerCase());
    return selectedUsable&&(automatic||explicit);
  });
  const currentReleaseChannel=String(selectedInstall?.release_channel||"stable");
  const selectedInstallations=selectedBinding
    ?installations.filter((row:any)=>String(row.license_binding_id)===String(selectedBinding.id))
    :[];

  function askControl(action:"rotate"|"unlock"){
    if(!selectedBinding?.license_id)return setError("No License Manager licence ID is available.");
    if(action==="unlock"&&!selectedInstall?.installation_id)return setError("No bound installation is available to unlock.");
    const description=action==="rotate"
      ?pendingBaseForceReinstall
        ?"The current licence key becomes invalid immediately. The replacement key is shown once and must be entered in Base Deployment to continue the pending reinstall."
        :"The current licence key becomes invalid immediately. The replacement key is shown once, so copy it before leaving this page."
      :"This releases the current installation binding so the licence can be used for another installation. It does not delete the deployed infrastructure.";
    setConfirmState({
      action,
      title:action==="rotate"?"Rotate licence key?":"Unlock installation?",
      description
    });
  }

  async function executeControl(action:"rotate"|"unlock"){
    if(!selectedBinding?.license_id)return;
    setBusy(action);setError("");setNotice("");setNewKey("");
    try{
      const headers=await authHeaders();
      const response=await fetch("/api/orbitfs/license-control",{
        method:"POST",
        headers:{...headers,"Content-Type":"application/json"},
        body:JSON.stringify({
          licenseId:selectedBinding.license_id,
          installationId:selectedInstall?.installation_id||null,
          action
        })
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||`Licence ${action} failed.`);
      const warning=Array.isArray(body.warnings)&&body.warnings.length?" "+body.warnings.join(" · "):"";
      setNotice((body.message||`Licence ${action} completed.`)+warning);
      if(action==="rotate"&&body.key)setNewKey(String(body.key));
      setConfirmState(null);
      await load({preserveFeedback:true});
    }catch(e:any){setError(e?.message||`Licence ${action} failed.`)}
    finally{setBusy("")}
  }

  if(loading&&!data){
    return <main className="orbitCustomerLicense"><section className="orbitCustomerLoading"><span className="orbitCustomerSpinner" aria-hidden="true"/><div><b>Loading License Controller</b><p>Checking your authoritative licence, installation and release-channel access.</p></div></section></main>;
  }

  if(!data){
    return <main className="orbitCustomerLicense"><section className="orbitCustomerEmpty"><b>License Controller unavailable</b><p>{error||"The licence authority did not return your account state."}</p><button type="button" onClick={()=>void load()}>Retry</button></section></main>;
  }

  return <main className="orbitCustomerLicense">
    <section className="orbitCustomerCommandbar">
      <div>
        <span>LICENSE MANAGER AUTHORITY</span>
        <b>{bindings.length?bindings.length+" linked "+(bindings.length===1?"licence":"licences"):"No linked licence"}</b>
        <small>Billing Store displays the authoritative state; licence decisions remain with License Manager.</small>
      </div>
      <div>
        <Link className="buttonlink secondary" href="/portal/orbitfs/channels">Release channels</Link>
        <Link className="buttonlink secondary" href="/portal/orbitfs/base">Base Deployment</Link>
        <button type="button" onClick={()=>void load()} disabled={loading}>{loading?"Refreshing…":"Refresh"}</button>
      </div>
    </section>

    {error&&<div className="orbitCustomerNotice danger" role="alert"><b>Action failed</b><span>{error}</span></div>}
    {notice&&<div className="orbitCustomerNotice" role="status"><b>Updated</b><span>{notice}</span></div>}

    <section className="orbitCustomerLicenceStats" aria-label="Licence summary">
      <article><span>Licence state</span><b>{selectedBinding?canonicalStatusLabel(selectedStatus):"Not linked"}</b><small>{selectedUsable?"Eligible for authorised OrbitFS access":"Action may be required before deployment"}</small></article>
      <article><span>Entitlements</span><b>{selectedComponents.length}</b><small>{selectedComponents.join(" · ")||"No active components"}</small></article>
      <article><span>Installations</span><b>{selectedInstallations.length}</b><small>{selectedInstall?.installation_id?shortId(selectedInstall.installation_id):"No installation bound"}</small></article>
      <article><span>Release channels</span><b>{selectedChannels.length}</b><small>{selectedChannels.map((row:any)=>row.label||row.channel).join(" · ")||"No active channel access"}</small></article>
    </section>

    {bindings.length?<div className="orbitCustomerLicenceWorkspace">
      <aside className="orbitCustomerLicenceRail">
        <header><div><b>Your licences</b><span>Select a licence to inspect its authority state and controls.</span></div><strong>{bindings.length}</strong></header>
        <div className="orbitCustomerLicenceList">
          {bindings.map((row:any)=>{
            const status=canonicalLicenseStatus(row);
            const components=enabledComponents(row);
            const install=installations.find((item:any)=>String(item.license_binding_id)===String(row.id));
            const active=String(row.license_id)===String(selectedBinding?.license_id);
            return <button
              type="button"
              key={row.id||row.license_id}
              className={"orbitCustomerLicenceChoice "+(active?"active":"")}
              onClick={()=>{setSelectedLicenseId(String(row.license_id||""));setNewKey("");setError("");setNotice("")}}
            >
              <div><span className={"orbitCustomerStatusDot "+(isCanonicalLicenseUsable(row)?"ready":"attention")} aria-hidden="true"/><b>{licenceName(row)}</b></div>
              <small>{row.license_key_last4?"•••• "+row.license_key_last4:"Protected key"} · {canonicalStatusLabel(status)}</small>
              <span>{components.length} component{components.length===1?"":"s"} · {install?"installation bound":"not installed"}</span>
            </button>
          })}
        </div>
      </aside>

      <section className="orbitCustomerLicenceDetail">
        {selectedBinding&&<>
          <header className="orbitCustomerLicenceHead">
            <div>
              <span className="orbitCustomerKicker">{isBase?"PRIMARY ORBITFS SYSTEM":"ORBITFS LICENCE"}</span>
              <div className="orbitCustomerLicenceTitle"><h2>{licenceName(selectedBinding)}</h2><span className={"orbitCustomerState "+(selectedUsable?"ready":"attention")}>{canonicalStatusLabel(selectedStatus)}</span></div>
              <p>Licence <code>{shortId(selectedBinding.license_id)}</code></p>
            </div>
            <div className="orbitCustomerLicenceHeadMeta">
              <span>Key</span>
              <b>{selectedBinding.license_key_last4?"•••• "+selectedBinding.license_key_last4:"Protected"}</b>
            </div>
          </header>

          {pendingBaseForceReinstall&&<section className="orbitCustomerCallout warning">
            <div><span>BASE REINSTALL WAITING</span><b>Rotate this licence before continuing</b><p>The previous Base activation has been released. Rotate the key here, copy the replacement once, then return to Base Deployment for published Base {pendingBaseForceReinstall.targetVersion||"current"}.</p></div>
            <button type="button" onClick={()=>askControl("rotate")} disabled={!!busy}>Rotate key</button>
          </section>}

          {newKey&&<section className="orbitCustomerKeyReveal" role="status">
            <div><span>NEW LICENCE KEY</span><b>Copy this key now</b><p>{pendingBaseForceReinstall?"Return to Base Deployment and enter this exact key to continue the reinstall.":"The replacement is shown once. Save it before leaving this page."}</p></div>
            <code>{newKey}</code>
            <div><button type="button" className="secondary" onClick={()=>void navigator.clipboard?.writeText(newKey)}>Copy key</button>{pendingBaseForceReinstall&&<Link className="buttonlink" href="/portal/orbitfs/base">Continue Base reinstall →</Link>}</div>
          </section>}

          <section className="orbitCustomerDetailGrid">
            <article>
              <span>Expiry</span>
              <b>{selectedBinding.authoritative_expires_at||selectedBinding.expires_at?new Date(selectedBinding.authoritative_expires_at||selectedBinding.expires_at).toLocaleDateString():"No expiry"}</b>
              <small>Authoritative licence expiry</small>
            </article>
            <article>
              <span>Installation binding</span>
              <b>{selectedInstall?.installation_id?shortId(selectedInstall.installation_id):"Not registered"}</b>
              <small>{selectedInstall?String(selectedInstall.state||selectedInstall.health_status||"Bound").replaceAll("_"," "):"No Base installation is bound"}</small>
            </article>
            <article>
              <span>Current release channel</span>
              <b>{selectedInstall?currentReleaseChannel:"Not installed"}</b>
              <small>{selectedInstall?"Used by this Base installation":"Choose a channel when configuring Base"}</small>
            </article>
            <article>
              <span>Authority source</span>
              <b>License Manager</b>
              <small>Billing Store is presentation and customer workflow only</small>
            </article>
          </section>

          <section className="orbitCustomerLicenceSection">
            <header><div><span>ENTITLEMENTS</span><h3>Enabled components</h3></div><strong>{selectedComponents.length}</strong></header>
            <div className="orbitCustomerComponentGrid">
              {Object.entries(componentLabels).map(([id,label])=>{
                const enabled=selectedComponents.includes(label);
                return <div key={id} className={enabled?"enabled":""}><span className={"orbitCustomerStatusDot "+(enabled?"ready":"neutral")} aria-hidden="true"/><div><b>{label}</b><small>{enabled?"Included on this licence":"Not included"}</small></div></div>
              })}
            </div>
          </section>

          <section className="orbitCustomerLicenceSection">
            <header><div><span>RELEASE ACCESS</span><h3>Shared Base + Update channels</h3><p>One channel entitlement controls which authorised Base and Update releases this licence can discover.</p></div><Link href="/portal/orbitfs/channels">Manage access →</Link></header>
            <div className="orbitCustomerChannelAccess">
              {channelDefinitions.filter((row:any)=>row.enabled!==false&&row.customer_visible!==false).map((channel:any)=>{
                const automatic=channel.channel==="stable"||channel.access_mode==="open";
                const explicit=explicitAccess.some((row:any)=>String(row.channel||"").toLowerCase()===String(channel.channel||"").toLowerCase());
                const available=selectedUsable&&(automatic||explicit);
                const current=selectedInstall&&String(channel.channel)===currentReleaseChannel;
                return <div key={channel.channel} className={(available?"available ":"")+(current?"current":"")}>
                  <div><b>{channel.label||channel.channel}</b><small>{channel.channel} · {automatic?"automatic":explicit?"explicit grant":"restricted"}</small></div>
                  <span>{current?"Current":available?"Available":"No access"}</span>
                </div>
              })}
              {!channelDefinitions.length&&<div className="orbitCustomerEmpty compact"><p>Release-channel authority is temporarily unavailable. Your licence state is still shown above.</p></div>}
            </div>
          </section>

          <section className="orbitCustomerLicenceSection">
            <header><div><span>INSTALLATIONS</span><h3>Licence bindings</h3></div><strong>{selectedInstallations.length}</strong></header>
            {selectedInstallations.length?<div className="orbitCustomerInstallationList">
              {selectedInstallations.map((row:any)=><div key={row.id||row.installation_id}>
                <div><b>{shortId(row.installation_id)}</b><small>{String(row.state||row.health_status||"Bound").replaceAll("_"," ")} · channel {row.release_channel||"stable"}</small></div>
                <span className={"orbitCustomerState "+(String(row.state||"").toLowerCase()==="failed"?"attention":"ready")}>{String(row.state||"Bound").replaceAll("_"," ")}</span>
              </div>)}
            </div>:<div className="orbitCustomerEmpty compact"><b>No installation bound</b><p>Deploy OrbitFS Base to create an installation binding for this licence.</p><Link className="buttonlink secondary" href="/portal/orbitfs/base">Open Base Deployment</Link></div>}
          </section>

          {isBase&&<section className="orbitCustomerLicenceActions">
            <div><span>PERMITTED CUSTOMER ACTIONS</span><h3>Licence controls</h3><p>Customer controls are intentionally narrower than administrator enforcement controls.</p></div>
            <div>
              <button type="button" disabled={!!busy||!selectedBinding.license_id||!selectedUsable} onClick={()=>askControl("rotate")}>{busy==="rotate"?"Rotating…":"Rotate key"}</button>
              <button type="button" className="secondary" disabled={!!busy||!selectedBinding.license_id||!selectedInstall?.installation_id||!customerUnlockEnabled||!selectedUsable} onClick={()=>askControl("unlock")}>{busy==="unlock"?"Unlocking…":customerUnlockEnabled?"Unlock installation":"Customer unlock disabled"}</button>
            </div>
          </section>}
        </>}
      </section>
    </div>:<section className="orbitCustomerEmpty">
      <b>No current OrbitFS licence is linked</b>
      <p>Your customer account does not currently have an authoritative OrbitFS licence. If you recently purchased OrbitFS, contact support with your order number.</p>
      <div><Link className="buttonlink secondary" href="/portal/orders">View orders</Link><Link className="buttonlink" href="/portal/support">Contact support</Link></div>
    </section>}

    <V6ConfirmDialog
      open={Boolean(confirmState)}
      title={confirmState?.title||""}
      description={confirmState?.description||""}
      confirmLabel={confirmState?.action==="rotate"?"Rotate key":"Unlock installation"}
      danger={confirmState?.action==="rotate"}
      busy={Boolean(busy)}
      onCancel={()=>setConfirmState(null)}
      onConfirm={()=>{if(confirmState)void executeControl(confirmState.action)}}
    />
  </main>;
}
