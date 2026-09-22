import Link from "next/link";
import {createClient} from "@supabase/supabase-js";
import {masterRequest} from "@/lib/master-api";

export const dynamic="force-dynamic";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://xwbjfhpgsvsjaykelufa.supabase.co";
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
const productPrice=(p:any)=>p.metadata?.free_product?"Free":p.priceAmount==null?"View details":new Intl.NumberFormat("en-AU",{style:"currency",currency:p.priceCurrency||"AUD",maximumFractionDigits:0}).format(Number(p.priceAmount||0));
const componentOrder:Record<string,number>={base:0,mcp:1,apex:2,studio:3};

export default async function BillingPage(){
 const sb=createClient(url,publicKey,{auth:{persistSession:false}});
 const [catalog,s]=await Promise.all([
  masterRequest("/api/v1/products",{method:"GET"}).catch(()=>({products:[]})),
  sb.from("app_settings").select("key,value").eq("public_read",true)
 ]);
 const products=(Array.isArray(catalog?.products)?catalog.products:[]).filter((p:any)=>p.active&&p.public&&p.purchasable).sort((a:any,b:any)=>(componentOrder[String(a.metadata?.component||a.componentKey||a.slug||"").toLowerCase()]??99)-(componentOrder[String(b.metadata?.component||b.componentKey||b.slug||"").toLowerCase()]??99));
 const settings=Object.fromEntries((s.data||[]).map((x:any)=>[x.key,x.value])) as Record<string,any>;
 const site=settings["identity.site_name"]||"OrbitFS";
 const logoText=settings["site.logo_text"]||site;

 return <main className="orbitHome orbitBilling">
  <header className="orbitHomeTop">
   <Link className="orbitHomeBrand" href="/billing"><span className="orbitHomeMark" aria-hidden="true"/><span>{logoText} <small style={{fontWeight:650,opacity:.58}}>Billing</small></span></Link>
   <nav className="orbitHomeNav" aria-label="Billing navigation">
    <Link className="orbitHomeNavOptional" href="/">Main site</Link><a className="orbitHomeNavOptional" href="#products">Products</a><Link href="/login" style={{fontSize:"11px",opacity:.68,padding:"6px 4px"}}>Sign in</Link><Link href="/register" style={{fontSize:"11px",opacity:.68,padding:"6px 4px"}}>Register</Link>
   </nav>
  </header>
  <section className="orbitHomeSection" style={{paddingTop:"84px",paddingBottom:"54px"}}><div style={{maxWidth:"820px"}}><p className="orbitHomeEyebrow">OrbitFS billing</p><h1 style={{margin:0,fontSize:"clamp(44px,7vw,76px)",lineHeight:1,letterSpacing:"-.055em"}}>Buy OrbitFS and its add-ons.</h1><p className="orbitHomeLead" style={{maxWidth:"690px"}}>Browse the available OrbitFS products below. Choose the Base system first, then add the components you need for your setup.</p><div className="orbitHomeActions"><a className="orbitHomePrimary" href="#products">Browse products <span aria-hidden="true">→</span></a><Link className="orbitHomeSecondary" href="/">About OrbitFS</Link></div></div></section>
  <section className="orbitHomeSection" id="products" style={{paddingTop:"34px"}}><div className="orbitHomeSectionHead"><div><p className="orbitHomeKicker">Available products</p><h2>OrbitFS Base and add-ons.</h2></div><p>Base is the main OrbitFS system. Add-ons extend it with specialised features and workflows.</p></div><div className="orbitHomeComponentGrid">
   {products.length?products.map((product:any)=>{const component=String(product.metadata?.component||product.componentKey||product.slug||"").toLowerCase().replace("orbitfs-","").replace("orbitfs_","");const badge=product.metadata?.store_badge||product.metadata?.store_kind||(component==="base"?"Core system":"Add-on");return <Link className="orbitHomeComponentCard" data-component={component} href={`/products/${product.slug}`} key={product.code}><div className="orbitHomeComponentTop"><span className="orbitHomeComponentBadge">{badge}</span><span className="orbitHomeComponentPrice">{productPrice(product)}</span></div><h3>{product.name}</h3><p>{product.description}</p><div className="orbitHomeComponentMeta"><span>{component==="base"?"OrbitFS foundation":"OrbitFS add-on"}</span><span>View product →</span></div></Link>}):<article className="orbitHomeComponentCard"><div className="orbitHomeComponentTop"><span className="orbitHomeComponentBadge">OrbitFS</span></div><h3>Products unavailable</h3><p>The Billing Store could not reach the License Master catalogue. No stale local catalogue is shown.</p></article>}
  </div></section>
  <section className="orbitHomeCta" style={{marginTop:"20px"}}><div><p className="orbitHomeKicker">OrbitFS</p><h2>Start with Base. Add what you need.</h2><p>Product availability, pricing and licence component definitions are controlled by the OrbitFS License Master.</p></div><div className="orbitHomeCtaActions"><a className="orbitHomePrimary" href="#products">View products</a></div></section>
  <footer className="orbitHomeFooter"><div><span>OrbitFS Billing</span><small style={{display:"block",marginTop:"6px",opacity:.55}}>Public OrbitFS product storefront</small></div><nav style={{fontSize:"11px",opacity:.66}}><Link href="/">Main site</Link><Link href="/login">Sign in</Link><Link href="/register">Register</Link></nav></footer>
 </main>;
}
