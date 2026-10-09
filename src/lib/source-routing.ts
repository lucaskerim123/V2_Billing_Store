// Main Billing Store is the stable entry. Browser navigations only move
// to the selected standby Store when License Manager verifies that it has a
// READY Production deployment. No customer database or payment API calls are
// forwarded to a different host.
const AUTHORITY='https://incendiarynetworks.cc/api/v1/source-routing';
const MAIN_HOST='orbitfsstore.vercel.app';
const FALLBACK_STORE='https://orbitfs-billing-fallback.vercel.app';
export function eligibleStoreNavigation(url:string,method:string,accept:string):boolean{
  const current=new URL(url);
  return current.hostname.toLowerCase()===MAIN_HOST &&
    method==='GET' &&
    accept.toLowerCase().includes('text/html') &&
    !/^\/(?:api|_next|\.well-known)(?:\/|$)/.test(current.pathname);
}
export async function standbyStoreUrl(
  url:string,
  method:string,
  accept:string,
  get:typeof fetch=fetch
):Promise<string|undefined>{
  if(!eligibleStoreNavigation(url,method,accept))return;
  try{
    const response=await get(AUTHORITY,{
      cache:'no-store',signal:AbortSignal.timeout(3500),
      headers:{accept:'application/json'}
    });
    if(!response.ok)return;
    const state=await response.json() as {
      mode?:string;ready?:{billing?:boolean};targets?:{billing?:string}
    };
    if(state.mode!=='fallback'||state.ready?.billing!==true||
      state.targets?.billing!==FALLBACK_STORE)return;
    const source=new URL(url),target=new URL(FALLBACK_STORE);
    target.pathname=source.pathname;
    target.search=source.search;
    return target.toString();
  }catch{
    // Do not fail public website availability on authority API outages;
    // mutations still require authoritative technical licence checks.
    return;
  }
}
