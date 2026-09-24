import {NextRequest,NextResponse} from 'next/server';
import {sendPaidLifecycleForInvoice} from '@/lib/mail-lifecycle-server';
import {syncPaidOrderToLicenseMaster} from '@/lib/license-master-sync';

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"";

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
 console.error('Stripe License Master fulfilment exhausted retries',{orderId,last});
 return last;
}

export async function POST(req:NextRequest){
 try{
  const raw=await req.text();
  const r=await fetch(`${SUPABASE_URL}/functions/v1/stripe-payment-events`,{method:'POST',headers:{'content-type':req.headers.get('content-type')||'application/json','stripe-signature':req.headers.get('stripe-signature')||''},body:raw,cache:'no-store'});
  const text=await r.text();
  try{
   const d=JSON.parse(text);
   if(r.ok&&d?.paid&&d?.invoice_id){
    await sendPaidLifecycleForInvoice(String(d.invoice_id)).catch(e=>console.error('Stripe webhook lifecycle mail failed',e));
    const dbOrder=await (async()=>{const {createClient}=await import('@/lib/supabase');const sb=createClient();const {data}=await sb.from('invoices').select('order_id').eq('id',String(d.invoice_id)).maybeSingle();return data?.order_id?String(data.order_id):''})();
    if(dbOrder)await fulfillWithRetry(dbOrder);
   }
  }catch(e){console.error('Stripe fulfilment response processing failed',e)}
  return new NextResponse(text,{status:r.status,headers:{'content-type':r.headers.get('content-type')||'application/json'}});
 }catch(e:any){return NextResponse.json({error:e.message||'Stripe webhook failed'},{status:500})}
}
