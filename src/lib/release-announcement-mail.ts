import {licenseDb} from "@/lib/license-api";
import {customerCanUseReleaseChannel} from "@/lib/orbitfs-release-channels";
import {sendAutomation} from "@/lib/transactional-server";

// Billing only announces a release once License Manager confirms publication.
// Customer channel access is checked against License Manager for each recipient.
export async function announcePublishedUpdate(release:any){
 const releaseId=String(release?.id||"").trim();
 const channel=String(release?.channel||"stable").toLowerCase();
 if(!releaseId||String(release?.release_type||"").toLowerCase()!=="update"||String(release?.status||"").toLowerCase()!=="published")return {sent:0,skipped:0};
 const db=licenseDb();
 const {data:bindings,error}=await db.from("license_bindings").select("auth_user_id").eq("license_product_key","orbitfs_base").is("archived_at",null).limit(1000);
 if(error)throw error;
 const ids=[...new Set((bindings||[]).map((b:any)=>String(b.auth_user_id||"")).filter(Boolean))];
 if(!ids.length)return {sent:0,skipped:0};
 const {data:customers,error:ce}=await db.from("customers").select("auth_user_id,email,name").in("auth_user_id",ids);
 if(ce)throw ce;
 const {data:logs,error:le}=await db.from("mail_delivery_log").select("recipient,event_type,status").eq("event_type","release.update_released").eq("related_type","release").eq("related_id",releaseId).eq("status","sent");
 if(le)throw le;
 const sentTo=new Set((logs||[]).map((x:any)=>String(x.recipient||"").toLowerCase()));
 let sent=0,skipped=0;
 for(const customer of customers||[]){
  const email=String(customer.email||"").trim();
  if(!email||sentTo.has(email.toLowerCase())){skipped++;continue}
  try{
   if(!await customerCanUseReleaseChannel(String(customer.auth_user_id),channel)){skipped++;continue}
   const result=await sendAutomation("release.update_released",email,{
    customer_name:String(customer.name||"Customer"),
    product_name:String(release.product||"OrbitFS"),
    version:String(release.version||""),
    channel,
    release_notes:String(release.customer_notes||release.changelog||""),
    release_url:"https://billing.incendiarynetworks.cc/portal/orbitfs/releases"
   },"release",releaseId);
   if(result?.skipped)skipped++;else{sent++;sentTo.add(email.toLowerCase())}
  }catch(error){console.error("[orbitfs/release-announcement] Email failed",error)}
 }
 return {sent,skipped};
}
