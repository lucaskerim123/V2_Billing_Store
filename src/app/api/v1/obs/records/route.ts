import {authorizeObs,obsDb,type ObsScope} from "@/lib/obs-api";
const resources={
 customers:{table:"customers",scope:"customers.read",columns:"id,auth_user_id,user_id,customer_number,name,email,status,created_at"},
 orders:{table:"orders",scope:"orders.read",columns:"id,auth_user_id,order_number,status,created_at"},
 invoices:{table:"invoices",scope:"invoices.read",columns:"id,auth_user_id,invoice_number,order_id,status,total_cents,paid_cents,due_at,created_at,currency"},
 payments:{table:"invoice_payments",scope:"payments.read",columns:"id,invoice_id,amount_cents,method,created_at"}
} as const;
export async function GET(req:Request){
 const url=new URL(req.url);
 const resource=String(url.searchParams.get("resource")||"") as keyof typeof resources;
 const cfg=resources[resource];
 if(!cfg)return Response.json({error:"Unsupported resource"},{status:400});
 if(!await authorizeObs(req,cfg.scope as ObsScope))return Response.json({error:"Permission denied"},{status:403});
 const identity=String(url.searchParams.get("identity")||"").trim();
 if(!identity||identity.length>160||!/^[A-Za-z0-9_.@+-]+$/.test(identity))return Response.json({error:"Customer identity required"},{status:400});
 const db=obsDb();
 let search=db.from("customers").select("id,auth_user_id,user_id,customer_number,name,email,status");
 if(identity.includes("@"))search=search.ilike("email",identity);
 else if(/^[a-f0-9-]{36}$/i.test(identity))search=search.or("id.eq."+identity+",auth_user_id.eq."+identity+",user_id.eq."+identity);
 else search=search.eq("customer_number",identity);
 const {data:customers,error:customerError}=await search.limit(2);
 if(customerError)return Response.json({error:"Customer lookup unavailable"},{status:503});
 if(!customers?.length)return Response.json({found:false,records:[]},{headers:{"cache-control":"no-store"}});
 if(customers.length>1)return Response.json({error:"Ambiguous customer identity"},{status:409});
 const customer=customers[0],userId=String(customer.auth_user_id||customer.user_id||"");
 if(!userId)return Response.json({error:"Customer account not linked"},{status:409});
 if(resource==="customers")return Response.json({found:true,records:[customer]},{headers:{"cache-control":"no-store"}});
 if(resource==="payments"){
  const ids=await db.from("invoices").select("id").eq("auth_user_id",userId).limit(50);
  if(ids.error)return Response.json({error:"Invoice lookup unavailable"},{status:503});
  const invoiceIds=(ids.data||[]).map(x=>x.id);
  if(!invoiceIds.length)return Response.json({found:true,records:[]},{headers:{"cache-control":"no-store"}});
  const rows=await db.from("invoice_payments").select(cfg.columns).in("invoice_id",invoiceIds).limit(100);
  return rows.error?Response.json({error:"Payment lookup unavailable"},{status:503}):Response.json({found:true,records:rows.data||[]},{headers:{"cache-control":"no-store"}});
 }
 const rows=await db.from(cfg.table).select(cfg.columns).eq("auth_user_id",userId).limit(50);
 return rows.error?Response.json({error:"Billing lookup unavailable"},{status:503}):Response.json({found:true,records:rows.data||[]},{headers:{"cache-control":"no-store"}});
}
