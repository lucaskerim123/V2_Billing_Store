import type {NextRequest} from 'next/server';
import {NextResponse} from 'next/server';

// Billings must not operate independently of License Manager's shared
// authoritative mode. Fail closed, including for API and server actions.
const FAMILY='main';
const SOURCES=[
  'https://incendiarynetworks.cc/api/v1/source-configuration',
  'https://lm.incendiarynetworks.cc/api/v1/source-configuration',
] as const;

export async function proxy(request:NextRequest){
  let confirmed=false;
  for(const source of SOURCES){
    try{
      const response=await fetch(source,{
        cache:'no-store',signal:AbortSignal.timeout(3500),
        headers:{accept:'application/json'},
      });
      if(!response.ok)continue;
      const state=await response.json() as {mode?:string};
      if(state.mode!=='main'&&state.mode!=='fallback')continue;
      if(state.mode!==FAMILY)return NextResponse.json(
        {error:'SOURCE_MODE_STANDBY',activeMode:state.mode},
        {status:503,headers:{'cache-control':'no-store'}},
      );
      confirmed=true;
      break;
    }catch{ /* A configured License Manager can be temporarily unavailable. */ }
  }
  if(!confirmed)return NextResponse.json(
    {error:'SOURCE_MODE_UNVERIFIED'},
    {status:503,headers:{'cache-control':'no-store'}},
  );
  return NextResponse.next();
}
export const config={
  matcher:['/((?!_next/static|_next/image|favicon.ico).*)'],
};
