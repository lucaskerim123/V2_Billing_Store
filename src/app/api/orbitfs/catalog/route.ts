import {licenseDb,reply} from "@/lib/license-api";
import {masterRequest} from "@/lib/master-api";
import {randomUUID} from "node:crypto";

export const dynamic="force-dynamic";

async function masterCatalog(){
  const master=await masterRequest("/api/v1/products",{method:"GET"});
  return Array.isArray(master?.products)?master.products:[];
}
function masterActive(p:any){return typeof p.active==="boolean"?p.active:String(p.status||"").toLowerCase()==="active";}
function masterPurchasable(p:any){return typeof p.purchasable==="boolean"?p.purchasable:masterActive(p);}
function masterPublic(p:any){return typeof p.public==="boolean"?p.public:masterActive(p);}
function masterPriceCents(master:any,local:any){return master.priceAmount!=null?Math.round(Number(master.priceAmount)*100):local?.price_cents??null;}
function merge(master:any,local:any){return {...local,id:local?.id||null,master_id:master.id,master_code:master.code,name:master.name,slug:master.slug,description:master.description,short_description:master.shortDescription,price_cents:masterPriceCents(master,local),currency:master.priceCurrency||local?.currency||"AUD",active:masterActive(master),purchasable:masterPurchasable(master),public:masterPublic(master),license_product_key:master.code,metadata:{...(local?.metadata||{}),...(master.metadata||{}),component:master.componentKey||local?.metadata?.component||null},master};}

async function syncOne(db:any,master:any,local:any){
  const patch={name:master.name,slug:master.slug,description:master.description,price_cents:masterPriceCents(master,local),currency:master.priceCurrency||local?.currency||"AUD",active:masterActive(master),license_product_key:master.code,metadata:{...(local?.metadata||{}),...(master.metadata||{}),component:master.componentKey||local?.metadata?.component||null}};
  if(local){const {data,error}=await db.from("products").update(patch).eq("id",local.id).select("*").single();if(error)throw error;return data;}
  const {data,error}=await db.from("products").insert({id:randomUUID(),...patch}).select("*").single();
  if(error)throw error;
  return data;
}

export async function GET(req:Request){
  try{
    const products=await masterCatalog();
    const db=licenseDb();
    const {data:local,error}=await db.from("products").select("*").in("license_product_key",products.map((p:any)=>String(p.code||"")).filter(Boolean));
    if(error)throw error;
    const byCode=new Map((local||[]).map((p:any)=>[String(p.license_product_key),p]));
    const merged=products.map((m:any)=>merge(m,byCode.get(String(m.code))));
    const slug=new URL(req.url).searchParams.get("slug");
    if(slug){const product=merged.find((p:any)=>p.slug===slug);if(!product)return reply({error:"Product not found"},404);return reply({product});}
    return reply({authority:"orbitfs-license-master-v2",products:merged});
  }catch(e:any){return reply({error:e?.message||"License Master catalogue unavailable"},503)}
}

export async function POST(req:Request){
  try{
    const body=await req.json().catch(()=>({}));
    const products=await masterCatalog();
    const db=licenseDb();
    if(body?.all===true){
      const results=[];
      for(const master of products){
        const {data:local,error:findError}=await db.from("products").select("*").eq("license_product_key",master.code).maybeSingle();
        if(findError)throw findError;
        const updated=await syncOne(db,master,local||null);
        results.push(merge(master,updated));
      }
      return reply({authority:"orbitfs-license-master-v2",synced:results.length,products:results});
    }
    const requested=body?.code?String(body.code):body?.slug?String(body.slug):"";
    const master=products.find((p:any)=>p.code===requested||p.slug===requested);
    if(!master)return reply({error:"Product not found in License Master"},404);
    const {data:local,error:findError}=await db.from("products").select("*").eq("license_product_key",master.code).maybeSingle();
    if(findError)throw findError;
    const updated=await syncOne(db,master,local||null);
    return reply({authority:"orbitfs-license-master-v2",product:merge(master,updated),created:!local});
  }catch(e:any){return reply({error:e?.message||"License Master catalogue sync failed"},503)}
}
