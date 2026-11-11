import {licenseDb} from "@/lib/license-api";
import {masterProducts,masterProductGroups} from "@/lib/master-api";

export const dynamic="force-dynamic";

type MasterProduct={code?:string;product_code?:string;slug?:string;group_id?:string|null;group_slug?:string|null;validation_policy?:Record<string,unknown>|null};
type MasterProductGroup={id:string;slug:string;name:string;description?:string;sort_order?:number};
type MasterProductsResponse={products:MasterProduct[]};
type MasterProductGroupsResponse={groups:MasterProductGroup[]};

export async function GET(){
 try{
  const db=licenseDb();
  const [localResult,catalog,groupResult]=await Promise.all([
   db.from("products").select("id,slug,name,description,price_cents,currency,metadata,track_stock,stock_on_hand,stock_reserved,allow_backorders,created_at,license_product_key,active").eq("active",true),
   masterProducts().catch(():MasterProductsResponse=>({products:[]})),
   masterProductGroups().catch(():MasterProductGroupsResponse=>({groups:[]}))
  ]);
  if(localResult.error)throw localResult.error;
  const local=(localResult.data||[]).filter((p:any)=>p.price_cents!=null||p.metadata?.free_product===true);
  const masterRows=Array.isArray(catalog.products)?catalog.products:[];
  const masterByCode=new Map(masterRows.flatMap((p)=>[p.code,p.product_code,p.slug].filter(Boolean).map((key)=>[String(key).toLowerCase(),p] as const)));
  // Keep the local checkout policy mirror aligned with License Manager.
  // Checkout is database-backed, so it must not rely on an OrbitFS product list
  // or on a browser-side policy snapshot.
  for(const product of local){
   const master=masterByCode.get(String(product.license_product_key||"").toLowerCase());
   if(!master)continue;
   const policy=master.validation_policy&&typeof master.validation_policy==="object"?master.validation_policy:null;
   if(JSON.stringify(product.metadata?.license_validation_policy??null)!==JSON.stringify(policy)){
    const {error}=await db.from("products").update({metadata:{...(product.metadata||{}),license_validation_policy:policy}}).eq("id",product.id);
    if(error)throw error;
   }
  }
  const groups=Array.isArray(groupResult.groups)?groupResult.groups:[];
  const groupBySlug=new Map(groups.map((g)=>[String(g.slug).toLowerCase(),g]));
  const products=(local||[]).map((p:any)=>{
   const key=String(p.license_product_key||"").toLowerCase();
   const master=masterByCode.get(key);
   const group=master?(groups.find((g)=>String(g.id)===String(master.group_id))||groupBySlug.get(String(master.group_slug||"").toLowerCase())):null;
   return {...p,group_id:group?.id||null,group_slug:group?.slug||"ungrouped",group_name:group?.name||"Other products"};
  });
  const grouped=[...groups.map((group)=>({...group,products:products.filter((p:any)=>p.group_id===group.id)})).filter((g)=>g.products.length>0)];
  const ungrouped=products.filter((p:any)=>!p.group_id);
  if(ungrouped.length)grouped.push({id:"ungrouped",slug:"ungrouped",name:"Other products",description:"Products not assigned to a product group.",sort_order:999999,products:ungrouped});
  return Response.json({groups:grouped,product_count:products.length},{headers:{"cache-control":"no-store"}});
 }catch(error:any){
  return Response.json({error:error?.message||"Could not load the store catalogue."},{status:503,headers:{"cache-control":"no-store"}});
 }
}
