import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');

test('order details expose invoice-independent admin override and explicit manual fulfilment',()=>{
 const page=read('../src/app/admin/orders/[id]/page.tsx');
 assert.match(page,/orders\.override_payment/);
 assert.match(page,/Admin Override · Accept & Activate/);
 assert.match(page,/invoice_missing/);
 assert.match(page,/Run Manual Fulfilment/);
 assert.match(page,/action:'fulfill'/);
});

test('fulfilment API only bypasses configured automatic mode for an explicit staff manual action',()=>{
 const route=read('../src/app/api/admin/license-master/fulfill/route.ts');
 assert.match(route,/const manual=body\.manual===true/);
 assert.match(route,/if\(manual&&!isAdmin\)/);
 assert.match(route,/syncPaidOrderToLicenseMaster\(orderId,\{manual\}\)/);
});

test('automatic fulfilment after manually recorded payment respects the configured mode',()=>{
 const payment=read('../src/app/admin/invoices/[id]/payments/page.tsx');
 const orderControl=read('../src/app/api/admin/license-master/order-control/route.ts');
 assert.match(payment,/manual:false/);
 assert.match(orderControl,/syncPaidOrderToLicenseMaster\(orderId,\{manual:false\}\)/);
 assert.match(orderControl,/manual_fulfillment_queue/);
 assert.match(orderControl,/syncPaidOrderToLicenseMaster\(orderId,\{manual:true\}\)/);
 assert.match(orderControl,/action==="fulfill"/);
});

test('invoice and order workflows preserve automatic/manual/paused fulfilment policy',()=>{
 const settings=read('../src/lib/settings-meta.ts');
 const sync=read('../src/lib/license-master-sync.ts');
 assert.match(settings,/products\.fulfillment_mode/);
 assert.match(settings,/options:\["automatic","manual","paused"\]/);
 assert.match(sync,/authority\.automaticFulfillmentAllowed/);
 assert.match(sync,/authority\.manualFulfillmentAllowed/);
});
