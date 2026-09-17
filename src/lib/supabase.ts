import { createBrowserClient } from "@supabase/ssr";

a const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

export function createClient(options:any={}) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required");
  }
  const client=createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, options);
  (client.auth as any).resetPasswordForEmail=async(email:string)=>{
    try{
      const r=await fetch("/api/auth/password-reset/request",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email})});
      const j=await r.json().catch(()=>({}));
      return {data:{},error:r.ok?null:Object.assign(new Error(j.error||"Password reset failed."),{name:"AuthError",status:r.status})};
    }catch(e:any){return {data:{},error:e}}
  };
  return client;
}
