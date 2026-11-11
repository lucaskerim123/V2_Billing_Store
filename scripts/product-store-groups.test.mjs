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
 assert.match(route,/Ungrouped/);
});

test('OrbitFS remains a normal product group rather than a hard-coded storefront layout',()=>{
 const page=read('../src/app/portal/products/page.tsx');
 assert.doesNotMatch(page,/OrbitFS Base System/);
 assert.doesNotMatch(page,/Add-ons/);
 assert.match(page,/groups\.map/);
});
