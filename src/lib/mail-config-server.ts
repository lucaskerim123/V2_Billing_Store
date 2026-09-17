import {createClient} from "@supabase/supabase-js";

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://bealqgenrcytjzjoikmk.supabase.co";
const SUPABASE_PUBLIC_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";

export type MailRuntimeConfig={
  outbound:{
    sender_name:string;
    default_from:string;
    reply_to:string;
    customer_sender:string;
    customer_sender_name:string;
  };
  inbound:{domain:string;enabled:boolean};
  provider:{name:string};
};

export const DEFAULT_MAIL_CONFIG:MailRuntimeConfig={
  outbound:{
    sender_name:"OrbitFS",
    default_from:"noreply@orbitfs.cc",
    reply_to:"admin@orbitfs.cc",
    customer_sender:"support@orbitfs.cc",
    customer_sender_name:"OrbitFS Support",
  },
  inbound:{domain:"orbitfs.cc",enabled:true},
  provider:{name:"resend"},
};

function text(v:any,fallback:string){const s=String(v??"").trim();return s||fallback}

export function normaliseMailRuntimeConfig(raw:any):MailRuntimeConfig{
  const o=raw?.outbound||{},i=raw?.inbound||{},p=raw?.provider||{};
  return {
    outbound:{
      sender_name:text(o.sender_name,DEFAULT_MAIL_CONFIG.outbound.sender_name),
      default_from:text(o.default_from,DEFAULT_MAIL_CONFIG.outbound.default_from).toLowerCase(),
      reply_to:text(o.reply_to,DEFAULT_MAIL_CONFIG.outbound.reply_to).toLowerCase(),
      customer_sender:text(o.customer_sender,DEFAULT_MAIL_CONFIG.outbound.customer_sender).toLowerCase(),
      customer_sender_name:text(o.customer_sender_name,DEFAULT_MAIL_CONFIG.outbound.customer_sender_name),
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

export function deliveryIdentity(config:MailRuntimeConfig,fromAccount?:string){
  const from=text(fromAccount,config.outbound.default_from).toLowerCase();
  const replyTo=from===config.outbound.default_from?config.outbound.reply_to:from;
  return {from,replyTo,name:config.outbound.sender_name};
}

export async function resolveMailDeliveryIdentity(db:any,config:MailRuntimeConfig,fromAccount?:string){
  const base=deliveryIdentity(config,fromAccount);
  if(!db)return base;
  const {data}=await db.rpc("mail_sender_identity",{p_address:base.from});
  return {...base,name:text(data?.display_name,base.name)};
}
