import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(p)=>readFileSync(new URL(p,import.meta.url),'utf8');

test('invoice/order linking is permission checked, same-customer, same-currency and audited',()=>{
 const sql=read('../database/migrations/20261117100000_admin_invoice_order_linking.sql');
 assert.match(sql,/has_permission\('invoices\.edit'\)/);
 assert.match(sql,/has_permission\('orders\.edit'\)/);
 assert.match(sql,/invoice and order must belong to the same customer/);
 assert.match(sql,/invoice and order currencies must match/);
 assert.match(sql,/invoice\.order_linked/);
 assert.match(sql,/invoice\.order_unlinked/);
 assert.match(sql,/admin_audit_log/);
});

test('order page can list and link multiple invoices to an order',()=>{
 const page=read('../src/app/admin/orders/[id]/page.tsx');
 assert.match(page,/admin_link_invoice_order/);
 assert.match(page,/availableInvoices/);
 assert.match(page,/invoices\.map/);
});

test('invoice page can link and unlink an order and display the reciprocal order link',()=>{
 const page=read('../src/app/admin/invoices/[id]/page.tsx');
 assert.match(page,/admin_link_invoice_order/);
 assert.match(page,/orders\.map/);
 assert.match(page,/Order relationship/);
});
