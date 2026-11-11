import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');

test('customer product catalogue renders products by License Manager group, not Base and add-ons',()=>{
 const page=read('../src/app/portal/products/page.tsx');
 assert.match(page,/\/api\/store\/catalog/);
 assert.match(page,/group\.name/);
 assert.match(page,/group\.products/);
 assert.doesNotMatch(page,/const base=useMemo/);
 assert.doesNotMatch(page,/const addons=useMemo/);
 assert.doesNotMatch(page,/storeBaseFeature/);
});

test('store catalogue returns all active Billing Store products and central group membership',()=>{
 const route=read('../src/app/api/store/catalog/route.ts');
 assert.match(route,/from\("products"\)/);
 assert.match(route,/masterProductGroups/);
 assert.match(route,/masterProducts/);
 assert.match(route,/Other products/);
});

test('OrbitFS remains a normal product group rather than a hard-coded storefront layout',()=>{
 const page=read('../src/app/portal/products/page.tsx');
 assert.doesNotMatch(page,/OrbitFS Base System/);
 assert.doesNotMatch(page,/Add-ons/);
 assert.match(page,/groups\.map/);
});

test('standalone local products can load product details and skip License Manager sync when licensing is disabled',()=>{
 const catalogue=read('../src/app/api/orbitfs/catalog/route.ts');
 const detail=read('../src/app/products/[slug]/page.tsx');
 assert.match(catalogue,/from\("products"\)\.select\("\*"\)\.eq\("slug",slug\)/);
 assert.match(detail,/!product\?\.license_api_enabled/);
});

test('standalone products remain listed when the central licensing service is unavailable',()=>{
 const route=read('../src/app/api/store/catalog/route.ts');
 assert.match(route,/masterProducts\(\)\.catch/);
 assert.match(route,/masterProductGroups\(\)\.catch/);
});


test('public billing store renders active License Manager products by group and includes standalone store products',()=>{
 const page=read('../src/app/billing/page.tsx');
 assert.match(page,/masterRequest\("\/api\/v1\/products"/);
 assert.match(page,/masterRequest\("\/api\/v1\/product-groups"/);
 assert.match(page,/license_product_key/);
 assert.match(page,/group_id/);
 assert.match(page,/Other products/);
 assert.match(page,/groups\.map/);
 assert.match(page,/status\|\|"active"/);
 assert.doesNotMatch(page,/OrbitFS Base and add-ons/);
 assert.doesNotMatch(page,/componentOrder/);
});
