import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../src/proxy.ts',import.meta.url),'utf8');
const authority='https://lm.incendiarynetworks.cc/api/v1/source-configuration';

function loadProxy(response) {
  const compiled=ts.transpileModule(source,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  const loaded={exports:{}};
  const calls=[];
  const nextResponse={
    json:(body,options={})=>({kind:'json',body,status:options.status??200}),
    next:()=>({kind:'next'}),
    redirect:()=>{throw new Error('Fallback must not redirect to another store');}
  };
  new Function('exports','module','require','fetch',compiled)(
    loaded.exports,loaded,(name)=>{
      if(name==='next/server')return {NextResponse:nextResponse};
      throw new Error(`Unexpected Fallback proxy dependency: ${name}`);
    },async(url)=>{calls.push(url);if(response instanceof Error)throw response;return response;}
  );
  return {proxy:loaded.exports.proxy,calls};
}

const request=(path='/store')=>({
  url:`https://orbitfs-billing-fallback.vercel.app${path}`,
  method:'GET',nextUrl:{pathname:path},headers:{get:()=> 'text/html'}
});
const responseFor=(mode,ok=true)=>({ok,json:async()=>({mode})});

test('Fallback proxy never imports Main-only standby browser routing',()=>{
  assert.doesNotMatch(source,/standbyStoreUrl|FAMILY\s*===\s*['"]main['"]/);
});

test('Fallback mode is served only when authoritative License Administration agrees',async()=>{
  const {proxy,calls}=loadProxy(responseFor('fallback'));
  assert.deepEqual(await proxy(request()),{kind:'next'});
  assert.deepEqual(calls,[authority]);
});

test('Main mode forces Fallback into standby',async()=>{
  const {proxy,calls}=loadProxy(responseFor('main'));
  assert.deepEqual(await proxy(request('/api/orders')),{kind:'json',body:{error:'SOURCE_MODE_STANDBY',activeMode:'main'},status:503});
  assert.deepEqual(calls,[authority]);
});

test('Unverified or unavailable authority fails closed',async()=>{
  for(const reply of [responseFor('invalid'),responseFor('fallback',false),new Error('offline')]){
    const {proxy}=loadProxy(reply);
    assert.deepEqual(await proxy(request()),{kind:'json',body:{error:'SOURCE_MODE_UNVERIFIED'},status:503});
  }
});

test('Handover health is readable without a mode lookup',async()=>{
  const {proxy,calls}=loadProxy(new Error('offline'));
  assert.deepEqual(await proxy(request('/api/handover-health')),{kind:'json',body:{ready:true},status:200});
  assert.deepEqual(calls,[]);
});
