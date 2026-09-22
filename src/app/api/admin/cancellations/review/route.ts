import {NextRequest,NextResponse} from 'next/server';
import {paypalToken,stripeRequest,userRpc} from '@/lib/paymentServer';

const committed=(status:string)=>['pending','processing','completed','succeeded'].includes(status);

async function processRefund(token:string,requestId:string){
 const plan:any=await userRpc(token,'cancellation_refund_plan',{p_request_id:requestId});
 if(!plan?.refund_required||Number(plan.remaining_cents||0)<=0){
  return userRpc(token,'finalize_cancellation_refund',{p_request_id:requestId,p_error:null});
 }
 if(plan.refund_preference==='wallet'){
  return userRpc(token,'process_cancellation_wallet_refund',{p_request_id:requestId});
 }
 if(plan.refund_preference!=='original')throw new Error('Cancellation refund preference is missing.');

 let remaining=Number(plan.remaining_cents||0);
 const results:any[]=[];
 let lastError='';
 for(const payment of Array.isArray(plan.payments)?plan.payments:[]){
  if(remaining<=0)break;
  const amount=Math.min(remaining,Number(payment.refundable_cents||0));
  if(amount<=0)continue;
  try{
   if(payment.method==='account_credit'){
    const r:any=await userRpc(token,'process_cancellation_credit_refund',{p_request_id:requestId,p_payment_id:String(payment.payment_id),p_amount_cents:amount});
    results.push({method:'account_credit',amount_cents:amount,status:r?.status||'completed',refund_id:r?.refund_id});
    remaining-=amount;
    continue;
   }
   if(!payment.external_reference)throw new Error(`${payment.method} payment reference is missing.`);

   let providerReference='';
   let providerStatus='pending';
   let providerPayload:any={};
   if(payment.method==='stripe'){
    const form=new URLSearchParams();
    form.set('payment_intent',String(payment.external_reference));
    form.set('amount',String(amount));
    form.set('metadata[orbitfs_cancellation_request_id]',requestId);
    form.set('metadata[orbitfs_invoice_id]',String(plan.invoice_id));
    const d:any=await stripeRequest('/v1/refunds',{
     method:'POST',
     headers:{'content-type':'application/x-www-form-urlencoded','Idempotency-Key':`orbitfs-cancel-${requestId}-${payment.payment_id}`},
     body:form,
    });
    providerReference=String(d.id||'');
    providerStatus=String(d.status||'pending').toLowerCase();
    providerPayload={stripe_refund_id:d.id,status:d.status};
   }else if(payment.method==='paypal'){
    const {base,token:paypalAccess}=await paypalToken();
    const requestKey=`ofc-${requestId.replaceAll('-','').slice(0,12)}-${String(payment.payment_id).replaceAll('-','').slice(0,12)}`;
    const r=await fetch(`${base}/v2/payments/captures/${encodeURIComponent(String(payment.external_reference))}/refund`,{
     method:'POST',
     headers:{authorization:`Bearer ${paypalAccess}`,'content-type':'application/json','paypal-request-id':requestKey},
     body:JSON.stringify({amount:{value:(amount/100).toFixed(2),currency_code:String(plan.currency||'AUD').toUpperCase()},note_to_payer:'OrbitFS cancellation refund'}),
    });
    const d:any=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d?.message||`PayPal refund failed (${r.status})`);
    providerReference=String(d.id||'');
    providerStatus=String(d.status||'PENDING').toLowerCase();
    providerPayload={paypal_refund_id:d.id,status:d.status};
   }else throw new Error(`Automatic refund is not supported for ${payment.method}.`);

   const dbStatus=['succeeded','completed'].includes(providerStatus)?'succeeded':['failed','cancelled','canceled'].includes(providerStatus)?'failed':'pending';
   const recorded:any=await userRpc(token,'record_cancellation_external_refund',{
    p_request_id:requestId,
    p_payment_id:String(payment.payment_id),
    p_amount_cents:amount,
    p_external_reference:providerReference,
    p_status:dbStatus,
    p_metadata:providerPayload,
   });
   results.push({method:payment.method,amount_cents:amount,status:dbStatus,external_reference:providerReference,refund_id:recorded?.refund_id});
   if(committed(dbStatus))remaining-=amount;
   if(dbStatus==='failed')throw new Error(`${payment.method} refund was declined by the provider.`);
  }catch(e:any){
   lastError=e?.message||'Refund processing failed.';
   break;
  }
 }
 if(remaining>0&&!lastError)lastError=`${(remaining/100).toFixed(2)} ${plan.currency||'AUD'} still requires refund processing.`;
 const final:any=await userRpc(token,'finalize_cancellation_refund',{p_request_id:requestId,p_error:lastError||null});
 return {...final,results,remaining_cents:remaining};
}

export async function POST(req:NextRequest){
 try{
  const auth=req.headers.get('authorization')||'';
  if(!auth.startsWith('Bearer '))return NextResponse.json({error:'Unauthorized'},{status:401});
  const token=auth.slice(7);
  const body=await req.json().catch(()=>({}));
  const requestId=String(body.request_id||'');
  if(!requestId)return NextResponse.json({error:'Cancellation request is required.'},{status:400});

  if(body.action==='refund.retry'){
   const refund=await processRefund(token,requestId);
   return NextResponse.json({ok:true,refund});
  }

  const decision=String(body.decision||'').toLowerCase();
  if(!['approve','deny'].includes(decision))return NextResponse.json({error:'Invalid cancellation decision.'},{status:400});
  const review:any=await userRpc(token,'admin_review_order_cancellation',{p_request_id:requestId,p_decision:decision,p_staff_note:body.staff_note?String(body.staff_note):null});
  if(decision==='deny')return NextResponse.json({ok:true,review,refund:null});
  if(review?.status==='completed'&&review?.termination?.order_id){
   const syncResponse=await fetch(new URL('/api/admin/license-master/order-control',req.url),{method:'POST',headers:{authorization:auth,'content-type':'application/json'},body:JSON.stringify({orderId:String(review.termination.order_id),action:'terminate',reason:String(body.staff_note||'Customer cancellation request approved')})});
   const syncData=await syncResponse.json().catch(()=>({}));
   if(!syncResponse.ok||syncData?.ok!==true)return NextResponse.json({ok:false,review,refund:null,error:'Cancellation was applied locally but License Master termination synchronization failed.',licenseMaster:syncData},{status:502});
  }
  if(review?.status!=='completed'||!review?.refund_required)return NextResponse.json({ok:true,review,refund:null});

  try{
   const refund=await processRefund(token,requestId);
   return NextResponse.json({ok:true,review,refund});
  }catch(e:any){
   const error=e?.message||'Automatic refund failed.';
   const refund=await userRpc(token,'finalize_cancellation_refund',{p_request_id:requestId,p_error:error}).catch(()=>({status:'failed',error}));
   return NextResponse.json({ok:true,review,refund:{...refund,error}});
  }
 }catch(e:any){
  return NextResponse.json({error:e?.message||'Cancellation review failed.'},{status:500});
 }
}
