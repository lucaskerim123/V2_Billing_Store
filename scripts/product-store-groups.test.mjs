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

test('public storefront only exposes locally configured purchasable products and maps them to central groups',()=>{
 const page=read('../src/app/billing/page.tsx');
 assert.match(page,/localRows=.*price_cents!=null.*metadata\?\.free_product===true/);
 assert.match(page,/masterByCode\.get/);
 assert.match(page,/sourceGroups\.find/);
 assert.match(page,/Other products/);
 assert.doesNotMatch(page,/id:local\?\.id\|\|master\.id/);
});
test('product checkout copy is independent of OrbitFS branding',()=>{
 const detail=read('../src/app/products/[slug]/page.tsx');
 assert.match(detail,/Billing Store creates the order and invoice first/);
 assert.doesNotMatch(detail,/OrbitFS creates the order and invoice first/);
});

test('checkout only requires OrbitFS Base for OrbitFS add-ons, not independent products',()=>{
 const migration=read('../database/migrations/20261111_product_independent_checkout.sql');
 assert.match(migration,/license_product_key in \('orbitfs_apex','orbitfs_mcp','orbitfs_studio','orbitfs_sorter'\)/);
 assert.match(migration,/r\.metadata->>'product_family'/);
 assert.match(migration,/r\.metadata->>'store_kind'/);
 assert.doesNotMatch(migration,/license_product_key not in \('orbitfs_panel','orbitfs_base'\)/);
});

test('catalogue fallbacks retain typed product and product-group response shapes',()=>{
 const route=read('../src/app/api/store/catalog/route.ts');
 const page=read('../src/app/billing/page.tsx');
 assert.match(route,/catch\(\(\):MasterProductsResponse=>\(\{products:\[\]\}\)/);
 assert.match(route,/catch\(\(\):MasterProductGroupsResponse=>\(\{groups:\[\]\}\)/);
 assert.match(page,/catch\(\(\):MasterProductsResponse=>\(\{products:\[\]\}\)/);
 assert.match(page,/catch\(\(\):MasterProductGroupsResponse=>\(\{groups:\[\]\}\)/);
});
test('product licence inventory rows are explicitly typed when iterating grouped records',()=>{
 const page=read('../src/app/admin/product-licenses/page.tsx');
 assert.match(page,/groupRows\.map\(\(row:Row\)=>/);
});
