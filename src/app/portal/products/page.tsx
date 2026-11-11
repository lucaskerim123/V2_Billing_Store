"use client";

import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase";
import {trackCustomerActivity} from "@/lib/customer-activity";
import StoreFlowNav from "@/components/StoreFlowNav";

const money=(cents:number,currency="AUD")=>new Intl.NumberFormat("en-AU",{style:"currency",currency}).format(Number(cents||0)/100);
const productPrice=(p:any)=>p.metadata?.free_product?"Free":p.price_cents==null?"Pricing not configured":money(p.price_cents,p.currency||"AUD");

export default function Products(){
 const sb=useMemo(()=>createClient(),[]);
 const [groups,setGroups]=useState<any[]>([]);
 const [optionProducts,setOptionProducts]=useState<Set<string>>(new Set());
 const [storeText,setStoreText]=useState<Record<string,string>>({});
 const [cart,setCart]=useState<any>(null);
 const [msg,setMsg]=useState("");
 const [loadingError,setLoadingError]=useState("");
 const [catalogCfg,setCatalogCfg]=useState<any>({hideOutOfStock:false,sortMode:"sort_order"});

 async function loadStore(){
  const [catalogResult,{data:options},{data:settings},{data:cartData,error:cartError},{data:cfgRows}]=await Promise.all([
   fetch("/api/store/catalog",{cache:"no-store"}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||"Could not load products");return d;}),
   sb.from("product_options").select("product_id").eq("active",true),
   sb.from("app_settings").select("key,value").eq("category","store"),
   sb.rpc("cart_summary"),
   sb.from("app_settings").select("key,value").in("key",["products.hide_out_of_stock","products.sort_mode"])
  ]).catch((error:any)=>{setLoadingError(error?.message||"Could not load the store catalogue.");return [null,{data:[]},{data:[]},{data:{items:[],item_count:0},error:null},{data:[]} ] as any});
  if(!catalogResult){setGroups([]);setCart(cartData||{items:[],item_count:0});return;}
  const cfg=Object.fromEntries((cfgRows||[]).map((x:any)=>[x.key,x.value]));
  setCatalogCfg({hideOutOfStock:cfg["products.hide_out_of_stock"]===true,sortMode:String(cfg["products.sort_mode"]||"sort_order")});
  const hideOut=cfg["products.hide_out_of_stock"]===true,sortMode=String(cfg["products.sort_mode"]||"sort_order");
  const sortProducts=(rows:any[])=>[...rows].filter((p:any)=>!hideOut||!p.track_stock||p.allow_backorders||Number(p.stock_on_hand||0)-Number(p.stock_reserved||0)>0).sort((a:any,b:any)=>
   sortMode==="price"?Number(a.price_cents||0)-Number(b.price_cents||0):
   sortMode==="newest"?new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime():
   String(a.name||"").localeCompare(String(b.name||""))
  );
  setGroups((catalogResult.groups||[]).map((g:any)=>({...g,products:sortProducts(g.products||[])})).filter((g:any)=>g.products.length));
  setOptionProducts(new Set((options||[]).map((x:any)=>x.product_id)));
  setStoreText(Object.fromEntries((settings||[]).map((x:any)=>[x.key.split(".").pop(),typeof x.value==="string"?x.value:String(x.value??"")])));
  setCart(cartData||{items:[],item_count:0});
  if(cartError)setMsg(cartError.message);
  setLoadingError("");
 }

 useEffect(()=>{void loadStore()},[sb]);
 const hasOptions=(p:any)=>optionProducts.has(p.id);

 async function directAdd(p:any){
  setMsg("Adding "+p.name+"…");
  const {error}=await sb.rpc("add_to_cart",{p_product_id:p.id,p_configuration:{}});
  if(error){setMsg(/own|duplicate|already/i.test(error.message||"")?"You already own "+p.name+". Open the product to buy it as a gift.":error.message);return;}
  setMsg(p.name+" added to your basket.");
  await trackCustomerActivity("cart.item_added",{entityType:"product",entityId:p.id,detail:{product_name:p.name}});
  await loadStore();
 }

 if(!cart)return <main className="portalPage storePage"><section className="v6c-loading-state">Loading Store…</section></main>;
 const totalProducts=groups.reduce((count,g)=>count+g.products.length,0);
 return <main className="portalPage storePage">
  <StoreFlowNav count={cart.item_count||0}/>
  <header className="storeHero">
   <div>
    <p className="eyebrow">{storeText.hero_eyebrow||"PRODUCT STORE"}</p>
    <h1>{storeText.hero_title||"Explore products"}</h1>
    <p className="storeLead">{storeText.hero_lead||"Browse products by category. Each product can be purchased independently unless its description says otherwise."}</p>
   </div>
   <Link className="storeTextAction storeCartJump" href="/portal/basket">Basket · {cart.item_count||0}</Link>
  </header>
  {msg&&<p className="v6c-store-message v6c-store-catalog-message">{msg}</p>}
  {loadingError&&<p className="v6c-store-message v6c-store-catalog-message">{loadingError}</p>}
  {!totalProducts&&!loadingError&&<section className="storeSection"><p className="muted">No products are currently available.</p></section>}
  {groups.map(group=><section className="storeSection storeProductGroup" key={group.id||group.slug}>
   <div className="storeSectionHead">
    <div><p className="eyebrow">{group.slug==="orbitfs"?"PRODUCT FAMILY":"PRODUCT GROUP"}</p><h2>{group.name}</h2>{group.description&&<p className="muted">{group.description}</p>}</div>
    <span className="pill">{group.products.length} {group.products.length===1?"product":"products"}</span>
   </div>
   <div className="storeAddonList">{group.products.map((p:any)=><article className="storeAddonCard" key={p.id}>
    <div><span className="pill">{p.metadata?.store_badge||group.name}</span><h3>{p.name}</h3><p>{p.description}</p></div>
    <div className="storeAddonMeta">
     <strong>{productPrice(p)}</strong>
     {hasOptions(p)?<Link className="storePrimaryAction" href={"/portal/products/"+p.slug}>Configure & add</Link>:<button className="storePrimaryAction" onClick={()=>void directAdd(p)}>Add to basket</button>}
     <Link className="storeTextAction" href={"/portal/products/"+p.slug}>Details / gift →</Link>
    </div>
   </article>)}</div>
  </section>)}
 </main>;
}
