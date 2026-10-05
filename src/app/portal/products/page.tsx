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
  const [items,setItems]=useState<any[]>([]);
  const [optionProducts,setOptionProducts]=useState<Set<string>>(new Set());
  const [storeText,setStoreText]=useState<Record<string,string>>({});
  const [cart,setCart]=useState<any>(null);
  const [msg,setMsg]=useState("");
  const [catalogCfg,setCatalogCfg]=useState<any>({allowAddons:true,hideOutOfStock:false,sortMode:"sort_order"});

  async function loadStore(){
    const [{data:products,error:productsError},{data:options},{data:settings},{data:cartData,error:cartError},{data:cfgRows}]=await Promise.all([
      sb.from("products").select("id,slug,name,description,price_cents,currency,metadata,track_stock,stock_on_hand,stock_reserved,allow_backorders,created_at").eq("active",true),
      sb.from("product_options").select("product_id").eq("active",true),
      sb.from("app_settings").select("key,value").eq("category","store"),
      sb.rpc("cart_summary"),
      sb.from("app_settings").select("key,value").in("key",["products.allow_addons","products.hide_out_of_stock","products.sort_mode"])
    ]);
    if(productsError){setMsg(productsError.message);setItems([]);setCart(cartData||{items:[],item_count:0});return}

    const cfg=Object.fromEntries((cfgRows||[]).map((x:any)=>[x.key,x.value]));
    setCatalogCfg({
      allowAddons:cfg["products.allow_addons"]!==false,
      hideOutOfStock:cfg["products.hide_out_of_stock"]===true,
      sortMode:String(cfg["products.sort_mode"]||"sort_order")
    });

    let visible=(products||[]).filter((p:any)=>!cfg["products.hide_out_of_stock"]||!p.track_stock||p.allow_backorders||(Number(p.stock_on_hand||0)-Number(p.stock_reserved||0)>0));
    const sortMode=String(cfg["products.sort_mode"]||"sort_order");
    visible=[...visible].sort((a:any,b:any)=>
      sortMode==="price"?Number(a.price_cents||0)-Number(b.price_cents||0):
      sortMode==="newest"?new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime():
      String(a.name||"").localeCompare(String(b.name||""))
    );

    setItems(visible);
    setOptionProducts(new Set((options||[]).map((x:any)=>x.product_id)));
    setStoreText(Object.fromEntries((settings||[]).map((x:any)=>[x.key.split(".").pop(),typeof x.value==="string"?x.value:String(x.value??"")])));
    setCart(cartData||{items:[],item_count:0});
    if(cartError)setMsg(cartError.message);
  }

  useEffect(()=>{void loadStore()},[sb]);

  const base=useMemo(()=>items.find(p=>p.metadata?.component==="base")||items[0],[items]);
  const addons=useMemo(()=>catalogCfg.allowAddons?items.filter(p=>p!==base):[],[items,base,catalogCfg.allowAddons]);
  const hasOptions=(p:any)=>optionProducts.has(p.id);

  async function directAdd(p:any){
    setMsg("Adding "+p.name+"…");
    const {error}=await sb.rpc("add_to_cart",{p_product_id:p.id,p_configuration:{}});
    if(error){
      setMsg(/own|duplicate|already/i.test(error.message||"")?"You already own "+p.name+". Open the product to buy it as a gift.":error.message);
      return;
    }
    setMsg(p.name+" added to your basket.");
    await trackCustomerActivity("cart.item_added",{entityType:"product",entityId:p.id,detail:{product_name:p.name}});
    await loadStore();
  }

  if(!cart)return <main className="portalPage storePage"><section className="v6c-loading-state">Loading OrbitFS Store…</section></main>;

  const baseFeatures=Array.isArray(base?.metadata?.store_features)?base.metadata.store_features:[];

  return <main className="portalPage storePage">
    <StoreFlowNav count={cart.item_count||0}/>

    <header className="storeHero">
      <div>
        <p className="eyebrow">{storeText.hero_eyebrow||"ORBITFS STORE"}</p>
        <h1>{storeText.hero_title||"Build your OrbitFS setup"}</h1>
        <p className="storeLead">{storeText.hero_lead||"Start with OrbitFS Base System, then add the components you need."}</p>
      </div>
      <Link className="storeTextAction storeCartJump" href="/portal/basket">Basket · {cart.item_count||0}</Link>
    </header>

    {msg&&<p className="v6c-store-message v6c-store-catalog-message">{msg}</p>}

    {base&&<section className="storeBaseFeature">
      <div className="storeBaseCopy">
        <span className="pill">{base.metadata?.store_badge||"Core system"}</span>
        <h2>{base.name}</h2>
        <p>{base.description}</p>
        {baseFeatures.length>0&&<div className="storeBasePoints">{baseFeatures.map((x:string)=><span key={x}>{x}</span>)}</div>}
      </div>
      <div className="storeBaseAction">
        <small>{storeText.base_action_label||"Base system"}</small>
        <strong>{productPrice(base)}</strong>
        {hasOptions(base)?<Link className="storePrimaryAction" href={"/portal/products/"+base.slug}>Configure {base.name}</Link>:<button className="storePrimaryAction" onClick={()=>void directAdd(base)}>Add to basket</button>}
        <Link className="storeTextAction" href={"/portal/products/"+base.slug}>Product details / gift →</Link>
      </div>
    </section>}

    {!!addons.length&&<section className="storeSection">
      <div className="storeSectionHead">
        <div>
          <p className="eyebrow">{storeText.addons_eyebrow||"EXPAND ORBITFS"}</p>
          <h2>{storeText.addons_title||"Add-ons"}</h2>
          <p className="muted">{storeText.addons_lead||"Add only the capabilities you want."}</p>
        </div>
      </div>
      <div className="storeAddonList">{addons.map(p=><article className="storeAddonCard" key={p.slug}>
        <div><span className="pill">{p.metadata?.store_badge||"Add-on"}</span><h3>{p.name}</h3><p>{p.description}</p></div>
        <div className="storeAddonMeta">
          <strong>{productPrice(p)}</strong>
          {hasOptions(p)?<Link className="storePrimaryAction" href={"/portal/products/"+p.slug}>Configure & add</Link>:<button className="storePrimaryAction" onClick={()=>void directAdd(p)}>Add to basket</button>}
          <Link className="storeTextAction" href={"/portal/products/"+p.slug}>Details / gift →</Link>
        </div>
      </article>)}</div>
    </section>}
  </main>;
}
