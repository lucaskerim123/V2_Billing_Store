import {licenseDb} from "@/lib/license-api";
import {masterRequest} from "@/lib/master-api";

export async function customerReleaseChannels(userId:string){
  const db=licenseDb();
  const binding=await db.from("license_bindings").select("license_id").eq("auth_user_id",userId).eq("license_product_key","orbitfs_base").is("archived_at",null).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(binding.error)throw binding.error;
  const licenseId=String(binding.data?.license_id||"");
  if(!licenseId)return ["stable"];
  const [channelResult,accessResult]=await Promise.all([
    masterRequest("/api/v1/release-channels?include_disabled=false",{method:"GET"},"billing"),
    masterRequest("/api/v1/release-channels/access",{method:"POST",body:JSON.stringify({action:"list_access",license_id:licenseId})},"billing")
  ]);
  const channels=Array.isArray(channelResult?.channels)?channelResult.channels:[];
  const access=Array.isArray(accessResult?.access)?accessResult.access:[];
  const explicit=new Set(access.map((x:any)=>String(x.channel||"").trim().toLowerCase()).filter(Boolean));
  const allowed=channels.filter((c:any)=>c.enabled!==false&&c.customer_visible!==false).filter((c:any)=>c.channel==="stable"||c.access_mode==="open"||explicit.has(String(c.channel).toLowerCase())).map((c:any)=>String(c.channel).toLowerCase());
  if(!allowed.includes("stable")&&channels.some((c:any)=>c.channel==="stable"&&c.enabled!==false&&c.customer_visible!==false))allowed.unshift("stable");
  return [...new Set(allowed)];
}

export async function customerCanUseReleaseChannel(userId:string,channel:string){
  const channels=await customerReleaseChannels(userId);
  return channels.includes(String(channel||"").trim().toLowerCase());
}
