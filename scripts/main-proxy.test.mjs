import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../src/proxy.ts',import.meta.url),'utf8');
const authority='https://incendiarynetworks.cc/api/v1/source-configuration';
const canonicalStore='https://billing.incendiarynetworks.cc';

function loadProxy(response,standbyTarget) {
  const compiled=ts.transpileModule(source,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  const loaded={exports:{}};
  const calls=[],standbyCalls=[];
  const nextResponse={
    json:(body,options={})=>({kind:'json',body,status:options.status??200}),
    next:()=>({kind:'next'}),
    redirect:(url,status)=>({kind:'redirect',url:String(url),status})
  };
  new Function('exports','module','require','fetch',compiled)(
    loaded.exports,loaded,(name)=>{
      if(name==='next/server')return {NextResponse:nextResponse};
      if(name==='./lib/source-routing')return {standbyStoreUrl:async(...args)=>{standbyCalls.push(args);return standbyTarget;}};
      throw new Error('Unexpected Main proxy dependency: '+name);
    },async(url)=>{calls.push(url);if(response instanceof Error)throw response;return response;}
  );
  return {proxy:loaded.exports.proxy,calls,standbyCalls};
}

const request=(path='/store',method='GET')=>({
  url:'https://orbitfsstore.vercel.app'+path,
  method,nextUrl:{pathname:path},headers:{get:()=>method==='GET'?'text/html':'application/json'}
});
const responseFor=(mode,ok=true)=>({ok,json:async()=>({mode})});

test('Main proxy sends eligible legacy browser navigation to the stable Billing URL',async()=>{
  const target=canonicalStore+'/cart?q=one';
  const {proxy,calls,standbyCalls}=loadProxy(responseFor('main'),target);
  assert.deepEqual(await proxy(request('/cart?q=one')),{kind:'redirect',url:target,status:307});
  assert.deepEqual(calls,[]);
  assert.equal(standbyCalls.length,1);
});

test('Main mode is served only after canonical License Manager confirmation',async()=>{
  const {proxy,calls}=loadProxy(responseFor('main'));
  assert.deepEqual(await proxy(request('/api/orders','POST')),{kind:'next'});
  assert.deepEqual(calls,[authority]);
});

test('Fallback mode places Main into standby',async()=>{
  const {proxy,calls}=loadProxy(responseFor('fallback'));
  assert.deepEqual(await proxy(request('/api/orders','POST')),{kind:'json',body:{error:'SOURCE_MODE_STANDBY',activeMode:'fallback'},status:503});
  assert.deepEqual(calls,[authority]);
});

test('Unverified or unavailable authority fails closed',async()=>{
  for(const reply of [responseFor('invalid'),responseFor('main',false),new Error('offline')]){
    const {proxy,calls}=loadProxy(reply);
    assert.deepEqual(await proxy(request('/api/orders','POST')),{kind:'json',body:{error:'SOURCE_MODE_UNVERIFIED'},status:503});
    assert.deepEqual(calls,[authority]);
  }
});

test('Handover health is readable without source lookup',async()=>{
  const {proxy,calls,standbyCalls}=loadProxy(new Error('offline'));
  assert.deepEqual(await proxy(request('/api/handover-health')),{kind:'json',body:{ready:true},status:200});
  assert.deepEqual(calls,[]);
  assert.deepEqual(standbyCalls,[]);
});
