import {licenseDb} from "@/lib/license-api";

export async function customerReleaseChannels(userId:string){
  const db=licenseDb();
  const {data,error}=await db.from("orbitfs_release_channel_access")
    .select("channel_id,orbitfs_release_channels!inner(channel,enabled,customer_visible)")
    .eq("user_id",userId);
  if(error)throw error;
  const rows=(data||[]).map((x:any)=>x.orbitfs_release_channels).filter((x:any)=>x?.enabled&&x?.customer_visible);
  if(!rows.length)return ["stable"];
  return rows.map((x:any)=>String(x.channel)).filter(Boolean);
}

export async function customerCanUseReleaseChannel(userId:string,channel:string){
  const channels=await customerReleaseChannels(userId);
  return channels.includes(String(channel||"").trim().toLowerCase());
}
