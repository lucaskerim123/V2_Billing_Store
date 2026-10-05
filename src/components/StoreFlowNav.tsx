"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";

export default function StoreFlowNav({count}:{count?:number}){
  const path=usePathname();
  const active=(href:string)=>path===href||path.startsWith(href+"/");
  return <nav className="v6c-store-flow" aria-label="Store checkout flow">
    <Link className={active("/portal/products")?"active":""} href="/portal/products"><span>01</span>Store</Link>
    <Link className={active("/portal/basket")?"active":""} href="/portal/basket"><span>02</span>Basket{typeof count==="number"?" · "+count:""}</Link>
    <Link className={active("/portal/checkout")?"active":""} href="/portal/checkout"><span>03</span>Checkout</Link>
  </nav>;
}
