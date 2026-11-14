// The old Main Vercel hostname is retained only as a legacy entry. Browser
// navigations move to the stable Billing hostname only when License Manager
// verifies that FALLBACK has a READY Production deployment. No customer
// database or payment API calls are forwarded to a different host.
const AUTHORITIES=['https://lm.incendiarynetworks.cc/api/v1/source-routing','https://incendiarynetworks.cc/api/v1/source-routing'] as const;
const MAIN_HOST='orbitfsstore.vercel.app';
const FALLBACK_STORE='https://billing.incendiarynetworks.cc';
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
  for(const authority of AUTHORITIES){
    try{
      const response=await get(authority,{
        cache:'no-store',signal:AbortSignal.timeout(3500),
        headers:{accept:'application/json'}
      });
      if(!response.ok)continue;
      const state=await response.json() as {
        mode?:string;ready?:{billing?:boolean};targets?:{billing?:string}
      };
      if(state.mode!=='fallback'||state.ready?.billing!==true||
        state.targets?.billing!==FALLBACK_STORE)continue;
      const source=new URL(url),target=new URL(FALLBACK_STORE);
      target.pathname=source.pathname;
      target.search=source.search;
      return target.toString();
    }catch{
      // The other License Manager may still be available during failover.
    }
  }
  // Never redirect when neither authority confirms fallback readiness.
  return;
}
