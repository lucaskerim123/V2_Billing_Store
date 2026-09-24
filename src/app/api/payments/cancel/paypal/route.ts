import {NextRequest,NextResponse} from 'next/server';
import {orbitfsStoreOrigin} from '@/lib/site-origin';

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const SUPABASE_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||'';

export async function GET(req:NextRequest){
 const u=new URL(req.url);
 const attempt=String(u.searchParams.get('attempt')||'');
 const invoice=String(u.searchParams.get('invoice')||'');
 const token=String(u.searchParams.get('token')||'');
 try{
  if(attempt&&token){
   await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_paypal_checkout_cancel`,{
    method:'POST',
    headers:{apikey:SUPABASE_KEY,'content-type':'application/json'},
    body:JSON.stringify({p_attempt_id:attempt,p_token:token}),
    cache:'no-store'
   });
  }
 }catch{}
 const target=invoice?`/portal/invoices/${encodeURIComponent(invoice)}?payment=cancelled`:'/portal/orders?payment=cancelled';
 const origin=await orbitfsStoreOrigin(req.url);
 return NextResponse.redirect(new URL(target,origin));
}
