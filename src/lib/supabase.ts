import { createBrowserClient } from "@supabase/ssr";

const RAW_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const RAW_SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

function normalizePublicEnv(raw: string) {
  const trimmed = raw.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function getSupabaseConfig() {
  const url = normalizePublicEnv(RAW_SUPABASE_URL);
  const publishableKey = normalizePublicEnv(RAW_SUPABASE_PUBLISHABLE_KEY);

  if (!url || !publishableKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid absolute HTTP or HTTPS URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use HTTP or HTTPS");
  }

  return { url: parsed.toString().replace(/\/$/, ""), publishableKey };
}

export function createClient() {
  const { url, publishableKey } = getSupabaseConfig();
  const client=createBrowserClient(url, publishableKey);
  (client.auth as any).resetPasswordForEmail=async(email:string)=>{
    try{
      const r=await fetch("/api/auth/password-reset/request",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email})});
      const j=await r.json().catch(()=>({}));
      return {data:{},error:r.ok?null:Object.assign(new Error(j.error||"Password reset failed."),{name:"AuthError",status:r.status})};
    }catch(e:any){return {data:{},error:e}}
  };
  return client;
}
