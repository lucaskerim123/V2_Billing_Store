import type {NextRequest} from 'next/server';
import {NextResponse} from 'next/server';
import {standbyStoreUrl} from './lib/source-routing';

// Next.js 16 Proxy handles document navigations at the stable Main host.
// The URL changes to the Fallback Vercel production address only when READY,
// avoiding cross-account custom-domain transfers and cross-origin proxy auth.
export async function proxy(request:NextRequest){
  const destination=await standbyStoreUrl(
    request.url,request.method,request.headers.get('accept')||''
  );
  if(destination)return NextResponse.redirect(destination,307);
  return NextResponse.next();
}
export const config={
  matcher:['/((?!api|_next|favicon.ico|robots.txt|sitemap.xml).*)'],
};
