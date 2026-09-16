import {createClient as createSupabaseClient} from "@supabase/supabase-js";
import {masterValidate,masterIssue,masterControl} from "@/lib/master-api";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
export const licenseDb=()=>{
  if(!url||!key)throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or publishable key) are required");
  return createSupabaseClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
};
export const cors={"access-control-allow-origin":"*","access-control-allow-headers":"content-type,authorization","access-control-allow-methods":"GET,POST,OPTIONS","cache-control":"no-store"};
export const reply=(body:any,status=200)=>Response.json(body,{status,headers:cors});
export const bodyOf=async(req:Request)=>req.json().catch(()=>({}));
export {masterValidate,masterIssue,masterControl};

/** The Website is a client of the Master. It never signs, stores, or authorizes licences. */
export const licensingAuthority="orbitfs-license-master-v2";
