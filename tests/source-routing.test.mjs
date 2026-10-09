import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleStoreNavigation,standbyStoreUrl} from '../src/lib/source-routing.ts';
const home='https://orbitfsstore.vercel.app/cart?q=one';
test('only public store browser GETs on the stable Main domain are routed',()=>{
  assert.equal(eligibleStoreNavigation(home,'GET','text/html'),true);
  for(const url of ['https://v2-billing-store.vercel.app/','https://orbitfsstore.vercel.app/api/checkout','https://orbitfsstore.vercel.app/_next/static/chunk.js'])
    assert.equal(eligibleStoreNavigation(url,'GET','text/html'),false);
  assert.equal(eligibleStoreNavigation(home,'POST','text/html'),false);
  assert.equal(eligibleStoreNavigation(home,'GET','application/json'),false);
});
test('FALLBACK must have a verified ready Production store',async()=>{
  const response=await standbyStoreUrl(home,'GET','text/html',async()=>
    new Response(JSON.stringify({mode:'fallback',ready:{billing:true},targets:{
      billing:'https://orbitfs-billing-fallback.vercel.app'
    }})));
  assert.equal(response,'https://orbitfs-billing-fallback.vercel.app/cart?q=one');
});
test('unready, Main, invalid host, or unavailable authority never redirects',async()=>{
  for(const state of [
    {mode:'main',ready:{billing:true},targets:{billing:'https://orbitfs-billing-fallback.vercel.app'}},
    {mode:'fallback',ready:{billing:false},targets:{billing:'https://orbitfs-billing-fallback.vercel.app'}},
    {mode:'fallback',ready:{billing:true},targets:{billing:'https://other.example'}},
  ]) assert.equal(await standbyStoreUrl(home,'GET','text/html',async()=>new Response(JSON.stringify(state))),undefined);
  assert.equal(await standbyStoreUrl(home,'GET','text/html',async()=>{throw new Error('offline')}),undefined);
});
