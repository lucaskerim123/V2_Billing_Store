import {licenseDb} from "@/lib/license-api";
import {masterAuthorizeInstallationPanelDomain,masterInstallationPanelDomain,masterRecordInstallationPanelDomain} from "@/lib/master-api";
import {event,httpError,loadInstallation,requireOrbitUser,syncDeployment,vercelApi} from "@/lib/orbitfs-deployment";

function normalizeHost(value:unknown){
  return String(value||"").trim().toLowerCase().replace(/^https?:\/\//,"").replace(/\/$/,"");
}
function normalizeVercelAlias(value:unknown){
  const raw=normalizeHost(value);
  const domain=raw.endsWith(".vercel.app")?raw:`${raw}.vercel.app`;
  const slug=domain.slice(0,-".vercel.app".length);
  if(!slug||slug.includes(".")||slug.length>63||!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)){
    throw Object.assign(new Error("Enter a valid Vercel address such as my-orbitfs.vercel.app."),{status:400,code:"BASE_VERCEL_ALIAS_INVALID"});
  }
  return domain;
}
function normalizeCustomDomain(value:unknown){
  const domain=normalizeHost(value);
  if(!domain||domain.endsWith(".vercel.app")||domain.length>253||!domain.includes(".")||!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)){
    throw Object.assign(new Error("Enter a valid custom domain such as orbitfs.example.com."),{status:400,code:"BASE_CUSTOM_DOMAIN_INVALID"});
  }
  return domain;
}
function aliasUnavailable(error:any){
  const message=String(error?.message||"").toLowerCase();
  return /alias.*(already|in use)|already.*(used|assigned|exists)|domain.*(in use|assigned)|alias_in_use|forbidden.*alias/.test(message);
}
function generatedDomain(install:any){
  const name=String(install?.vercel_project_name||"").trim().toLowerCase();
  return name?`${name}.vercel.app`:"";
}
async function authorityLicenseId(install:any,userId:string){
  const bindingId=String(install?.license_binding_id||"").trim();
  if(!bindingId)throw Object.assign(new Error("This Base installation is not linked to an authoritative licence."),{status:409,code:"LICENSE_BINDING_REQUIRED"});
  const result=await licenseDb().from("license_bindings").select("license_id").eq("id",bindingId).eq("auth_user_id",String(userId)).is("archived_at",null).maybeSingle();
  if(result.error)throw result.error;
  if(!result.data?.license_id)throw Object.assign(new Error("This Base installation is not linked to an authoritative licence."),{status:409,code:"LICENSE_BINDING_REQUIRED"});
  return String(result.data.license_id);
}
async function projectDomains(install:any){
  if(!install?.vercel_project_id)return [];
  const result=await vercelApi(String(install.auth_user_id),`/v9/projects/${encodeURIComponent(String(install.vercel_project_id))}/domains`,{method:"GET"});
  return Array.isArray(result?.domains)?result.domains:[];
}
function panelDomain(authority:any){
  const value=authority?.panel_domain&&typeof authority.panel_domain==="object"?authority.panel_domain:{};
  return {
    mode:["generated","vercel","custom"].includes(String(value.mode||""))?String(value.mode):"generated",
    domainName:normalizeHost(value.domain_name)||null,
    generatedDomain:normalizeHost(value.generated_domain)||null,
    verified:value.verified===true,
    effectiveUrl:value.effective_url||null,
    updatedAt:value.updated_at||null,
    deploymentLocked:value.deployment_locked===true,
    deploymentLockReason:value.deployment_lock_reason||null
  };
}
async function cacheAuthorityState(install:any,state:any){
  const now=new Date().toISOString();
  const metadata={
    ...(install?.metadata&&typeof install.metadata==="object"?install.metadata:{}),
    baseDomain:{
      authority:"license-manager",
      mode:state.mode,
      domainName:state.domainName,
      verified:state.verified===true,
      effectiveUrl:state.effectiveUrl||null,
      updatedAt:state.updatedAt||now,
      cachedAt:now
    }
  };
  const result=await licenseDb().from("orbitfs_installations").update({metadata,updated_at:now}).eq("id",install.id).eq("auth_user_id",install.auth_user_id).select().single();
  if(result.error)throw result.error;
  return result.data;
}
function domainState(install:any,authority:any,domains:any[]){
  const state=panelDomain(authority);
  const generated=state.generatedDomain||generatedDomain(install)||null;
  const selected=state.domainName?domains.find((item:any)=>normalizeHost(item?.name)===state.domainName):null;
  const providerVerified=state.mode==="generated"||state.mode==="vercel"||Boolean(selected?.verified===true&&selected?.misconfigured!==true);
  return {...state,generatedDomain:generated,providerVerified};
}
async function checkAlias(install:any,value:unknown){
  const domain=normalizeVercelAlias(value);
  const generated=generatedDomain(install);
  if(domain===generated)return {domain,available:true,attached:true,reserved:true,current:true};
  try{
    const alias=await vercelApi(String(install.auth_user_id),`/v4/aliases/${encodeURIComponent(domain)}`,{method:"GET"});
    const projectId=String(alias?.projectId||alias?.project?.id||alias?.deployment?.projectId||"").trim();
    const deploymentId=String(alias?.deploymentId||alias?.deployment?.id||"").trim();
    if(projectId&&projectId===String(install.vercel_project_id||"")){
      const attached=Boolean(install.vercel_deployment_id&&deploymentId===String(install.vercel_deployment_id));
      return {domain,available:true,attached,reserved:true,current:attached};
    }
    return {domain,available:false,attached:false,reserved:false,current:false,reason:"already_in_use"};
  }catch(error:any){
    const status=Number(error?.status||0);
    if(status===404)return {domain,available:true,attached:false,reserved:false,current:false};
    if(status===403||status===409||aliasUnavailable(error))return {domain,available:false,attached:false,reserved:false,current:false,reason:"already_in_use"};
    throw error;
  }
}

