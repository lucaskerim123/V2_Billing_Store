import { createClient } from "@supabase/supabase-js";

export const DEFAULT_MASTER_API_URL = "https://incendiarynetworks.cc/api";
const OLD_MASTER_HOST = "api.incendiarynetworks.cc";

function validMasterUrl(value: string) {
  try {
    const u = new URL(value.trim());
    const host = u.hostname.toLowerCase();
    const approvedHost = host === "incendiarynetworks.cc";
    if (
      u.protocol !== "https:" ||
      !approvedHost ||
      host === OLD_MASTER_HOST ||
      u.pathname.replace(/\/$/, "") !== "/api" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    ) return null;
    return `${u.origin}/api`;
  } catch {
    return null;
  }
}

export function normalizeMasterApiUrl(value: string) {
  return validMasterUrl(value) || DEFAULT_MASTER_API_URL;
}

let cachedUrl = DEFAULT_MASTER_API_URL;
let cachedAt = 0;

export async function getMasterApiUrl() {
  const now = Date.now();
  if (now - cachedAt < 30_000) return cachedUrl;

  const envValue = process.env.LICENSE_MASTER_URL?.trim();
  let resolved = envValue ? validMasterUrl(envValue) : null;

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
      if (data?.enabled !== false && data?.master_url) resolved = validMasterUrl(String(data.master_url));
    } catch {
      // Fall back to the validated environment/default URL.
    }
  }

  cachedUrl = resolved || DEFAULT_MASTER_API_URL;
  cachedAt = now;
  return cachedUrl;
}
