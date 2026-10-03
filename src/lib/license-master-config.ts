import { createClient } from "@supabase/supabase-js";

export const TRUSTED_MASTER_BOOTSTRAP_URL = "https://incendiarynetworks.cc/api/v1";
export const DEFAULT_MASTER_API_URL = TRUSTED_MASTER_BOOTSTRAP_URL;

function validMasterUrl(value: string) {
  try {
    const u = new URL(value.trim());
    const host = u.hostname.toLowerCase();
    if (
      u.protocol !== "https:" ||
      (host!=="incendiarynetworks.cc"&&!host.endsWith(".incendiarynetworks.cc")) ||
      u.pathname.replace(/\/+$/, "") !== "/api/v1" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    ) return null;
    return `${u.origin}/api/v1`;
  } catch {
    return null;
  }
}

export function normalizeMasterApiUrl(value: string) {
  return validMasterUrl(value) || "";
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
};

let registryCache:{expires:number;connections:OfficialApiConnection[]}|null=null;

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
        .filter((row:any)=>row?.enabled!==false&&validMasterUrl(String(row?.base_url||"")))
        .map((row:any)=>({...row,base_url:validMasterUrl(String(row.base_url))!}));
    }
  }catch{}
  if(!connections.length)connections=[{
    service_key:"license_manager",
    label:"Primary License Manager API",
    base_url:TRUSTED_MASTER_BOOTSTRAP_URL,
    allowed_clients:["billing_store"],
    enabled:true,
    priority:10,
    settings:{bootstrap:true}
  }];
  connections.sort((a,b)=>Number(a.priority||100)-Number(b.priority||100));
  registryCache={expires:Date.now()+86_400_000,connections};
  return connections;
}

export async function requireOfficialMasterApiUrl(value:string){
  const normalized=validMasterUrl(value);
  if(!normalized)throw new Error("License Manager URL must be an official HTTPS /api/v1 endpoint.");
  const official=await getOfficialMasterApiConnections(true);
  if(!official.some(row=>row.base_url===normalized))throw new Error("That URL is not an enabled official OrbitFS License Manager API.");
  return normalized;
}

let cachedUrl = TRUSTED_MASTER_BOOTSTRAP_URL;
let cachedAt = 0;

export async function getMasterApiUrl() {
  const now = Date.now();
  if (now - cachedAt < 5_400_000) return cachedUrl;

  const official=await getOfficialMasterApiConnections();
  const allowed=new Set(official.map(row=>row.base_url));
  let resolved=TRUSTED_MASTER_BOOTSTRAP_URL;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (supabaseUrl && serviceKey) {
    try {
      const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data } = await sb
        .from("license_master_connection")
        .select("master_url,enabled,updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const saved=data?.enabled!==false&&data?.master_url?validMasterUrl(String(data.master_url)):null;
      if(saved&&allowed.has(saved))resolved=saved;
    } catch {
      // Use the trusted official registry/default.
    }
  }

  cachedUrl=resolved;
  cachedAt=now;
  return cachedUrl;
}

export function clearMasterApiCache(){
  registryCache=null;
  cachedAt=0;
}
