import {randomBytes} from 'crypto';
import {serviceRpc} from '@/lib/paymentServer';

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://bealqgenrcytjzjoikmk.supabase.co";
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function serviceFetch(path:string,init:RequestInit={}){
  if(!SERVICE_KEY)throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  const r=await fetch(`${SUPABASE_URL}${path}`,{...init,headers:{apikey:SERVICE_KEY,authorization:`Bearer ${SERVICE_KEY}`,'content-type':'application/json',...(init.headers||{})}});
  if(!r.ok)throw new Error(await r.text());
  return r.status===204?null:r.json();
}

async function findRecipient(email:string){
  return await serviceRpc('gift_recipient_lookup',{p_email:email});
}

async function createRecipient(email:string,origin:string){
  const temporaryPassword=`Ofs!${randomBytes(9).toString('base64url')}9a`;
  const user=await serviceFetch('/auth/v1/admin/users',{method:'POST',body:JSON.stringify({email,password:temporaryPassword,email_confirm:true,user_metadata:{gift_account:true,temporary_password_issued:true}})});
  // Use Supabase's configured Auth mailer to send the recipient a password setup/reset email.
  await fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(`${origin}/login`)}`,{method:'POST',headers:{apikey:SERVICE_KEY,'content-type':'application/json'},body:JSON.stringify({email})}).catch(()=>null);
  return {user_id:user.id as string,temporary_password:temporaryPassword};
}

export async function fulfillGiftOrder(orderId:string,origin:string){
  const gifts=await serviceFetch(`/rest/v1/gift_deliveries?source_order_id=eq.${encodeURIComponent(orderId)}&select=id,source_order_item_id,recipient_email,status,recipient_user_id`);
  const results:any[]=[];
  for(const gift of gifts||[]){
    if(gift.status==='delivered'){results.push({gift_id:gift.id,status:'delivered',already:true});continue;}
    const email=String(gift.recipient_email||'').trim().toLowerCase();
    let recipient=await findRecipient(email);
    let accountCreated=false;
    let tempPassword:string|undefined;
    if(Array.isArray(recipient))recipient=recipient[0]||null;
    if(!recipient){
      const created=await createRecipient(email,origin);
      recipient=created.user_id;
      tempPassword=created.temporary_password;
      accountCreated=true;
    }
    const delivered=await serviceRpc('fulfill_gift_order_item',{p_source_order_item_id:gift.source_order_item_id,p_recipient_user_id:recipient,p_account_created:accountCreated});
    results.push({gift_id:gift.id,status:'delivered',recipient_user_id:recipient,account_created:accountCreated,recipient_order_id:delivered?.recipient_order_id,temp_password_created:!!tempPassword});
  }
  return {ok:true,order_id:orderId,gifts:results};
}

export async function orderOwnedBy(orderId:string,userId:string){
  const rows=await serviceFetch(`/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&auth_user_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`);
  return !!rows?.length;
}
