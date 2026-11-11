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

test('component fulfilment resolves each product base key from License Manager policy',()=>{
 const sync=read('../src/lib/license-master-sync.ts');
 assert.match(sync,/productStrategy\(product\)==="component"/);
 assert.match(sync,/productStrategy\(product\)==="base"/);
 assert.match(sync,/validation_policy\?\.base_product_key/);
 assert.match(sync,/baseProductKeyFor/);
 assert.match(sync,/baseBindings/);
 assert.match(sync,/license_api_enabled/);
 assert.doesNotMatch(sync,/baseProductCode/);
 assert.doesNotMatch(sync,/hasAddon/);
 assert.doesNotMatch(sync,/hasBase/);
});;
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
  assert.match(sync,/new Map<string,\s*any>\(registeredProductEntries\)/);
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

test('standalone fulfilment does not require the separate License Manager licence-list permission',()=>{
  const sync=read('../src/lib/license-master-sync.ts');
  assert.match(sync,/needsBaseSnapshot=licensedItems\.some/);
  assert.match(sync,/needsBaseSnapshot\?await masterLicenses\(\):\{licenses:\[\]\}/);
});

test('fulfilled Billing Store orders are checked against License Manager before being reported successful',()=>{
  const sync=read('../src/lib/license-master-sync.ts');
  assert.match(sync,/masterLicenses\(\)/);
  assert.match(sync,/remoteLicenseActive/);
  assert.match(sync,/existing\.state===\"fulfilled\"&&remoteLicenseActive/);
  assert.doesNotMatch(sync,/if\(priorState===\"fulfilled\"\)return/);
});

test('order provisioning success requires a confirmed License Manager licence ID',()=>{
  const sync=read('../src/lib/license-master-sync.ts');
  const route=read('../src/app/api/admin/license-master/order-control/route.ts');
  assert.match(sync,/const licenseIssued=results\.filter\(\(result:any\)=>Boolean\(result\.licenseId\)\)\.length/);
  assert.match(sync,/ok:failed===0&&licenseIssued>0/);
  assert.match(route,/Number\(result\?\.licenseIssued\|\|0\)<1/);
});

test('remote licence status index preserves string key/value types for strict TypeScript',()=>{
  const sync=read('../src/lib/license-master-sync.ts');
  assert.match(sync,/const remoteLicenseEntries:\s*\[string,\s*string\]\[\]\s*=\s*\([\s\S]*?\.map\(\s*\(license:\s*any\):\s*\[string,\s*string\]\s*=>/);
  assert.match(sync,/new Map<string,\s*string>\(remoteLicenseEntries\)/);
});

test('registered product catalogue index preserves key and product types for strict TypeScript',()=>{
  const sync=read('../src/lib/license-master-sync.ts');
  assert.match(sync,/const registeredProductEntries:\s*\[string,\s*any\]\[\]\s*=\s*\([\s\S]*?\.flatMap\(\s*\(p:\s*any\):\s*\[string,\s*any\]\[\]\s*=>/);
  assert.match(sync,/new Map<string,\s*any>\(registeredProductEntries\)/);
});


test('product licence issue flow uses registered canonical product codes',()=>{
 const api=read('../src/app/api/admin/product-licenses/route.ts');
 const page=read('../src/app/admin/product-licenses/page.tsx');
 assert.match(api,/productRecord\.code\|\|productRecord\.product_code\|\|productRecord\.slug/);
 assert.match(page,/row\.code\|\|row\.product_code\|\|row\.slug/);
});
test('existing licence linking accepts standalone products without an OrbitFS Base prerequisite',()=>{
 const route=read('../src/app/api/admin/license-link/route.ts');
 assert.match(route,/masterProducts\(\)/);
 assert.match(route,/validation_policy\?\.license_strategy/);
 assert.doesNotMatch(route,/ALLOWED_PRODUCTS/);
 assert.doesNotMatch(route,/OrbitFS Base must be linked/);
});
test('admin licence assignment requires an explicit registered product',()=>{
 const route=read('../src/app/api/admin/license-assign/route.ts');
 assert.match(route,/requestedProduct=String\(body\.product\|\|body\.product_code\|\|""\)/);
 assert.match(route,/masterProducts\(\)/);
 assert.doesNotMatch(route,/body\.product\|\|"orbitfs_base"/);
});

test('approved pending licences are retried by a guarded Vercel Cron GET route',()=>{
 const config=JSON.parse(read('../vercel.json'));
 assert.ok(config.crons.some(job=>job.path==='/api/admin/license-master/reconcile'&&job.schedule==='*/5 * * * *'));
 const route=read('../src/app/api/admin/license-master/reconcile/route.ts');
 assert.match(route,/export async function GET\(req:Request\)/);
 assert.match(route,/process\.env\.CRON_SECRET/);
 assert.match(route,/authorization/);
 assert.match(route,/reconcileLicenseMaster/);
});

test('reconciliation applies a retry cooldown so a broken authority is not hammered every cron tick',()=>{
 const reconcile=read('../src/lib/license-master-reconcile.ts');
 assert.match(reconcile,/\.lt\("updated_at",\s*new Date\(Date\.now\(\)-5\*60\*1000\)\.toISOString\(\)\)/);
});

test('product-catalogue failures are recorded against the pending order instead of leaving a false active state',()=>{
 const sync=read('../src/lib/license-master-sync.ts');
 assert.match(sync,/License Manager product catalogue request failed/);
 assert.match(sync,/state:"failed"/);
 assert.match(sync,/last_error:message/);
 assert.match(sync,/service_status:"provisioning_error"/);
});
