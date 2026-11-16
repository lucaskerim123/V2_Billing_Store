import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(p)=>readFileSync(new URL(p,import.meta.url),'utf8');

test('admin activation override processes every linked invoice and records each override',()=>{
 const sql=read('../database/migrations/20261117110000_admin_override_all_linked_invoices.sql');
 assert.match(sql,/for inv in select \* from public\.invoices where order_id=p_order_id/);
 assert.match(sql,/invoice_payments/);
 assert.match(sql,/overridden_invoice_ids/);
 assert.match(sql,/invoice_missing/);
 assert.match(sql,/order\.force_activate/);
});
