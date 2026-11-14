// The old Main Vercel hostname is retained only as a legacy entry. Browser
// navigations always move to the stable Billing hostname after the License Manager
// confirms that the active Production service is ready. No API or payment calls are forwarded.
const AUTHORITIES=['https://incendiarynetworks.cc/api/v1/source-routing'] as const;
const MAIN_HOST='orbitfsstore.vercel.app';
const CANONICAL_STORE='https://billing.incendiarynetworks.cc';
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
      if((state.mode!=='main'&&state.mode!=='fallback')||state.ready?.billing!==true||
        state.targets?.billing!==CANONICAL_STORE)continue;
      const source=new URL(url),target=new URL(CANONICAL_STORE);
      target.pathname=source.pathname;
      target.search=source.search;
      return target.toString();
    }catch{
      // The shared canonical endpoint can be temporarily unavailable; fail closed without confirmed readiness.
    }
  }
  // Never redirect when the License Manager cannot confirm the active service.
  return;
}
