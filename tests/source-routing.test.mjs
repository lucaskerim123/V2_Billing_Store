import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleStoreNavigation,standbyStoreUrl} from '../src/lib/source-routing.ts';
const home='https://orbitfsstore.vercel.app/cart?q=one';
test('only public store browser GETs on the legacy Main Vercel alias are routed',()=>{
  assert.equal(eligibleStoreNavigation(home,'GET','text/html'),true);
  for(const url of ['https://v2-billing-store.vercel.app/','https://orbitfsstore.vercel.app/api/checkout','https://orbitfsstore.vercel.app/_next/static/chunk.js'])
    assert.equal(eligibleStoreNavigation(url,'GET','text/html'),false);
  assert.equal(eligibleStoreNavigation(home,'POST','text/html'),false);
  assert.equal(eligibleStoreNavigation(home,'GET','application/json'),false);
});
test('MAIN and FALLBACK redirect the legacy Vercel alias to the canonical Billing URL',async()=>{
  for(const mode of ['main','fallback']){
    const response=await standbyStoreUrl(home,'GET','text/html',async()=>
      new Response(JSON.stringify({mode,ready:{billing:true},targets:{
        billing:'https://billing.incendiarynetworks.cc'
      }})));
    assert.equal(response,'https://billing.incendiarynetworks.cc/cart?q=one');
  }
});
test('unready, invalid mode, invalid host, or unavailable authority never redirects',async()=>{
  for(const state of [
    {mode:'invalid',ready:{billing:true},targets:{billing:'https://billing.incendiarynetworks.cc'}},
    {mode:'fallback',ready:{billing:false},targets:{billing:'https://billing.incendiarynetworks.cc'}},
    {mode:'fallback',ready:{billing:true},targets:{billing:'https://other.example'}},
  ]) assert.equal(await standbyStoreUrl(home,'GET','text/html',async()=>new Response(JSON.stringify(state))),undefined);
  assert.equal(await standbyStoreUrl(home,'GET','text/html',async()=>{throw new Error('offline')}),undefined);
});
