import crypto from "node:crypto";
import {licenseDb} from "@/lib/license-api";
import {sendAutomation} from "@/lib/transactional-server";
import {orbitfsStoreOrigin} from "@/lib/site-origin";

const HOURS=24;
const hash=(value:string)=>crypto.createHash("sha256").update(value,"utf8").digest("hex");

export async function deliverInitialLicenseKey(input:{
  authUserId:string;
  orderId:string;
  licenseId:string;
  licenseKey:string;
  recipient:string;
  customerName?:string|null;
}){
  const db=licenseDb();
  const token=crypto.randomBytes(32).toString("base64url");
  const expiresAt=new Date(Date.now()+HOURS*60*60*1000).toISOString();

  // Only the newest unused delivery for this licence should remain usable.
  await db.from("license_key_deliveries")
    .update({expires_at:new Date().toISOString(),license_key:null})
    .eq("license_id",input.licenseId)
    .is("used_at",null);

  const write=await db.from("license_key_deliveries").insert({
    auth_user_id:input.authUserId,
    order_id:input.orderId,
    license_id:input.licenseId,
    token_hash:hash(token),
    license_key:input.licenseKey,
    expires_at:expiresAt,
  });
  if(write.error)throw write.error;

  const origin=await orbitfsStoreOrigin();
  const revealUrl=`${origin}/license-key?token=${encodeURIComponent(token)}`;
  await sendAutomation(
    "license.key_issued",
    input.recipient,
    {
      customer_name:String(input.customerName||"Customer"),
      license_key_url:revealUrl,
      expires_hours:String(HOURS),
    },
    "order",
    input.orderId,
  );
  return {ok:true,expiresAt};
}
