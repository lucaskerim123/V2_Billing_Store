import {NextRequest,NextResponse} from 'next/server';
import {paymentRuntime} from '@/lib/paymentRuntime';
import {sendPaidLifecycleForInvoice} from '@/lib/mail-lifecycle-server';
import {orbitfsStoreOrigin} from '@/lib/site-origin';
import {syncPaidOrderToLicenseMaster} from '@/lib/license-master-sync';

async function fulfillWithRetry(orderId:string){
 let last:any=null;
 for(let attempt=1;attempt<=3;attempt++){
  try{
   const result=await syncPaidOrderToLicenseMaster(orderId);
   if(result?.ok!==false&&result?.failed===0)return result;
   last=result;
   if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*750));
  }catch(e:any){
   last=e;
   if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*750));
  }
 }
 console.error('PayPal License Master fulfilment exhausted retries',{orderId,last});
 return last;
}

export async function POST(req:NextRequest){
 try{
  const raw=await req.text();
  const origin=await orbitfsStoreOrigin(req.url);
  const names=['paypal-auth-algo','paypal-cert-url','paypal-transmission-id','paypal-transmission-sig','paypal-transmission-time'];
  const headers:Record<string,string>={'content-type':'application/json'};
  for(const name of names)headers[name]=req.headers.get(name)||'';
  const r=await paymentRuntime('webhook_paypal',{origin,rawBody:raw,headers});
  const text=await r.text();
  try{
   const d=JSON.parse(text);
   if(r.ok&&d?.paid&&d?.invoice_id){
    await sendPaidLifecycleForInvoice(String(d.invoice_id)).catch(e=>console.error('PayPal webhook lifecycle mail failed',e));
    const db=await import('@/lib/supabase');const sb=db.createClient();const {data}=await sb.from('invoices').select('order_id').eq('id',String(d.invoice_id)).maybeSingle();
    if(data?.order_id)await fulfillWithRetry(String(data.order_id));
   }
  }catch(e){console.error('PayPal fulfilment response processing failed',e)}
  return new NextResponse(text,{status:r.status,headers:{'content-type':r.headers.get('content-type')||'application/json'}});
 }catch(e:any){return NextResponse.json({error:e.message||'PayPal webhook failed'},{status:500})}
}
