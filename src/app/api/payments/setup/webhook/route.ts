import {NextRequest,NextResponse} from 'next/server';
import {orbitfsStoreOrigin} from '@/lib/site-origin';

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const SUPABASE_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||'';

export async function POST(req:NextRequest){
 try{
  const auth=req.headers.get('authorization')||'';
  if(!auth.startsWith('Bearer '))return NextResponse.json({error:'Unauthorized'},{status:401});
  const body=await req.json().catch(()=>({}));
  const origin=await orbitfsStoreOrigin(req.url);
  const r=await fetch(`${SUPABASE_URL}/functions/v1/payment-gateway-autoconfigure`,{
   method:'POST',
   headers:{authorization:auth,apikey:SUPABASE_KEY,'content-type':'application/json','x-orbitfs-origin':origin},
   body:JSON.stringify({gateway:body.gateway,origin}),
   cache:'no-store'
  });
  const d=await r.json().catch(()=>({error:`Automatic gateway setup failed (${r.status})`}));
  return NextResponse.json(d,{status:r.status});
 }catch(e:any){return NextResponse.json({error:e.message||'Automatic gateway setup failed'},{status:500})}
}
