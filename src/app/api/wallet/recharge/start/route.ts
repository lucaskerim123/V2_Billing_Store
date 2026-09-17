import {NextRequest,NextResponse} from 'next/server';

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||'https://bealqgenrcytjzjoikmk.supabase.co';
const SUPABASE_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||'';

export async function POST(req:NextRequest){
 try{
  const auth=req.headers.get('authorization')||'';
  if(!auth.startsWith('Bearer '))return NextResponse.json({error:'Unauthorized'},{status:401});
  const body=await req.json().catch(()=>({}));
  const attemptId=String(body.attempt_id||'');
  if(!attemptId)return NextResponse.json({error:'Missing payment attempt'},{status:400});
  const origin=new URL(req.url).origin;
  const r=await fetch(`${SUPABASE_URL}/functions/v1/wallet-payment-start`,{
   method:'POST',
   headers:{apikey:SUPABASE_KEY,authorization:auth,'content-type':'application/json'},
   body:JSON.stringify({attempt_id:attemptId,origin}),
   cache:'no-store'
  });
  const text=await r.text();
  return new NextResponse(text,{status:r.status,headers:{'content-type':r.headers.get('content-type')||'application/json'}});
 }catch(e:any){return NextResponse.json({error:e.message||'Unable to start Wallet recharge payment'},{status:500})}
}
