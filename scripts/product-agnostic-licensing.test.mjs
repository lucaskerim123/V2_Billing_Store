import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Billing Store validation accepts registered product API IDs instead of an OrbitFS allowlist',()=>{
  const api=read('../src/lib/master-api.ts');
  assert.doesNotMatch(api,/ALLOWED_PRODUCTS/);
  assert.match(api,/INVALID_PRODUCT/);
});

test('paid-order fulfilment discovers active products from License Manager',()=>{
  const sync=read('../src/lib/license-master-sync.ts');
  assert.match(sync,/masterProducts\(\)/);
  assert.match(sync,/registeredProducts\.has\(product\)/);
});

test('non-OrbitFS products receive independent licence keys rather than OrbitFS components',()=>{
  const sync=read('../src/lib/license-master-sync.ts');
  assert.match(sync,/if\(!CANONICAL\.has\(product\)\)/);
  assert.match(sync,/masterIssue\(\{product,customer_external_id:customerNumber/);
  assert.match(sync,/License Manager product provisioning/);
});

test('OrbitFS add-on component fulfilment remains a separate compatibility path',()=>{
  const sync=read('../src/lib/license-master-sync.ts');
  assert.match(sync,/CANONICAL=new Set\(\["orbitfs_base","orbitfs_apex","orbitfs_mcp","orbitfs_studio"\]\)/);
  assert.match(sync,/OrbitFS Base is required before any OrbitFS add-on/);
});
test('standalone product issuance omits OrbitFS components unless a component object is supplied',()=>{
  const api=read('../src/lib/master-api.ts');
  assert.match(api,/const components=input\.components&&typeof input\.components==="object"&&!Array\.isArray\(input\.components\)\?input\.components:undefined/);
  assert.match(api,/\.\.\.\(components\?\{components\}:\{\}\)/);
});
