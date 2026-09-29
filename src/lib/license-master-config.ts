import { createClient } from "@supabase/supabase-js";

export const TRUSTED_MASTER_BOOTSTRAP_URL = "https://incendiarynetworks.cc/api/v1";
export const TRUSTED_MASTER_FALLBACK_URL = "https://orbitfs-fallback.stubengine.com/api/v1";
export const DEFAULT_MASTER_API_URL = TRUSTED_MASTER_BOOTSTRAP_URL;

export type ApiConnectionRole="primary"|"fallback";

function validMasterUrl(value:string,role:ApiConnectionRole="primary"){
  try{
    const u=new URL(String(value||"").trim());
    const host=u.hostname.toLowerCase();
    const cleanPath=u.pathname.replace(/\/+$/,"");
    const hostOk=role==="primary"
      ? host==="incendiarynetworks.cc"||host.endsWith(".incendiarynetworks.cc")
      : host==="orbitfs-fallback.stubengine.com";
    if(u.protocol!=="https:"||!hostOk||cleanPath!=="/api/v1"||u.username||u.password||u.search||u.hash)return null;
    return `${u.origin}/api/v1`;
  }catch{return null}
}

export function normalizeMasterApiUrl(value:string,role:ApiConnectionRole="primary"){
  return validMasterUrl(value,role)||"";
}

export type OfficialApiConnection={
  id?:string;
  service_key:string;
  label:string;
  base_url:string;
  allowed_clients?:string[];
  enabled?:boolean;
  priority?:number;
  settings?:Record<string,unknown>;
  connection_role?:ApiConnectionRole;
  failover_enabled?:boolean;
};

let registryCache:{expires:number;connections:OfficialApiConnection[]}|null=null;

function normalizedRegistryRow(row:any):OfficialApiConnection|null{
  const role=String(row?.connection_role||"primary")==="fallback"?"fallback":"primary";
  const base=validMasterUrl(String(row?.base_url||""),role);
  if(!base)return null;
  return {...row,connection_role:role,base_url:base};
}

export async function getOfficialMasterApiConnections(force=false){
  if(!force&&registryCache&&registryCache.expires>Date.now())return registryCache.connections;
  let connections:OfficialApiConnection[]=[];
  try{
    const url=new URL(TRUSTED_MASTER_BOOTSTRAP_URL+"/api-connections");
    url.searchParams.set("client","billing_store");
    url.searchParams.set("service","license_manager");
    const response=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(5000)});
    if(response.ok){
      const body=await response.json().catch(()=>({}));
      connections=(Array.isArray(body?.connections)?body.connections:[])
        .filter((row:any)=>row?.enabled!==false)
        .map(normalizedRegistryRow)
        .filter(Boolean) as OfficialApiConnection[];
    }
  }catch{}
  if(!connections.some(row=>(row.connection_role||"primary")==="primary"))connections.push({
    service_key:"license_manager",label:"Primary License Manager API",base_url:TRUSTED_MASTER_BOOTSTRAP_URL,
    allowed_clients:["billing_store"],enabled:true,priority:10,connection_role:"primary",failover_enabled:false,settings:{bootstrap:true}
  });
  if(!connections.some(row=>row.connection_role==="fallback"))connections.push({
    service_key:"license_manager",label:"OrbitFS limp-mode fallback",base_url:TRUSTED_MASTER_FALLBACK_URL,
    allowed_clients:["billing_store"],enabled:true,priority:900,connection_role:"fallback",failover_enabled:true,
    settings:{bootstrap:true,mode:"limp",restricted:true,authority:false}
  });
  connections.sort((a,b)=>{
    const role=(a.connection_role==="fallback"?1:0)-(b.connection_role==="fallback"?1:0);
    return role||Number(a.priority||100)-Number(b.priority||100);
  });
  registryCache={expires:Date.now()+30_000,connections};
  return connections;
}

export async function requireOfficialMasterApiUrl(value:string,role:ApiConnectionRole="primary"){
  const normalized=validMasterUrl(value,role);
  if(!normalized)throw new Error(role==="fallback"
    ?"Fallback URL must be the registered OrbitFS StubEngine HTTPS /api/v1 endpoint."
    :"License Manager URL must be an official HTTPS /api/v1 endpoint.");
  const official=await getOfficialMasterApiConnections(true);
  if(!official.some(row=>(row.connection_role||"primary")===role&&row.base_url===normalized)){
    throw new Error("That URL is not an enabled official OrbitFS "+role+" API.");
  }
  return normalized;
}

let cachedConnection:{primaryUrl:string;fallbackUrl:string|null;failoverEnabled:boolean}|null=null;
let cachedAt=0;

export async function getMasterApiConnection(){
  const now=Date.now();
  if(cachedConnection&&now-cachedAt<30_000)return cachedConnection;

  const official=await getOfficialMasterApiConnections();
  const primaryRows=official.filter(row=>(row.connection_role||"primary")==="primary");
  const fallbackRows=official.filter(row=>row.connection_role==="fallback"&&row.failover_enabled!==false);
  const allowedPrimary=new Set(primaryRows.map(row=>row.base_url));
  const allowedFallback=new Set(fallbackRows.map(row=>row.base_url));
  let primaryUrl=allowedPrimary.has(TRUSTED_MASTER_BOOTSTRAP_URL)?TRUSTED_MASTER_BOOTSTRAP_URL:primaryRows[0]?.base_url||TRUSTED_MASTER_BOOTSTRAP_URL;
  let fallbackUrl=allowedFallback.has(TRUSTED_MASTER_FALLBACK_URL)?TRUSTED_MASTER_FALLBACK_URL:fallbackRows[0]?.base_url||TRUSTED_MASTER_FALLBACK_URL;
  let failoverEnabled=true;

  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
  if(supabaseUrl&&serviceKey){
    try{
      const sb=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
      let data:any=null;
      const modern=await sb.from("license_master_connection")
        .select("master_url,fallback_url,failover_enabled,failover_mode,enabled,updated_at")
        .order("updated_at",{ascending:false}).limit(1).maybeSingle();
      if(!modern.error)data=modern.data;
      else{
        const legacy=await sb.from("license_master_connection")
          .select("master_url,enabled,updated_at")
          .order("updated_at",{ascending:false}).limit(1).maybeSingle();
        if(!legacy.error)data=legacy.data;
      }
      const selectedPrimary=data?.enabled!==false&&data?.master_url?validMasterUrl(String(data.master_url),"primary"):null;
      const selectedFallback=data?.fallback_url?validMasterUrl(String(data.fallback_url),"fallback"):null;
      if(selectedPrimary&&allowedPrimary.has(selectedPrimary))primaryUrl=selectedPrimary;
      if(selectedFallback&&allowedFallback.has(selectedFallback))fallbackUrl=selectedFallback;
      if(data&&("failover_enabled" in data))failoverEnabled=data.failover_enabled!==false&&String(data.failover_mode||"automatic_limp")!=="disabled";
    }catch{}
  }

  cachedConnection={primaryUrl,fallbackUrl:failoverEnabled?fallbackUrl:null,failoverEnabled};
  cachedAt=now;
  return cachedConnection;
}

export async function getMasterApiUrl(){
  return (await getMasterApiConnection()).primaryUrl;
}

export function resetMasterApiConnectionCache(){
  cachedConnection=null;
  cachedAt=0;
}
