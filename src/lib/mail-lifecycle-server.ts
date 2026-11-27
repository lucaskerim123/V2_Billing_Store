import {createClient} from "@supabase/supabase-js";
import {sendAutomation} from "@/lib/transactional-server";

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||"";

function money(cents:number,currency:string){
  try{return new Intl.NumberFormat("en-AU",{style:"currency",currency:currency||"AUD"}).format((Number(cents)||0)/100)}
  catch{return ((Number(cents)||0)/100).toFixed(2)+" "+(currency||"AUD")}
}

export async function sendPaidLifecycleForInvoice(invoiceId:string){
  if(!SUPABASE_URL||!SERVICE_KEY)return {ok:true,skipped:true as const,reason:"billing_server_database_not_configured"};
  const db=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:invoice,error}=await db.from("invoices")
    .select("id,auth_user_id,invoice_number,total_cents,paid_cents,currency,due_at")
    .eq("id",invoiceId).maybeSingle();
  if(error)throw new Error("Could not load paid invoice for Mail integration: "+error.message);
  if(!invoice)return {ok:true,skipped:true as const,reason:"invoice_not_found"};
  if(!invoice.auth_user_id)return {ok:true,skipped:true as const,reason:"invoice_customer_identity_missing"};

  const [{data:customer},{data:profile}]=await Promise.all([
    db.from("customers").select("email,name").eq("auth_user_id",invoice.auth_user_id).maybeSingle(),
    db.from("user_profiles").select("display_name,first_name,last_name").eq("id",invoice.auth_user_id).maybeSingle()
  ]);
  let email=String(customer?.email||"").trim();
  if(!email&&invoice.auth_user_id){
    const {data}=await db.auth.admin.getUserById(String(invoice.auth_user_id));
    email=String(data?.user?.email||"").trim();
  }
  if(!email)return {ok:true,skipped:true as const,reason:"invoice_customer_email_missing"};
  const customerName=String(customer?.name||profile?.display_name||[profile?.first_name,profile?.last_name].filter(Boolean).join(" ")||"Customer");
  const currency=String(invoice.currency||"AUD");
  return sendAutomation("invoice.paid",email,{
    customer_name:customerName,
    invoice_number:String(invoice.invoice_number||""),
    invoice_total:money(Number(invoice.total_cents||0),currency),
    invoice_due:money(Math.max(0,Number(invoice.total_cents||0)-Number(invoice.paid_cents||0)),currency),
    due_date:invoice.due_at?new Date(String(invoice.due_at)).toLocaleDateString("en-AU"):"No due date"
  },"invoice",String(invoice.id));
}
