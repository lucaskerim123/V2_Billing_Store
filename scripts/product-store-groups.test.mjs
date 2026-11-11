import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');

test('product groups are nested under Products and accessible from the actual admin products page',()=>{
 const layout=read('../src/app/admin/AdminLayoutClient.tsx');
 const page=read('../src/app/admin/products/page.tsx');
 const productsGroup=layout.slice(layout.indexOf('const productsGroup:'),layout.indexOf('const orbitfsGroup:'));
 const billingGroup=layout.slice(layout.indexOf('const billingGroup:'),layout.indexOf('const customersGroup:'));
 assert.match(productsGroup,/Product Groups/);
 assert.match(productsGroup,/\/admin\/product-groups/);
 assert.match(productsGroup,/path\.startsWith\("\/admin\/product-groups"\)/);
 assert.doesNotMatch(billingGroup,/Product Groups/);
 assert.match(page,/href="\/admin\/product-groups"/);
});

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
 assert.match(page,/masterProducts\(\)/);
 assert.match(page,/masterProductGroups\(\)/);
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

test('checkout dependency rules are driven by License Manager product policy, never OrbitFS product keys',()=>{
 const migration=read('../database/migrations/20261112090000_product_policy_driven_checkout.sql');
 assert.match(migration,/license_validation_policy/);
 assert.match(migration,/license_strategy/);
 assert.match(migration,/base_product_key/);
 assert.doesNotMatch(migration,/orbitfs_(base|panel|apex|mcp|studio|sorter)/i);
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

test('central catalogue helpers preserve product and group element types through the shared API boundary',()=>{
 const api=read('../src/lib/master-api.ts');
 const page=read('../src/app/billing/page.tsx');
 assert.match(api,/export type MasterProductRecord = \{/);
 assert.match(api,/validation_policy\?: Record<string, unknown> \| null/);
 assert.match(api,/export type MasterProductGroupRecord = \{/);
 assert.match(api,/Promise<MasterProductsResponse>/);
 assert.match(api,/Promise<MasterProductGroupsResponse>/);
 assert.match(page,/masterProducts\(\)\.catch/);
 assert.match(page,/masterProductGroups\(\)\.catch/);
 assert.doesNotMatch(page,/masterRequest\("\/api\/v1\/(products|product-groups)"/);
});

test('admin product editor can assign a Billing Store product to a License Manager group',()=>{
 const page=read('../src/app/admin/products/page.tsx');
 const groupsApi=read('../src/app/api/admin/product-groups/route.ts');
 const assignApi=read('../src/app/api/admin/product-licenses/route.ts');
 assert.match(page,/Product group/);
 assert.match(page,/groups\.map/);
 assert.match(page,/saveProductGroup/);
 assert.match(page,/\/api\/admin\/product-licenses/);
 assert.match(groupsApi,/masterProducts\(\)/);
 assert.match(assignApi,/export async function PATCH/);
 assert.match(assignApi,/group_id:groupId/);
 assert.match(assignApi,/method:"PATCH"/);
 assert.match(assignApi,/method:"POST"/);
});

test('store catalogue persists current License Manager validation policy for database checkout',()=>{
 const route=read('../src/app/api/store/catalog/route.ts');
 assert.match(route,/license_validation_policy/);
 assert.match(route,/db\.from\("products"\)\.update/);
});
test('product detail catalogue sync preserves License Manager validation policy',()=>{
 const route=read('../src/app/api/orbitfs/catalog/route.ts');
 assert.match(route,/license_validation_policy:master\.validation_policy/);
});
test('manual fulfilment accepts registered standalone and component products without an OrbitFS allowlist',()=>{
 const route=read('../src/app/api/admin/fulfillment/route.ts');
 assert.match(route,/masterProducts\(\)/);
 assert.match(route,/validation_policy\?\.license_strategy/);
 assert.doesNotMatch(route,/const CANONICAL=new Set/);
 assert.doesNotMatch(route,/requires the customer's OrbitFS Base licence/);
});
test('License Manager reconciliation processes all registered product bindings',()=>{
 const reconcile=read('../src/lib/license-master-reconcile.ts');
 assert.match(reconcile,/masterProducts\(\)/);
 assert.doesNotMatch(reconcile,/const CANONICAL=new Set/);
 assert.doesNotMatch(reconcile,/if\(!CANONICAL\.has\(product\)\)/);
});
test('fulfilment queue language and product labels are not tied to OrbitFS',()=>{
 const page=read('../src/app/admin/fulfillment/page.tsx');
 assert.doesNotMatch(page,/Paid OrbitFS orders/);
 assert.doesNotMatch(page,/Base licence ID/);
 assert.match(page,/License Manager licence ID/);
});

test('admin product editor enables License Manager for any registered product, not a fixed OrbitFS list',()=>{
 const page=read('../src/app/admin/products/page.tsx');
 assert.doesNotMatch(page,/ORBITFS_LICENSE_PRODUCTS/);
 assert.match(page,/license_api_enabled:!!edit\.license_api_enabled/);
 assert.match(page,/license_api_mode:edit\.license_api_mode\|\|"master"/);
});
test('License Manager diagnostics enumerate all registered products instead of an OrbitFS allowlist',()=>{
 const route=read('../src/app/api/admin/settings/license-master/route.ts');
 assert.doesNotMatch(route,/canonicalProducts/);
 assert.match(route,/const connections=rows\.map/);
 assert.match(route,/License Manager returned no registered products/);
});
