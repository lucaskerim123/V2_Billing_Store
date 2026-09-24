import {NextRequest,NextResponse} from 'next/server';
import {orbitfsStoreOrigin} from '@/lib/site-origin';

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const SUPABASE_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||'';

export async function GET(req:NextRequest){
 const u=new URL(req.url);
 const attempt=String(u.searchParams.get('attempt')||'');
 const token=String(u.searchParams.get('token')||'');
 let recharge='';
 try{
  if(attempt&&token){
   const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_wallet_checkout_cancel`,{
    method:'POST',
    headers:{apikey:SUPABASE_KEY,'content-type':'application/json'},
    body:JSON.stringify({p_attempt_id:attempt,p_token:token}),
    cache:'no-store'
   });
   const d=await r.json().catch(()=>({}));
   recharge=String(d?.wallet_recharge_id||'');
  }
 }catch{}
 const q=new URLSearchParams({tab:'wallet',recharge:'cancelled'});if(recharge)q.set('receipt',recharge);
 const origin=await orbitfsStoreOrigin(req.url);
 return NextResponse.redirect(new URL(`/portal/settings?${q.toString()}`,origin));
}
