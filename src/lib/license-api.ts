import {createClient as createSupabaseClient} from "@supabase/supabase-js";
import {masterValidate,masterIssue,masterControl} from "@/lib/master-api";
import {createClient as createBrowserSupabaseClient} from "@/lib/supabase";

// Vercel imports can include surrounding quotes or newlines. Normalize the
// credential before it becomes the apikey and Authorization header.
function environmentValue(value:string|undefined){
 const trimmed=String(value||"").trim();
 if(trimmed.length>1&&((trimmed[0]==='"'&&trimmed.at(-1)==='"')||(trimmed[0]==="'"&&trimmed.at(-1)==="'")))
   return trimmed.slice(1,-1).trim();
 return trimmed;
}
const url=environmentValue(process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/,"");
const key=environmentValue(process.env.SUPABASE_SECRET_KEY)||environmentValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
const SUPABASE_REQUEST_TIMEOUT_MS=Math.min(15000,Math.max(1000,Number(process.env.SUPABASE_REQUEST_TIMEOUT_MS||8000)));

async function boundedFetch(input:RequestInfo|URL,init?:RequestInit){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),SUPABASE_REQUEST_TIMEOUT_MS);
  try{return await fetch(input,{...init,signal:init?.signal||controller.signal,cache:"no-store"})}
  catch(e:any){if(e?.name==="AbortError")throw new Error(`Supabase request timed out after ${SUPABASE_REQUEST_TIMEOUT_MS}ms`);throw e}
  finally{clearTimeout(timer)}
}

export const licenseDb=()=>{
  if(!url||!key)throw new Error("NEXT_PUBLIC_SUPABASE_URL and a server-only SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY are required");
  return createSupabaseClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:boundedFetch}});
};
export const cors={"access-control-allow-origin":"*","access-control-allow-headers":"content-type,authorization","access-control-allow-methods":"GET,POST,OPTIONS","cache-control":"no-store"};
export const reply=(body:any,status=200)=>Response.json(body,{status,headers:cors});
export const bodyOf=async(req:Request)=>{
  const length=Number(req.headers.get("content-length")||0);if(length>1024*1024)throw new Error("Request body exceeds 1 MiB limit");
  return req.json().catch(()=>({}));
};
export {masterValidate,masterIssue,masterControl};

/** Returns the currently signed-in user's Supabase access token for browser-side authenticated admin calls. */
export const getClientAccessToken=async()=>{
  const supabase=createBrowserSupabaseClient();
  const {data,error}=await supabase.auth.getSession();
  if(error)throw error;
  return data.session?.access_token||null;
};

/** The Website is a client of the Master. It never signs, stores, or authorizes licences. */
export const licensingAuthority="orbitfs-license-master-v2";
