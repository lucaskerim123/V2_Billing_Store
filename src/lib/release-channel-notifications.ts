import {licenseDb} from "@/lib/license-api";

type Severity="info"|"success"|"warning"|"error";

async function insertNotification(input:{
  recipientUserId:string;surface:"admin"|"portal";eventType:string;title:string;message:string;
  severity?:Severity;actionUrl?:string;sourceId?:string|null;dedupeKey?:string|null;metadata?:Record<string,unknown>;
}){
  const db=licenseDb();
  const {error}=await db.from("notifications").upsert({
    recipient_user_id:input.recipientUserId,
    surface:input.surface,
    category:"release_channel",
    event_type:input.eventType,
    title:input.title,
    message:input.message,
    severity:input.severity||"info",
    source_type:"release_channel",
    source_id:input.sourceId||null,
    action_url:input.actionUrl||null,
    metadata:{kind:"notification",...(input.metadata||{})},
    dedupe_key:input.dedupeKey||null,
    read_at:null,
    archived_at:null,
    created_at:new Date().toISOString()
  },{onConflict:"recipient_user_id,surface,dedupe_key"});
  if(error)throw error;
}

export async function notifyChannelCustomer(userId:string,input:{
  eventType:string;channel:string;label?:string|null;message:string;severity?:Severity;dedupeKey?:string|null;
}){
  const label=String(input.label||input.channel||"release channel");
  await insertNotification({
    recipientUserId:userId,
    surface:"portal",
    eventType:input.eventType,
    title:label,
    message:input.message,
    severity:input.severity,
    sourceId:input.channel,
    actionUrl:"/portal/orbitfs/channels",
    dedupeKey:input.dedupeKey||null,
    metadata:{channel:input.channel}
  });
}

export async function notifyChannelRequestAdmins(input:{channel:string;label?:string|null;customerName:string;customerUserId:string;requestId?:string|null}){
  const db=licenseDb();
  const staff=await db.from("staff_members").select("user_id").eq("status","active");
  if(staff.error)throw staff.error;
  const recipients=[...new Set((staff.data||[]).map((x:any)=>String(x.user_id||"")).filter(Boolean))];
  await Promise.all(recipients.map(userId=>insertNotification({
    recipientUserId:userId,
    surface:"admin",
    eventType:"release_channel.request.pending",
    title:"Release channel request waiting",
    message:`${input.customerName} requested access to ${input.label||input.channel}.`,
    severity:"info",
    sourceId:input.requestId||input.channel,
    actionUrl:"/admin/orbitfs/release-channels",
    dedupeKey:input.requestId?`release-channel-request:${input.requestId}`:null,
    metadata:{channel:input.channel,customer_user_id:input.customerUserId}
  })));
}
