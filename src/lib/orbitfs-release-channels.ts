import {licenseDb} from "@/lib/license-api";

export async function customerReleaseChannels(userId:string){
  const db=licenseDb();
  const [{data:access,error:accessError},{data:openChannels,error:openError}]=await Promise.all([
    db.from("orbitfs_release_channel_access")
      .select("channel_id,orbitfs_release_channels!inner(channel,enabled,customer_visible,access_mode)")
      .eq("user_id",userId),
    db.from("orbitfs_release_channels")
      .select("channel,enabled,customer_visible,access_mode")
      .eq("enabled",true).eq("customer_visible",true).eq("access_mode","open")
  ]);
  if(accessError)throw accessError;if(openError)throw openError;
  const explicit=(access||[]).map((x:any)=>x.orbitfs_release_channels)
    .filter((x:any)=>x?.enabled&&x?.customer_visible)
    .map((x:any)=>String(x.channel)).filter(Boolean);
  const open=(openChannels||[]).map((x:any)=>String(x.channel)).filter(Boolean);
  const configuredStable=(await db.from("orbitfs_release_channels").select("channel,enabled,customer_visible").eq("channel","stable").maybeSingle()).data;\n  const stable=configuredStable?.enabled&&configuredStable?.customer_visible?["stable"]:[];\n  return [...new Set([...stable,...open,...explicit])];
}

export async function customerCanUseReleaseChannel(userId:string,channel:string){
  const channels=await customerReleaseChannels(userId);
  return channels.includes(String(channel||"").trim().toLowerCase());
}
