import {NextRequest,NextResponse} from 'next/server';
import {paymentRuntime,runtimeJson} from '@/lib/paymentRuntime';
import {sendPaidLifecycleForInvoice} from '@/lib/billing-lifecycle-events';
import {orbitfsStoreOrigin} from '@/lib/site-origin';

export async function GET(req:NextRequest){
 const u=new URL(req.url),wallet=u.searchParams.get('wallet')==='1';
 const origin=await orbitfsStoreOrigin(req.url);
 try{
  const r=await paymentRuntime('return_paypal',{origin,query:{attempt:u.searchParams.get('attempt'),token:u.searchParams.get('token')}});
  const d=await runtimeJson(r);
  if(!r.ok)throw new Error(d.error||'PayPal payment return failed');
  if(d.wallet_recharge_id){const q=new URLSearchParams({tab:'wallet',recharge:'success',receipt:String(d.wallet_recharge_id)});return NextResponse.redirect(new URL(`/portal/settings?${q.toString()}`,origin))}
  if(d.invoice_id)await sendPaidLifecycleForInvoice(String(d.invoice_id)).catch(e=>console.error('PayPal lifecycle mail failed',e));
  return NextResponse.redirect(new URL(`/portal/invoices/${d.invoice_id}?payment=success`,origin));
 }catch(e:any){const m=encodeURIComponent(e.message||'PayPal payment failed');return NextResponse.redirect(new URL(wallet?`/portal/settings?tab=wallet&recharge=error&payment_error=${m}`:`/portal/invoices?payment_error=${m}`,origin))}
}
