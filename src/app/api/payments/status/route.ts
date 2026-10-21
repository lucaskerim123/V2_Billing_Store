import {NextRequest,NextResponse} from 'next/server';
import {paymentRuntime,runtimeJson} from '@/lib/paymentRuntime';
import {orbitfsStoreOrigin} from '@/lib/site-origin';

export async function GET(req:NextRequest){
 try{
  const auth=req.headers.get('authorization')||'';
  if(!auth.startsWith('Bearer '))return NextResponse.json({error:'Unauthorized'},{status:401});
  const origin=await orbitfsStoreOrigin(req.url);
  const r=await paymentRuntime('verify',{authorization:auth,origin,body:{}});
  const d=await runtimeJson(r);
  return NextResponse.json(d,{status:r.status});
 }catch(e:any){return NextResponse.json({error:e.message||'Gateway verification failed'},{status:500})}
}
