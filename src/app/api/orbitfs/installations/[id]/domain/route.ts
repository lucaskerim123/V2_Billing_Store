import {licenseDb} from "@/lib/license-api";
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
function preference(install:any){
  const value=install?.metadata?.baseDomain;
  if(!value||typeof value!=="object")return null;
  const mode=String(value.mode||"").trim().toLowerCase();
  if(!["generated","vercel","custom"].includes(mode))return null;
  return {mode,domainName:normalizeHost(value.domainName),updatedAt:value.updatedAt||null};
}
function generatedDomain(install:any){
  const name=String(install?.vercel_project_name||"").trim().toLowerCase();
  return name?`${name}.vercel.app`:"";
}
async function projectDomains(install:any){
  if(!install?.vercel_project_id)return [];
  const result=await vercelApi(String(install.auth_user_id),`/v9/projects/${encodeURIComponent(String(install.vercel_project_id))}/domains`,{method:"GET"});
  return Array.isArray(result?.domains)?result.domains:[];
}
function domainState(install:any,domains:any[]){
  const generated=generatedDomain(install);
  const saved=preference(install);
  const liveHost=normalizeHost(install?.production_url);
  let mode=saved?.mode||"generated";
  let domainName=saved?.domainName||"";
  if(!saved&&liveHost){
    if(liveHost===generated)mode="generated";
    else if(liveHost.endsWith(".vercel.app")){mode="vercel";domainName=liveHost}
    else{mode="custom";domainName=liveHost}
  }
  const selected=domainName?domains.find((item:any)=>normalizeHost(item?.name)===domainName):null;
  const verified=mode==="generated"||mode==="vercel"||Boolean(selected?.verified===true&&selected?.misconfigured!==true);
  return {
    mode,
    domainName:domainName||null,
    generatedDomain:generated||null,
    verified,
    effectiveUrl:install?.production_url||null,
    updatedAt:saved?.updatedAt||null
  };
}
async function savePreference(install:any,input:{mode:"generated"|"vercel"|"custom";domainName:string|null}){
  const now=new Date().toISOString();
  const metadata={...(install?.metadata&&typeof install.metadata==="object"?install.metadata:{}),baseDomain:{mode:input.mode,domainName:input.domainName,updatedAt:now}};
  const result=await licenseDb().from("orbitfs_installations").update({metadata,updated_at:now}).eq("id",install.id).eq("auth_user_id",install.auth_user_id).select().single();
  if(result.error)throw result.error;
  return result.data;
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
    if(!install.vercel_project_id)return Response.json({error:"Deploy Base before configuring its domain."},{status:409});
    const domains=await projectDomains(install);
    return Response.json({domain:domainState(install,domains)},{headers:{"cache-control":"no-store"}});
  }catch(error){return httpError(error)}
}

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {user}=await requireOrbitUser(req),{id}=await params;
    let install=await loadInstallation(id,user.id);
    if(!install.vercel_project_id||!install.vercel_deployment_id)return Response.json({error:"Deploy Base before configuring its domain."},{status:409});
    const body=await req.json().catch(()=>({}));
    const action=String(body.action||"save").trim().toLowerCase();
    if(action==="check"){
      return Response.json({availability:await checkAlias(install,body.domain)},{headers:{"cache-control":"no-store"}});
    }
    if(action!=="save")return Response.json({error:"Unsupported Base domain action."},{status:400});
    const mode=String(body.mode||"generated").trim().toLowerCase();
    if(!["generated","vercel","custom"].includes(mode))return Response.json({error:"Unsupported Base domain mode."},{status:400});

    if(mode==="generated"){
      install=await savePreference(install,{mode:"generated",domainName:null});
      install=await syncDeployment(install);
      await event(install,"panel.domain_preference","ok","Base Panel address changed to the generated Vercel domain",{mode:"generated",domainName:null});
      return Response.json({installation:install,domain:domainState(install,await projectDomains(install))},{headers:{"cache-control":"no-store"}});
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
      install=await savePreference(install,{mode:"vercel",domainName:domain});
      install=await syncDeployment(install);
      await event(install,"panel.domain_preference","ok",`Base Panel Vercel address changed to ${domain}`,{mode:"vercel",domainName:domain});
      return Response.json({installation:install,availability:{...availability,attached:true,reserved:true,current:true},domain:domainState(install,await projectDomains(install))},{headers:{"cache-control":"no-store"}});
    }

    const domain=normalizeCustomDomain(body.domain);
    let domains=await projectDomains(install);
    let entry=domains.find((item:any)=>normalizeHost(item?.name)===domain);
    if(!entry){
      entry=await vercelApi(String(install.auth_user_id),`/v10/projects/${encodeURIComponent(String(install.vercel_project_id))}/domains`,{method:"POST",body:JSON.stringify({name:domain})});
    }
    install=await savePreference(install,{mode:"custom",domainName:domain});
    install=await syncDeployment(install);
    domains=await projectDomains(install);
    const refreshed=domains.find((item:any)=>normalizeHost(item?.name)===domain)||entry;
    const verified=Boolean(refreshed?.verified===true&&refreshed?.misconfigured!==true);
    await event(install,"panel.domain_preference",verified?"ok":"warning",verified?`Base Panel custom domain changed to ${domain}`:`Base Panel custom domain ${domain} is waiting for Vercel DNS verification`,{mode:"custom",domainName:domain,verified});
    return Response.json({installation:install,domain:{...domainState(install,domains),mode:"custom",domainName:domain,verified}},{headers:{"cache-control":"no-store"}});
  }catch(error){return httpError(error)}
}
