import {licenseDb} from "@/lib/license-api";
import {masterProducts,masterProductGroups} from "@/lib/master-api";

export const dynamic="force-dynamic";

export async function GET(){
 try{
  const db=licenseDb();
  const [{data:local,error:localError},catalog,groupResult]=await Promise.all([
   db.from("products").select("id,slug,name,description,price_cents,currency,metadata,track_stock,stock_on_hand,stock_reserved,allow_backorders,created_at,license_product_key,active").eq("active",true),
   masterProducts(),
   masterProductGroups()
  ]);
  if(localError)throw localError;
  const masterRows=Array.isArray(catalog?.products)?catalog.products:[];
  const masterByCode=new Map(masterRows.map((p:any)=>[String(p.code||p.slug||"").toLowerCase(),p]));
  const groups=Array.isArray(groupResult?.groups)?groupResult.groups:[];
  const groupBySlug=new Map(groups.map((g:any)=>[String(g.slug).toLowerCase(),g]));
  const products=(local||[]).map((p:any)=>{
   const key=String(p.license_product_key||"").toLowerCase();
   const master=masterByCode.get(key);
   const group=master?(groups.find((g:any)=>String(g.id)===String(master.group_id))||groupBySlug.get(String(master.group_slug||"").toLowerCase())):null;
   return {...p,group_id:group?.id||null,group_slug:group?.slug||"ungrouped",group_name:group?.name||"Other products"};
  });
  const grouped=[...groups.map((group:any)=>({...group,products:products.filter((p:any)=>p.group_id===group.id)})).filter((g:any)=>g.products.length>0)];
  const ungrouped=products.filter((p:any)=>!p.group_id);
  if(ungrouped.length)grouped.push({id:"ungrouped",slug:"ungrouped",name:"Other products",description:"Products not assigned to a product group.",sort_order:999999,products:ungrouped});
  return Response.json({groups:grouped,product_count:products.length},{headers:{"cache-control":"no-store"}});
 }catch(error:any){
  return Response.json({error:error?.message||"Could not load the store catalogue."},{status:503,headers:{"cache-control":"no-store"}});
 }
}
