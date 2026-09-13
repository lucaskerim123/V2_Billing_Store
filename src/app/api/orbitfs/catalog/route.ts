import {licenseDb,reply} from "@/lib/license-api";
import {masterRequest} from "@/lib/master-api";

export const dynamic="force-dynamic";

async function masterCatalog(){
  const master=await masterRequest("/api/products",{method:"GET"});
  return Array.isArray(master?.products)?master.products:[];
}
function merge(master:any,local:any){return {...local,id:local?.id||null,master_id:master.id,master_code:master.code,name:master.name,slug:master.slug,description:master.description,short_description:master.shortDescription,price_cents:Math.round(Number(master.priceAmount||0)*100),currency:master.priceCurrency||"AUD",active:!!master.active,purchasable:!!master.purchasable,public:!!master.public,license_product_key:master.code,metadata:{...(local?.metadata||{}),...(master.metadata||{}),component:master.componentKey||local?.metadata?.component||null},master};}

export async function GET(req:Request){
  try{const products=await masterCatalog();const db=licenseDb();const {data:local,error}=await db.from("products").select("*").in("license_product_key",products.map((p:any)=>String(p.code||"")).filter(Boolean));if(error)throw error;const byCode=new Map((local||[]).map((p:any)=>[String(p.license_product_key),p]));const merged=products.map((m:any)=>merge(m,byCode.get(String(m.code))));const slug=new URL(req.url).searchParams.get("slug");if(slug){const product=merged.find((p:any)=>p.slug===slug);if(!product)return reply({error:"Product not found"},404);return reply({product});}return reply({authority:"orbitfs-license-master-v2",products:merged});}catch(e:any){return reply({error:e?.message||"License Master catalogue unavailable"},503)}}

export async function POST(req:Request){
  try{const body=await req.json().catch(()=>({}));const requested=body?.code?String(body.code):body?.slug?String(body.slug):"";const products=await masterCatalog();const master=products.find((p:any)=>p.code===requested||p.slug===requested);if(!master)return reply({error:"Product not found in License Master"},404);const db=licenseDb();const {data:local,error:findError}=await db.from("products").select("id").eq("license_product_key",master.code).maybeSingle();if(findError)throw findError;if(!local)return reply({error:`Billing product ${master.code} is not configured locally`},409);const patch={name:master.name,slug:master.slug,description:master.description,price_cents:Math.round(Number(master.priceAmount||0)*100),currency:master.priceCurrency||"AUD",active:!!master.active,license_product_key:master.code,metadata:{...(body?.metadata||{}),...(master.metadata||{}),component:master.componentKey||null}};const {data:updated,error}=await db.from("products").update(patch).eq("id",local.id).select("*").single();if(error)throw error;return reply({authority:"orbitfs-license-master-v2",product:merge(master,updated)});}catch(e:any){return reply({error:e?.message||"License Master catalogue sync failed"},503)}}
