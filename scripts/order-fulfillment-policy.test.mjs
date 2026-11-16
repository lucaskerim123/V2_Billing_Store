import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');

test('admin override can activate an order without fabricating an invoice',()=>{
 const migration=read('../database/migrations/20261117090000_admin_order_override_without_invoice.sql');
 assert.match(migration,/has_permission\('orders\.override_payment'\)/);
 assert.match(migration,/has_invoice := found/);
 assert.match(migration,/'paid_admin_override'/);
 assert.match(migration,/'invoice_missing',not has_invoice/);
 assert.match(migration,/order\.force_activate/);
 assert.doesNotMatch(migration,/raise exception 'order has no invoice'/);
});

test('order details expose invoice-independent admin override and explicit manual fulfilment',()=>{
 const page=read('../src/app/admin/orders/[id]/page.tsx');
 assert.match(page,/can\('orders\.override_payment'\).*Admin Override · Accept & Activate/);
 assert.match(page,/invoice_missing/);
 assert.match(page,/Run Manual Fulfilment/);
 assert.match(page,/manual:true/);
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
});

test('invoice and order workflows preserve automatic/manual/paused fulfilment policy',()=>{
 const settings=read('../src/lib/settings-meta.ts');
 const sync=read('../src/lib/license-master-sync.ts');
 assert.match(settings,/products\.fulfillment_mode/);
 assert.match(settings,/options:\["automatic","manual","paused"\]/);
 assert.match(sync,/authority\.automaticFulfillmentAllowed/);
 assert.match(sync,/authority\.manualFulfillmentAllowed/);
});
