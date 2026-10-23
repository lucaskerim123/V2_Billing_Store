function env(value:string|undefined){
 const s=String(value||"").trim();
 return s.length>1&&((s.startsWith('"')&&s.endsWith('"'))||(s.startsWith("'")&&s.endsWith("'")))?s.slice(1,-1).trim():s;
}
const SUPABASE_URL=env(process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/,"");
const SUPABASE_KEY=env(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
export async function userFromToken(token:string){
 const r=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:SUPABASE_KEY,authorization:`Bearer ${token}`}});
 if(!r.ok)throw new Error('Unauthorized'); return r.json();
}
export async function userRpc(token:string,name:string,body:any={}){
 const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:SUPABASE_KEY,authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
 if(!r.ok)throw new Error(await r.text()); return r.json();
}
export async function serviceRpc(name:string,body:any={}){
 const key=env(process.env.SUPABASE_SECRET_KEY)||env(process.env.SUPABASE_SERVICE_ROLE_KEY);if(!key)throw new Error('A Supabase server credential is not configured');
 const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify(body)});
 if(!r.ok)throw new Error(await r.text()); return r.json();
}
export async function gatewaySecret(code:string,key:string){const envMap:any={stripe:{secret_key:'STRIPE_SECRET_KEY',webhook_secret:'STRIPE_WEBHOOK_SECRET'},paypal:{client_id:'PAYPAL_CLIENT_ID',client_secret:'PAYPAL_CLIENT_SECRET',webhook_id:'PAYPAL_WEBHOOK_ID'}};const env=envMap[code]?.[key];if(env&&process.env[env])return process.env[env] as string;const v=await serviceRpc('service_gateway_secret',{p_gateway_code:code,p_key:key});return typeof v==='string'?v:null}
export async function gatewayRuntime(code:string){return serviceRpc('service_gateway_runtime_config',{p_gateway_code:code})}
export async function stripeRequest(path:string,init:RequestInit={}){
 const key=await gatewaySecret('stripe','secret_key');if(!key)throw new Error('Stripe secret key is not configured');
 const r=await fetch(`https://api.stripe.com${path}`,{...init,headers:{authorization:`Bearer ${key}`,...(init.headers||{})}});
 if(!r.ok)throw new Error((await r.json().catch(()=>({})))?.error?.message||`Stripe error ${r.status}`);return r.json();
}
export async function paypalToken(){
 const id=await gatewaySecret('paypal','client_id'),secret=await gatewaySecret('paypal','client_secret');if(!id||!secret)throw new Error('PayPal credentials are not configured');
 const cfg=await gatewayRuntime('paypal');const base=(process.env.PAYPAL_ENV==='live'||cfg?.environment==='live')?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';
 const r=await fetch(`${base}/v1/oauth2/token`,{method:'POST',headers:{authorization:`Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,'content-type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
 if(!r.ok)throw new Error('PayPal authentication failed');const d=await r.json();return {base,token:d.access_token as string};
}