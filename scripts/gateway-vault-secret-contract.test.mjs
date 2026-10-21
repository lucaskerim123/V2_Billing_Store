import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync('database/migrations/20261017_gateway_vault_secret_recovery.sql','utf8');
const ui=readFileSync('src/app/admin/payments/setup/page.tsx','utf8');
test('orphan Vault name recovered instead of triggering duplicate index',()=>{
 assert.match(ui,/admin_store_gateway_secret/);
 assert.match(sql,/select id into named_sid from vault\.secrets where name=secname;/);
 assert.match(sql,/if named_sid is not null then\s+sid:=named_sid;/);
 assert.match(sql,/perform vault\.update_secret\(sid,p_value,secname/);
 assert.match(sql,/sid:=vault\.create_secret\(/);
 assert.match(sql,/set secret_refs=jsonb_set\(/);
});
test('webhook autoconfiguration service role permitted, staff authorization retained',()=>{
 assert.match(sql,/coalesce\(auth\.role\(\),'\) <> 'service_role'/);
 assert.match(sql,/public\.has_permission\('payment_gateways\.manage'\)/);
 assert.match(sql,/grant execute on function public\.admin_store_gateway_secret\(text,text,text\) to authenticated,service_role;/);
});
test('Remove affects only matching Vault ID and name',()=>{
 assert.match(sql,/delete from vault\.secrets where id=sid and name=secname;/);
 assert.doesNotMatch(sql,/decrypted_secrets|drop table|truncate table/);
});
