import {createClient} from "@supabase/supabase-js";

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const SUPABASE_PUBLIC_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";

export type MailRuntimeConfig={
  outbound:{
    sender_name:string;
    default_from:string;
    reply_to:string;
    customer_sender:string;
    customer_sender_name:string;
    system_sender:string;
    support_sender:string;
    billing_sender:string;
  };
  inbound:{domain:string;enabled:boolean};
  provider:{name:string};
};

export const DEFAULT_MAIL_CONFIG:MailRuntimeConfig={
  outbound:{
    sender_name:"OrbitFS",
    default_from:"info@orbitfs.cc",
    reply_to:"support@orbitfs.cc",
    customer_sender:"support@orbitfs.cc",
    customer_sender_name:"OrbitFS Support",
    system_sender:"info@orbitfs.cc",
    support_sender:"support@orbitfs.cc",
    billing_sender:"billing@orbitfs.cc",
  },
  inbound:{domain:"orbitfs.cc",enabled:true},
  provider:{name:"resend"},
};

function text(v:any,fallback:string){const s=String(v??"").trim();return s||fallback}

export function normaliseMailRuntimeConfig(raw:any):MailRuntimeConfig{
  const o=raw?.outbound||{},i=raw?.inbound||{},p=raw?.provider||{};
  const systemSender=text(o.system_sender,o.default_from||DEFAULT_MAIL_CONFIG.outbound.system_sender).toLowerCase();
  const supportSender=text(o.support_sender,o.customer_sender||DEFAULT_MAIL_CONFIG.outbound.support_sender).toLowerCase();
  const billingSender=text(o.billing_sender,DEFAULT_MAIL_CONFIG.outbound.billing_sender).toLowerCase();
  return {
    outbound:{
      sender_name:text(o.sender_name,DEFAULT_MAIL_CONFIG.outbound.sender_name),
      default_from:systemSender,
      reply_to:text(o.reply_to,DEFAULT_MAIL_CONFIG.outbound.reply_to).toLowerCase(),
      customer_sender:supportSender,
      customer_sender_name:text(o.customer_sender_name,DEFAULT_MAIL_CONFIG.outbound.customer_sender_name),
      system_sender:systemSender,
      support_sender:supportSender,
      billing_sender:billingSender,
    },
    inbound:{domain:text(i.domain,DEFAULT_MAIL_CONFIG.inbound.domain).toLowerCase(),enabled:i.enabled!==false},
    provider:{name:text(p.name,DEFAULT_MAIL_CONFIG.provider.name).toLowerCase()},
  };
}

export async function loadMailRuntimeConfig(db?:any):Promise<MailRuntimeConfig>{
  const client=db||createClient(SUPABASE_URL,SUPABASE_PUBLIC_KEY,{auth:{persistSession:false}});
  const {data,error}=await client.rpc("mail_runtime_config");
  if(error)return DEFAULT_MAIL_CONFIG;
  return normaliseMailRuntimeConfig(data);
}

function requestedRole(fromAccount?:string){
  const v=String(fromAccount||"").trim().toLowerCase();
  if(!v||v==="role:system"||v==="system"||v==="noreply@orbitfs.cc"||v==="info@orbitfs.cc")return "system";
  if(v==="role:support"||v==="support"||v==="support@orbitfs.cc")return "support";
  if(v==="role:billing"||v==="billing"||v==="billing@orbitfs.cc")return "billing";
  return "";
}

export function deliveryIdentity(config:MailRuntimeConfig,fromAccount?:string){
  const role=requestedRole(fromAccount);
  const requested=String(fromAccount||"").trim().toLowerCase();
  const from=role==="system"?config.outbound.system_sender:role==="support"?config.outbound.support_sender:role==="billing"?config.outbound.billing_sender:text(requested,config.outbound.default_from).toLowerCase();
  const replyTo=role==="support"?config.outbound.support_sender:role==="billing"?config.outbound.billing_sender:config.outbound.reply_to;
  return {from,replyTo,name:config.outbound.sender_name};
}

export async function resolveMailDeliveryIdentity(db:any,config:MailRuntimeConfig,fromAccount?:string){
  const base=deliveryIdentity(config,fromAccount);
  if(!db)return base;
  const {data}=await db.rpc("mail_sender_identity",{p_address:base.from});
  return {...base,name:text(data?.display_name,base.name)};
}
