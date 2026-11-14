import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL=Deno.env.get('SUPABASE_URL')!;
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const svc=createClient(URL,SERVICE,{auth:{persistSession:false}});
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const message=(e:any)=>e instanceof Error?e.message:String(e);

function normalizeOrigin(value:string){
  try{return new URL(String(value||'')).origin.replace(/\/$/,'')}catch{return ''}
}

async function requireSyncToken(req:Request){
  const provided=req.headers.get('x-orbitfs-sync-token')||'';
  const {data,error}=await svc.from('app_settings').select('value').eq('key','internal.gateway_sync_token').maybeSingle();
  if(error)throw error;
  const expected=typeof data?.value==='string'?data.value:String(data?.value||'');
  if(!expected||!provided||provided!==expected)throw new Error('Forbidden');
}

async function canonicalOrigin(){
  const {data}=await svc.from('app_settings').select('value').eq('key','site.public_url').maybeSingle();
  return normalizeOrigin(typeof data?.value==='string'?data.value:String(data?.value||''))||'https://billing.incendiarynetworks.cc';
}

async function gatewayContext(code:string){
  const {data:g,error}=await svc.from('payment_gateways').select('id,code,enabled').eq('code',code).maybeSingle();
  if(error)throw error;
  if(!g)return null;
  const {data:s,error:se}=await svc.from('payment_gateway_setups').select('*').eq('gateway_id',g.id).maybeSingle();
  if(se)throw se;
  return {gateway:g,setup:s};
}

async function secret(code:string,key:string){
  const {data,error}=await svc.rpc('service_gateway_secret',{p_gateway_code:code,p_key:key});
  if(error)throw error;
  return typeof data==='string'&&data?data:null;
}

async function saveResult(ctx:any,target:string,providerId:string,ok:boolean,errorMessage:string|null){
  if(!ctx?.setup)return;
  const now=new Date().toISOString();
  const webhook={...(ctx.setup.webhook_config||{})};
  if(ok){webhook.provider_webhook_id=providerId;webhook.registered_url=target;webhook.registered_at=webhook.registered_at||now;webhook.canonical_synced_at=now}
  const metadata={...(ctx.setup.metadata||{}),canonical_store_origin:target.replace(/\/api\/payments\/webhook\/(stripe|paypal)$/,''),webhook_reconfigure_required:!ok,canonical_sync_checked_at:now};
  if(errorMessage)metadata.canonical_sync_error=errorMessage;else delete metadata.canonical_sync_error;
  const patch:any={webhook_config:webhook,metadata,updated_at:now};
  if(ok){patch.last_verified_at=now;patch.last_verify_error=null}else patch.last_verify_error=errorMessage;
  const {error}=await svc.from('payment_gateway_setups').update(patch).eq('gateway_id',ctx.gateway.id);
  if(error)throw error;
}

async function syncStripe(origin:string){
  const ctx=await gatewayContext('stripe');
  if(!ctx?.gateway?.enabled||!ctx.setup)return {gateway:'stripe',skipped:true,reason:'not enabled or configured'};
  const target=`${origin}/api/payments/webhook/stripe`;
  const providerId=String(ctx.setup.webhook_config?.provider_webhook_id||'');
  if(!providerId)return {gateway:'stripe',ok:false,error:'Stripe provider webhook ID is missing'};
  try{
    const key=await secret('stripe','secret_key');
    if(!key)throw new Error('Stripe secret key is not configured');
    const lookup=await fetch(`https://api.stripe.com/v1/webhook_endpoints/${encodeURIComponent(providerId)}`,{headers:{authorization:`Bearer ${key}`}});
    const current=await lookup.json().catch(()=>({}));
    if(!lookup.ok)throw new Error(current?.error?.message||`Stripe webhook lookup failed (${lookup.status})`);
    if(String(current.url||'')!==target){
      const form=new URLSearchParams();form.set('url',target);
      const r=await fetch(`https://api.stripe.com/v1/webhook_endpoints/${encodeURIComponent(providerId)}`,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/x-www-form-urlencoded'},body:form});
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d?.error?.message||`Stripe webhook update failed (${r.status})`);
      if(String(d.url||'')!==target)throw new Error('Stripe returned a different webhook URL after update');
    }
    await saveResult(ctx,target,providerId,true,null);
    return {gateway:'stripe',ok:true,url:target,provider_webhook_id:providerId,changed:String(current.url||'')!==target};
  }catch(e){const m=message(e);await saveResult(ctx,target,providerId,false,m).catch(()=>null);return {gateway:'stripe',ok:false,error:m}}
}

async function paypalToken(environment:string){
  const id=await secret('paypal','client_id'),sec=await secret('paypal','client_secret');
  if(!id||!sec)throw new Error('PayPal client ID and client secret are not configured');
  const base=environment==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';
  const r=await fetch(`${base}/v1/oauth2/token`,{method:'POST',headers:{authorization:`Basic ${btoa(`${id}:${sec}`)}`,'content-type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.access_token)throw new Error(d?.error_description||'PayPal authentication failed');
  return {base,token:String(d.access_token)};
}

async function syncPaypal(origin:string){
  const ctx=await gatewayContext('paypal');
  if(!ctx?.gateway?.enabled||!ctx.setup)return {gateway:'paypal',skipped:true,reason:'not enabled or configured'};
  const target=`${origin}/api/payments/webhook/paypal`;
  const providerId=String(ctx.setup.webhook_config?.provider_webhook_id||'');
  if(!providerId)return {gateway:'paypal',ok:false,error:'PayPal provider webhook ID is missing'};
  try{
    const {base,token}=await paypalToken(String(ctx.setup.environment||'sandbox'));
    const lookup=await fetch(`${base}/v1/notifications/webhooks/${encodeURIComponent(providerId)}`,{headers:{authorization:`Bearer ${token}`}});
    const current=await lookup.json().catch(()=>({}));
    if(!lookup.ok)throw new Error(current?.message||current?.details?.[0]?.description||`PayPal webhook lookup failed (${lookup.status})`);
    if(String(current.url||'')!==target){
      const r=await fetch(`${base}/v1/notifications/webhooks/${encodeURIComponent(providerId)}`,{method:'PATCH',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify([{op:'replace',path:'/url',value:target}])});
      if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d?.message||d?.details?.[0]?.description||`PayPal webhook update failed (${r.status})`)}
      const verify=await fetch(`${base}/v1/notifications/webhooks/${encodeURIComponent(providerId)}`,{headers:{authorization:`Bearer ${token}`}});
      const vd=await verify.json().catch(()=>({}));
      if(!verify.ok||String(vd.url||'')!==target)throw new Error('PayPal webhook URL did not verify after update');
    }
    await saveResult(ctx,target,providerId,true,null);
    return {gateway:'paypal',ok:true,url:target,provider_webhook_id:providerId,changed:String(current.url||'')!==target};
  }catch(e){const m=message(e);await saveResult(ctx,target,providerId,false,m).catch(()=>null);return {gateway:'paypal',ok:false,error:m}}
}

Deno.serve(async(req)=>{
  try{
    if(req.method==='OPTIONS')return new Response(null,{status:204});
    if(req.method!=='POST')return json({error:'Method not allowed'},405);
    await requireSyncToken(req);
    const origin=await canonicalOrigin();
    const results=await Promise.all([syncStripe(origin),syncPaypal(origin)]);
    const ok=results.every((x:any)=>x.ok||x.skipped);
    return json({ok,origin,results,synced_at:new Date().toISOString()},ok?200:502);
  }catch(e){const m=message(e);return json({error:m},m==='Forbidden'?403:500)}
});
