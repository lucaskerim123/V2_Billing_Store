import {cors,reply} from "@/lib/license-api";

const MASTER_ORIGIN="https://incendiarynetworks.cc/api";

export async function GET(){
  try{
    const base=MASTER_ORIGIN;
    const response=await fetch(`${base}/license/public-key`,{cache:"no-store"});
    const key=await response.text();
    if(!response.ok)throw Object.assign(new Error(key||"Master public key unavailable"),{status:response.status});
    return new Response(key,{status:200,headers:{...cors,"content-type":"text/plain; charset=utf-8"}});
  }catch(e:any){return reply({error:e?.message||"Master public key unavailable",code:"MASTER_PUBLIC_KEY_UNAVAILABLE"},e?.status||502)}
}
export async function OPTIONS(){return new Response(null,{status:204,headers:cors})}
