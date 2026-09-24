import {NextRequest,NextResponse} from 'next/server';
import {paymentRuntime,runtimeJson} from '@/lib/paymentRuntime';
import {orbitfsStoreOrigin} from '@/lib/site-origin';

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const SUPABASE_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||'';

async function rpc(auth:string,name:string,body:any){
 const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:SUPABASE_KEY,authorization:auth,'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
 const text=await r.text();if(!r.ok)throw new Error(text||`${name} failed`);return text?JSON.parse(text):null;
}

export async function POST(req:NextRequest){
 try{
  const auth=req.headers.get('authorization')||'';
  if(!auth.startsWith('Bearer '))return NextResponse.json({error:'Unauthorized'},{status:401});
  const enforcement:any=await rpc(auth,'account_enforcement_status',{});
  if(enforcement?.state&&enforcement.state!=='active')return NextResponse.json({error:enforcement.state==='banned'?'Account banned. Contact support via ticket or support@orbitfs.cc.':'Account suspended. Purchasing and payments are unavailable. Contact support via ticket or support@orbitfs.cc.',enforcement},{status:403});
  const body=await req.json().catch(()=>({}));
  const attemptId=String(body.attempt_id||'');
  if(!attemptId)return NextResponse.json({error:'Missing payment attempt'},{status:400});

  const existing:any=await rpc(auth,'payment_attempt_checkout_state',{p_attempt_id:attemptId});
  if(['stripe','paypal'].includes(String(existing?.gateway_code))&&existing?.checkout_url&&existing?.provider_reference&&!['failed','expired','cancelled','succeeded'].includes(String(existing.status))){
   await rpc(auth,'record_payment_start_observation',{p_attempt_id:attemptId});
   return NextResponse.json({url:String(existing.checkout_url),provider_reference:String(existing.provider_reference),reused:true});
  }

  const origin=await orbitfsStoreOrigin(req.url);
  const r=await paymentRuntime('start_checkout',{authorization:auth,origin,body:{attempt_id:attemptId,origin}});
  const d:any=await runtimeJson(r);
  if(r.ok&&d?.url&&existing?.gateway_code==='stripe'){
   const sessionId=String(d.url).match(/(cs_(?:live|test)_[A-Za-z0-9]+)/)?.[1]||'';
   if(sessionId){
    await rpc(auth,'record_payment_checkout_start',{p_attempt_id:attemptId,p_provider_reference:sessionId,p_checkout_url:String(d.url),p_metadata:{stripe_session_id:sessionId,reused:false}});
    d.session_id=sessionId;
   }
  }
  await rpc(auth,'record_payment_start_observation',{p_attempt_id:attemptId}).catch(e=>console.error('Payment attempt observation failed',e));
  return NextResponse.json(d,{status:r.status});
 }catch(e:any){return NextResponse.json({error:e.message||'Unable to start payment'},{status:500})}
}
