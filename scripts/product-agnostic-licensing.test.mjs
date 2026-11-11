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
  assert.match(sync,/productStrategy\(product\)==="standalone"/);
  assert.match(sync,/masterIssue\(\{product,customer_external_id:customerNumber/);
  assert.match(sync,/validation_policy\?\.license_strategy/);
  assert.match(sync,/License Manager product provisioning/);
});

test('OrbitFS add-on component fulfilment remains a separate compatibility path',()=>{
  const sync=read('../src/lib/license-master-sync.ts');
  assert.match(sync,/productStrategy\(product\)==="component"/);
  assert.match(sync,/productStrategy\(product\)==="base"/);
  assert.match(sync,/A base product licence is required before a component product can be fulfilled/);
});
test('standalone product issuance omits OrbitFS components unless a component object is supplied',()=>{
  const api=read('../src/lib/master-api.ts');
  assert.match(api,/const product=String\(input\.product\|\|input\.product_code\|\|input\.productCode\|\|""\)/);
  assert.match(api,/LICENSE_PRODUCT_REQUIRED/);
  assert.doesNotMatch(api,/productCode\|\|"orbitfs_base"/);
  assert.match(api,/\.\.\.\(components\?\{components\}:\{\}\)/);
});

test('product strategies are read from License Manager policy and default to standalone',()=>{
  const sync=read('../src/lib/license-master-sync.ts');
  assert.match(sync,/const registeredProductEntries:\s*\[string,\s*any\]\[\]\s*=/);
  assert.matchsync,/new Map<string,\s*any>\(registeredProductEntries\)/);
  assert.match(sync,/validation_policy\?\.license_strategy\|\|"standalone"/);
  assert.doesNotMatch(sync,/CANONICAL/);
});
test('licence issuance refuses to guess a product when callers omit the product API ID',()=>{
  const api=read('../src/lib/master-api.ts');
  assert.match(api,/LICENSE_PRODUCT_REQUIRED/);
  assert.doesNotMatch(api,/product:input\.product\|\|input\.product_code\|\|input\.productCode\|\|"orbitfs_base"/);
});

test('new standalone issuance must return both a License Manager ID and one-time key before fulfilment is marked complete',()=>{
  const sync=read('../src/lib/license-master-sync.ts');
  assert.match(sync,/if\(!licenseId\)throw new Error\("License Manager did not return a licence ID"\)/);
  assert.match(sync,/if\(!licenseKey&&!alreadyIssued\)throw new Error\("License Manager returned a licence ID without the one-time licence key"\)/);
});

test('fulfilled Billing Store orders are checked against License Manager before being reported successful',()=>{
  const sync=read('../src/lib/license-master-sync.ts');
  assert.match(sync,/masterLicenses\(\)/);
  assert.match(sync,/remoteLicenseActive/);
  assert.match(sync,/existing\.state===\"fulfilled\"&&remoteLicenseActive/);
  assert.doesNotMatch(sync,/if\(priorState===\"fulfilled\"\)return/);
});

test('remote licence status index preserves string key/value types for strict TypeScript',()=>{
  const sync=read('../src/lib/license-master-sync.ts');
  assert.match(sync,/const remoteLicenseEntries:\s*\[string,\s*string\]\[\]\s*=\s*\([\s\S]*?\.map\(\s*\(license:\s*any\):\s*\[string,\s*string\]\s*=>/);
  assert.match(sync,/new Map<string,\s*string>\(remoteLicenseEntries\)/);
});

test('registered product catalogue index preserves key and product types for strict TypeScript',()=>{
  const sync=read('../src/lib/license-master-sync.ts');
  assert.match(sync,/const registeredProductEntries:\s*\[string,\s*any\]\[\]\s*=\s*\([\s\S]*?\.map\(\s*\(p:\s*any\):\s*\[string,\s*any\]\s*=>/);
  assert.match(sync,/new Map<string,\s*any>\(registeredProductEntries\)/);
});