export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {user}=await requireOrbitUser(req),{id}=await params;
    const install=await loadInstallation(id,user.id);
    if(!install.vercel_project_id||!install.installation_id)return Response.json({error:"Deploy Base before configuring its domain."},{status:409});
    const licenseId=await authorityLicenseId(install,String(user.id));
    const authority=await masterInstallationPanelDomain(String(install.installation_id),licenseId);
    const domains=await projectDomains(install);
    const state=domainState(install,authority,domains);
    await cacheAuthorityState(install,state);
    return Response.json({domain:state,authority:"orbitfs-license-master-v2"},{headers:{"cache-control":"no-store"}});
  }catch(error){return httpError(error)}
}

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {user}=await requireOrbitUser(req),{id}=await params;
    let install=await loadInstallation(id,user.id);
    if(!install.vercel_project_id||!install.vercel_deployment_id||!install.installation_id)return Response.json({error:"Deploy Base before configuring its domain."},{status:409});
    const licenseId=await authorityLicenseId(install,String(user.id));
    const body=await req.json().catch(()=>({}));
    const action=String(body.action||"save").trim().toLowerCase();
    if(action==="check"){
      return Response.json({availability:await checkAlias(install,body.domain)},{headers:{"cache-control":"no-store"}});
    }
    if(action!=="save")return Response.json({error:"Unsupported Base domain action."},{status:400});
    const mode=String(body.mode||"generated").trim().toLowerCase();
    if(!["generated","vercel","custom"].includes(mode))return Response.json({error:"Unsupported Base domain mode."},{status:400});

    await masterAuthorizeInstallationPanelDomain({installation_id:install.installation_id,license_id:licenseId});
    const generated=generatedDomain(install);

    if(mode==="generated"){
      const recorded=await masterRecordInstallationPanelDomain({
        installation_id:install.installation_id,
        license_id:licenseId,
        panel_domain:{mode:"generated",domain_name:null,verified:true,effective_url:generated?`https://${generated}`:null}
      });
      const state=domainState(install,recorded,await projectDomains(install));
      install=await cacheAuthorityState(install,state);
      install=await syncDeployment(install);
      await event(install,"panel.domain_preference","ok","Base Panel address changed to the generated Vercel domain",{authority:"license-manager",mode:"generated",domainName:null});
      return Response.json({installation:install,domain:{...state,effectiveUrl:install.production_url||state.effectiveUrl},authority:"orbitfs-license-master-v2"},{headers:{"cache-control":"no-store"}});
    }

    if(mode==="vercel"){
      const availability=await checkAlias(install,body.domain);
      if(!availability.available)throw Object.assign(new Error(`${availability.domain} is already in use on Vercel.`),{status:409,code:"BASE_VERCEL_ALIAS_UNAVAILABLE"});
      const domain=availability.domain;
      if(!availability.attached){
        try{
          await vercelApi(String(install.auth_user_id),`/v2/deployments/${encodeURIComponent(String(install.vercel_deployment_id))}/aliases`,{method:"POST",body:JSON.stringify({alias:domain,redirect:null})});
        }catch(error:any){
          if(Number(error?.status||0)===403||Number(error?.status||0)===409||aliasUnavailable(error))throw Object.assign(new Error(`${domain} is already in use on Vercel.`),{status:409,code:"BASE_VERCEL_ALIAS_UNAVAILABLE"});
          throw error;
        }
      }
      const alias=await vercelApi(String(install.auth_user_id),`/v4/aliases/${encodeURIComponent(domain)}`,{method:"GET"});
      const aliasDeploymentId=String(alias?.deploymentId||alias?.deployment?.id||"").trim();
      const aliasProjectId=String(alias?.projectId||alias?.project?.id||alias?.deployment?.projectId||"").trim();
      if(aliasDeploymentId!==String(install.vercel_deployment_id)||(aliasProjectId&&aliasProjectId!==String(install.vercel_project_id))){
        throw Object.assign(new Error("Vercel did not bind the selected Base address to this production deployment."),{status:503,code:"BASE_VERCEL_ALIAS_BIND_FAILED"});
      }
      const recorded=await masterRecordInstallationPanelDomain({
        installation_id:install.installation_id,
        license_id:licenseId,
        panel_domain:{mode:"vercel",domain_name:domain,verified:true,effective_url:`https://${domain}`}
      });
      const state=domainState(install,recorded,await projectDomains(install));
      install=await cacheAuthorityState(install,state);
      install=await syncDeployment(install);
      await event(install,"panel.domain_preference","ok",`Base Panel Vercel address changed to ${domain}`,{authority:"license-manager",mode:"vercel",domainName:domain});
      return Response.json({installation:install,availability:{...availability,attached:true,reserved:true,current:true},domain:{...state,effectiveUrl:install.production_url||state.effectiveUrl},authority:"orbitfs-license-master-v2"},{headers:{"cache-control":"no-store"}});
    }

    const domain=normalizeCustomDomain(body.domain);
    let domains=await projectDomains(install);
    let entry=domains.find((item:any)=>normalizeHost(item?.name)===domain);
    if(!entry){
      entry=await vercelApi(String(install.auth_user_id),`/v10/projects/${encodeURIComponent(String(install.vercel_project_id))}/domains`,{method:"POST",body:JSON.stringify({name:domain})});
    }
    domains=await projectDomains(install);
    const refreshed=domains.find((item:any)=>normalizeHost(item?.name)===domain)||entry;
    const verified=Boolean(refreshed?.verified===true&&refreshed?.misconfigured!==true);
    const effectiveUrl=verified?`https://${domain}`:(generated?`https://${generated}`:null);
    const recorded=await masterRecordInstallationPanelDomain({
      installation_id:install.installation_id,
      license_id:licenseId,
      panel_domain:{mode:"custom",domain_name:domain,verified,effective_url:effectiveUrl}
    });
    const state=domainState(install,recorded,domains);
    install=await cacheAuthorityState(install,state);
    install=await syncDeployment(install);
    await event(install,"panel.domain_preference",verified?"ok":"warning",verified?`Base Panel custom domain changed to ${domain}`:`Base Panel custom domain ${domain} is waiting for Vercel DNS verification`,{authority:"license-manager",mode:"custom",domainName:domain,verified});
    return Response.json({installation:install,domain:{...state,effectiveUrl:install.production_url||state.effectiveUrl},authority:"orbitfs-license-master-v2"},{headers:{"cache-control":"no-store"}});
  }catch(error){return httpError(error)}
}
