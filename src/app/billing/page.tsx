import Link from "next/link";
import {licenseDb} from "@/lib/license-api";
import {masterProducts,masterProductGroups} from "@/lib/master-api";

export const dynamic="force-dynamic";

type MasterProduct={slug?:string;group_id?:string|null;group_slug?:string|null;name?:string;description?:string;componentKey?:string;status?:string};
type MasterProductGroup={id:string;slug:string;name:string;description?:string};
type MasterProductsResponse={products:MasterProduct[]};
type MasterProductGroupsResponse={groups:MasterProductGroup[]};

const productPrice=(p:any)=>p.metadata?.free_product?"Free":p.price_cents==null?"View details":new Intl.NumberFormat("en-AU",{style:"currency",currency:p.currency||"AUD",maximumFractionDigits:0}).format(Number(p.price_cents||0)/100);

export default async function BillingPage(){
 const db=licenseDb();
 const [catalog,groupCatalog,localResult]=await Promise.all([
  masterProducts().catch(():MasterProductsResponse=>({products:[]})),
  masterProductGroups().catch(():MasterProductGroupsResponse=>({groups:[]})),
  db.from("products").select("id,slug,name,description,price_cents,currency,metadata,license_product_key,active").eq("active",true)
 ]);
 if(localResult.error)throw localResult.error;
 const masterRows=(Array.isArray(catalog.products)?catalog.products:[]).filter((p)=>String(p.status||"active").toLowerCase()==="active");
 const localRows=(Array.isArray(localResult.data)?localResult.data:[]).filter((p:any)=>p.price_cents!=null||p.metadata?.free_product===true);
 const masterByCode=new Map(masterRows.map((p)=>[String(p.slug||"").toLowerCase(),p]));
 const sourceGroups=Array.isArray(groupCatalog.groups)?groupCatalog.groups:[];
 const products=localRows.map((local:any)=>{
  const master=masterByCode.get(String(local.license_product_key||"").toLowerCase());
  const group=master?(sourceGroups.find((g)=>String(g.id)===String(master.group_id))||sourceGroups.find((g)=>String(g.slug)===String(master.group_slug))):null;
  return {...local,code:local.license_product_key||local.slug,slug:local.slug,name:local.name||master?.name,description:local.description||master?.description||"",group_id:group?.id||null,group_slug:group?.slug||"other-products",group_name:group?.name||"Other products",metadata:{...(local.metadata||{}),component:master?.componentKey||local.metadata?.component||null}};
 });
 const groups=sourceGroups.map((group)=>({...group,products:products.filter((product:any)=>String(product.group_id||"")===String(group.id||""))})).filter((group)=>group.products.length>0);
 const otherProducts=products.filter((product:any)=>!product.group_id);
 if(otherProducts.length)groups.push({id:"other-products",slug:"other-products",name:"Other products",description:"Products not assigned to a product group or not connected to License Manager.",products:otherProducts});
 const site="Billing Store";

 return <main className="orbitHome orbitBilling">
  <style>{`\n   .orbitStoreGroups{display:grid;gap:34px}
   .orbitStoreGroup{padding:24px;border:1px solid rgba(125,160,205,.2);border-radius:20px;background:rgba(7,17,35,.54)}
   .orbitStoreGroupHead{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;margin-bottom:20px}
   .orbitStoreGroupHead h2{margin:4px 0 0;font-size:clamp(24px,3vw,34px);letter-spacing:-.035em}
   .orbitStoreGroupHead p:not(.orbitHomeKicker){margin:8px 0 0;max-width:650px;opacity:.68;font-size:13px}
   .orbitStoreGroupHead>span{white-space:nowrap;font-size:11px;opacity:.62;padding:7px 10px;border:1px solid rgba(125,160,205,.22);border-radius:999px}
   @media(max-width:640px){.orbitStoreGroup{padding:16px}.orbitStoreGroupHead{align-items:flex-start;flex-direction:column;gap:10px}}
  `}</style>
  <header className="orbitHomeTop">
   <Link className="orbitHomeBrand" href="/billing"><span className="orbitHomeMark" aria-hidden="true"/><span>{site} <small style={{fontWeight:650,opacity:.58}}>Store</small></span></Link>
   <nav className="orbitHomeNav" aria-label="Store navigation"><Link className="orbitHomeNavOptional" href="/">Main site</Link><a className="orbitHomeNavOptional" href="#products">Products</a><Link href="/login" style={{fontSize:"11px",opacity:.68,padding:"6px 4px"}}>Sign in</Link><Link href="/register" style={{fontSize:"11px",opacity:.68,padding:"6px 4px"}}>Register</Link></nav>
  </header>
  <section className="orbitHomeSection" style={{paddingTop:"84px",paddingBottom:"54px"}}><div style={{maxWidth:"820px"}}><p className="orbitHomeEyebrow">Product store</p><h1 style={{margin:0,fontSize:"clamp(44px,7vw,76px)",lineHeight:1,letterSpacing:"-.055em"}}>Products for your business and workflows.</h1><p className="orbitHomeLead" style={{maxWidth:"690px"}}>Browse products from across the catalogue. Products are organised into groups so each product family has its own place, without limiting the store to one platform or a Base-and-add-ons structure.</p><div className="orbitHomeActions"><a className="orbitHomePrimary" href="#products">Browse products <span aria-hidden="true">→</span></a><Link className="orbitHomeSecondary" href="/">Main website</Link></div></div></section>
  <section className="orbitHomeSection" id="products" style={{paddingTop:"34px"}}><div className="orbitHomeSectionHead"><div><p className="orbitHomeKicker">Available catalogue</p><h2>Browse by product group.</h2></div><p>Each group contains its own products. Active products registered in License Manager appear here automatically, alongside standalone store products.</p></div>
   <div className="orbitStoreGroups">{groups.length?groups.map((group:any)=><section className="orbitStoreGroup" key={group.id||group.slug}><div className="orbitStoreGroupHead"><div><p className="orbitHomeKicker">{group.slug==="other-products"?"UNASSIGNED PRODUCTS":"PRODUCT GROUP"}</p><h2>{group.name}</h2>{group.description&&<p>{group.description}</p>}</div><span>{group.products.length} {group.products.length===1?"product":"products"}</span></div><div className="orbitHomeComponentGrid">{group.products.map((product:any)=>{const badge=product.metadata?.store_badge||product.metadata?.store_kind||group.name;return <Link className="orbitHomeComponentCard" href={`/products/${product.slug}`} key={product.code||product.slug}><div className="orbitHomeComponentTop"><span className="orbitHomeComponentBadge">{badge}</span><span className="orbitHomeComponentPrice">{productPrice(product)}</span></div><h3>{product.name}</h3><p>{product.description||"View product details and available options."}</p><div className="orbitHomeComponentMeta"><span>{group.name}</span><span>View product →</span></div></Link>})}</div></section>):<article className="orbitHomeComponentCard"><div className="orbitHomeComponentTop"><span className="orbitHomeComponentBadge">Catalogue</span></div><h3>No active products</h3><p>There are currently no active products available in the catalogue.</p></article>}</div>
  </section>
  <section className="orbitHomeCta" style={{marginTop:"20px"}}><div><p className="orbitHomeKicker">Product catalogue</p><h2>One store. Multiple product families.</h2><p>Product groups and licensing details are managed centrally. The store displays active products from the central catalogue and standalone store products.</p></div><div className="orbitHomeCtaActions"><a className="orbitHomePrimary" href="#products">View products</a></div></section>
  <footer className="orbitHomeFooter"><div><span>{site} Store</span><small style={{display:"block",marginTop:"6px",opacity:.55}}>Product catalogue and checkout</small></div><nav style={{fontSize:"11px",opacity:.66}}><Link href="/">Main site</Link><Link href="/login">Sign in</Link><Link href="/register">Register</Link></nav></footer>
 </main>;
}
