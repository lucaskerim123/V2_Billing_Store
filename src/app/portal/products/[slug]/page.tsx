"use client";

import Link from "next/link";
import {use,useEffect,useMemo,useState} from "react";
import StoreFlowNav from "@/components/StoreFlowNav";
import {createClient} from "@/lib/supabase";

const money=(cents:number,currency="AUD")=>new Intl.NumberFormat("en-AU",{style:"currency",currency}).format(Number(cents||0)/100);

export default function BuyProduct({params}:{params:Promise<{slug:string}>}){
  const {slug}=use(params);
  const sb=useMemo(()=>createClient(),[]);
  const [p,setP]=useState<any>();
  const [opts,setOpts]=useState<any[]>([]);
  const [chosen,setChosen]=useState<Record<string,any>>({});
  const [msg,setMsg]=useState("");
  const [account,setAccount]=useState<any>();
  const [deps,setDeps]=useState<any[]>([]);
  const [owned,setOwned]=useState(false);
  const [gift,setGift]=useState(false);
  const [giftEmail,setGiftEmail]=useState("");

  useEffect(()=>{
    let live=true;
    (async()=>{
      const {data:{user}}=await sb.auth.getUser();
      if(!user){location.href="/login";return}
      const [{data:prof},{data:prod}]=await Promise.all([
        sb.from("user_profiles").select("status,banned_at,ban_reason").eq("id",user.id).single(),
        sb.from("products").select("*").eq("slug",slug).eq("active",true).single()
      ]);
      if(!live)return;
      setAccount(prof);
      setP(prod);
      if(prod){
        const [{data:o},{data:d},{data:e}]=await Promise.all([
          sb.from("product_options").select("*").eq("product_id",prod.id).eq("active",true).order("sort_order"),
          sb.from("product_dependencies").select("requires_product_id").eq("product_id",prod.id),
          sb.from("download_entitlements").select("id").eq("auth_user_id",user.id).eq("product_id",prod.id).eq("status","active").limit(1)
        ]);
        if(!live)return;
        setOpts(o||[]);
        setDeps(d||[]);
        setOwned(!!e?.length);
      }
    })();
    return()=>{live=false};
  },[sb,slug]);

  const configured=!!p&&(p.price_cents!=null||p.metadata?.free_product);
  const displayTotal=useMemo(()=>Number(p?.price_cents||0)+opts.reduce((sum,o)=>{
    const selected=chosen[o.key];
    if(selected===undefined||selected===""||selected===false)return sum;
    if(o.option_type==="select"){
      const choice=(o.choices||[]).find((x:any)=>(typeof x==="string"?x:x.value)===selected);
      return sum+Number((typeof choice==="object"?choice?.price_delta_cents:null)??o.price_delta_cents??0);
    }
    return sum+Number(o.price_delta_cents||0);
  },0),[p,opts,chosen]);

  async function addBasket(){
    if(!p||!configured)return setMsg("This product does not have pricing configured yet.");
    if(account?.banned_at||account?.status!=="active")return setMsg("Your account cannot place new orders right now.");
    if(owned&&!gift)return setMsg("You already own this product. Choose Buy as a gift to purchase another copy.");
    if(gift&&!/^\S+@\S+\.\S+$/.test(giftEmail.trim()))return setMsg("Enter the recipient's email address.");
    for(const o of opts){
      if(o.required&&(chosen[o.key]===undefined||chosen[o.key]===""))return setMsg("Choose "+o.label+" before continuing.");
    }
    setMsg("Adding to basket…");
    const configuration={...chosen,...(gift?{gift:true,gift_recipient_email:giftEmail.trim().toLowerCase()}:{})};
    const {error}=await sb.rpc("add_to_cart",{p_product_id:p.id,p_configuration:configuration});
    if(error){setMsg(error.message);return}
    setMsg(gift?p.name+" added as a gift for "+giftEmail.trim()+".":p.name+" added to your basket.");
  }

  function field(o:any){
    const v=chosen[o.key]??(o.option_type==="toggle"?false:"");
    if(o.option_type==="text")return <input value={v} onChange={e=>setChosen({...chosen,[o.key]:e.target.value})}/>;
    if(o.option_type==="number")return <input type="number" value={v} onChange={e=>setChosen({...chosen,[o.key]:e.target.value})}/>;
    if(o.option_type==="toggle")return <label className="storeOptionToggle"><input type="checkbox" checked={!!v} onChange={e=>setChosen({...chosen,[o.key]:e.target.checked})}/><span>Enable</span></label>;
    return <select value={v} onChange={e=>setChosen({...chosen,[o.key]:e.target.value})}>
      <option value="">Choose…</option>
      {(o.choices||[]).map((x:any)=><option key={typeof x==="string"?x:x.value} value={typeof x==="string"?x:x.value}>
        {typeof x==="string"?x:x.label}{typeof x==="object"&&x.price_delta_cents?" (+"+money(x.price_delta_cents,p?.currency||"AUD")+")":""}
      </option>)}
    </select>;
  }

  if(!p)return <main className="portalPage"><section className="v6c-loading-state">Loading product…</section></main>;

  const isBase=p.metadata?.component==="base";
  const priceLabel=!configured?"Pricing not configured":p.metadata?.free_product&&displayTotal===0?"Free":money(displayTotal,p.currency||"AUD");

  return <main className="portalPage productDetailV3">
    <StoreFlowNav/>

    <div className="storeProductTopline">
      <span className="eyebrow">PRODUCT DETAILS</span>
      <Link className="storeTextAction" href="/portal/products">← OrbitFS Store</Link>
    </div>

    <section className="storeProductHero">
      <div>
        <p className="eyebrow">{isBase?"ORBITFS CORE":"ORBITFS ADD-ON"}</p>
        <h1>{p.name}</h1>
        <p>{p.description}</p>
      </div>
      <div className="storeProductPrice">
        <small>ORDER TOTAL</small>
        <strong>{priceLabel}</strong>
      </div>
    </section>

    <div className="storeProductLayout">
      <section className="storeProductMain">
        {deps.length>0&&<div className="notice">
          <b>OrbitFS Base required</b>
          <span>This add-on requires an active paid Base entitlement and enables a component on that same licence.</span>
        </div>}

        <div className="storeProductSection">
          <div className="storeProductSectionHead">
            <p className="eyebrow">CONFIGURATION</p>
            <h2>{opts.length?"Choose product options":"No configuration required"}</h2>
          </div>
          {opts.length>0
            ?<div className="storeConfigGrid">{opts.map(o=><label className="configField" key={o.id}><span>{o.label}{o.required?" *":""}</span>{field(o)}</label>)}</div>
            :<p className="muted">This product is ready to add without additional configuration.</p>}
        </div>

        <div className="storeProductSection">
          <div className="storeProductSectionHead">
            <p className="eyebrow">PURCHASE TYPE</p>
            <h2>Who is this for?</h2>
          </div>
          <label className={"storeGiftChoice "+(gift?"active":"")}>
            <input type="checkbox" checked={gift} onChange={e=>setGift(e.target.checked)}/>
            <span><b>Buy as a gift</b><small>The recipient receives the product on their OrbitFS account after payment.</small></span>
          </label>
          {gift&&<label className="storeGiftEmail">
            <span>Recipient email</span>
            <input type="email" value={giftEmail} onChange={e=>setGiftEmail(e.target.value)} placeholder="recipient@example.com"/>
            <small>If they do not have an OrbitFS account, one will be created and temporary sign-in details will be sent to them.</small>
          </label>}
        </div>
      </section>

      <aside className="storePurchaseCard">
        <div><small>ORDER TOTAL</small><strong>{priceLabel}</strong></div>
        {owned&&<div className="notice"><b>You already own this product</b><span>Choose Buy as a gift to purchase another copy.</span></div>}
        <p>{gift?"This copy will be delivered to the recipient after payment.":"The product will be attached to your account after payment."}</p>
        <button className="storePrimaryAction storePurchaseAction" disabled={!configured||owned&&!gift} onClick={()=>void addBasket()}>
          {gift?"Add gift to basket":"Add to basket"}
        </button>
        <Link className="storeSecondaryAction" href="/portal/basket">View basket</Link>
        {msg&&<p className="storeActionMessage" role="status">{msg}</p>}
      </aside>
    </div>
  </main>;
}
