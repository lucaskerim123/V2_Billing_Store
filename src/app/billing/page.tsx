import Link from "next/link";
import {createClient} from "@supabase/supabase-js";
import {masterRequest} from "@/lib/master-api";

export const dynamic="force-dynamic";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
const productPrice=(p:any)=>p.metadata?.free_product?"Free":p.priceAmount==null?"View details":new Intl.NumberFormat("en-AU",{style:"currency",currency:p.priceCurrency||"AUD",maximumFractionDigits:0}).format(Number(p.priceAmount||0));

export default async function BillingPage(){
 const sb=createClient(url,publicKey,{auth:{persistSession:false}});
 const [catalog,groupCatalog,s]=await Promise.all([
  masterRequest("/api/v1/products",{method:"GET"}).catch(()=>({products:[]})),
  masterRequest("/api/v1/product-groups",{method:"GET"}).catch(()=>({groups:[]})),
  sb.from("app_settings").select("key,value").eq("public_read",true)
 ]);
 const products=(Array.isArray(catalog?.products)?catalog.products:[])
  .filter((p:any)=>p.active&&p.public&&p.purchasable);
 const sourceGroups=Array.isArray(groupCatalog?.groups)?groupCatalog.groups:[];
 const groups=sourceGroups.map((group:any)=>({
  ...group,
  products:products.filter((product:any)=>String(product.group_id||"")===String(group.id||""))
 })).filter((group:any)=>group.products.length>0);
 const groupedIds=new Set(groups.flatMap((group:any)=>group.products.map((product:any)=>String(product.code||product.slug||""))));
 const otherProducts=products.filter((product:any)=>!groupedIds.has(String(product.code||product.slug||"")));
 if(otherProducts.length)groups.push({id:"other-products",slug:"other-products",name:"Other products",description:"Products not assigned to a product group.",products:otherProducts});
 const settings=Object.fromEntries((s.data||[]).map((x:any)=>[x.key,x.value])) as Record<string,any>;
 const site=settings["identity.site_name"]||"Billing Store";
 const logoText=settings["site.logo_text"]||site;

 return <main className="orbitHome orbitBilling">
  <header className="orbitHomeTop">
   <Link className="orbitHomeBrand" href="/billing"><span className="orbitHomeMark" aria-hidden="true"/><span>{logoText} <small style={{fontWeight:650,opacity:.58}}>Store</small></span></Link>
   <nav className="orbitHomeNav" aria-label="Store navigation">
    <Link className="orbitHomeNavOptional" href="/">Main site</Link><a className="orbitHomeNavOptional" href="#products">Products</a><Link href="/login" style={{fontSize:"11px",opacity:.68,padding:"6px 4px"}}>Sign in</Link><Link href="/register" style={{fontSize:"11px",opacity:.68,padding:"6px 4px"}}>Register</Link>
   </nav>
  </header>
  <section className="orbitHomeSection" style={{paddingTop:"84px",paddingBottom:"54px"}}>
   <div style={{maxWidth:"820px"}}>
    <p className="orbitHomeEyebrow">Product store</p>
    <h1 style={{margin:0,fontSize:"clamp(44px,7vw,76px)",lineHeight:1,letterSpacing:"-.055em"}}>Products for your business and workflows.</h1>
    <p className="orbitHomeLead" style={{maxWidth:"690px"}}>Browse products from across the catalogue. Products are organised into groups so each product family has its own place, without limiting the store to one platform or a Base-and-add-ons structure.</p>
    <div className="orbitHomeActions"><a className="orbitHomePrimary" href="#products">Browse products <span aria-hidden="true">→</span></a><Link className="orbitHomeSecondary" href="/">Main website</Link></div>
   </div>
  </section>
  <section className="orbitHomeSection" id="products" style={{paddingTop:"34px"}}>
   <div className="orbitHomeSectionHead"><div><p className="orbitHomeKicker">Available catalogue</p><h2>Browse by product group.</h2></div><p>Each group contains its own products. New groups and products added in License Manager appear here automatically when they are public and purchasable.</p></div>
   <div className="orbitStoreGroups">
    {groups.length?groups.map((group:any)=><section className="orbitStoreGroup" key={group.id||group.slug}>
     <div className="orbitStoreGroupHead"><div><p className="orbitHomeKicker">{group.slug==="other-products"?"UNASSIGNED PRODUCTS":"PRODUCT GROUP"}</p><h2>{group.name}</h2>{group.description&&<p>{group.description}</p>}</div><span>{group.products.length} {group.products.length===1?"product":"products"}</span></div>
     <div className="orbitHomeComponentGrid">{group.products.map((product:any)=>{const badge=product.metadata?.store_badge||product.metadata?.store_kind||group.name;return <Link className="orbitHomeComponentCard" href={`/products/${product.slug}`} key={product.code||product.slug}><div className="orbitHomeComponentTop"><span className="orbitHomeComponentBadge">{badge}</span><span className="orbitHomeComponentPrice">{productPrice(product)}</span></div><h3>{product.name}</h3><p>{product.description||product.shortDescription||"View product details and available options."}</p><div className="orbitHomeComponentMeta"><span>{group.name}</span><span>View product →</span></div></Link>})}</div>
    </section>):<article className="orbitHomeComponentCard"><div className="orbitHomeComponentTop"><span className="orbitHomeComponentBadge">Catalogue</span></div><h3>Products unavailable</h3><p>The store could not retrieve the current product catalogue. No stale local catalogue is shown.</p></article>}
   </div>
  </section>
  <section className="orbitHomeCta" style={{marginTop:"20px"}}><div><p className="orbitHomeKicker">Product catalogue</p><h2>One store. Multiple product families.</h2><p>Product groups and licensing details are managed centrally. The store displays every product marked public and purchasable.</p></div><div className="orbitHomeCtaActions"><a className="orbitHomePrimary" href="#products">View products</a></div></section>
  <footer className="orbitHomeFooter"><div><span>{logoText} Store</span><small style={{display:"block",marginTop:"6px",opacity:.55}}>Product catalogue and checkout</small></div><nav style={{fontSize:"11px",opacity:.66}}><Link href="/">Main site</Link><Link href="/login">Sign in</Link><Link href="/register">Register</Link></nav></footer>
 </main>;
}
