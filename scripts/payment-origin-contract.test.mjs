import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const verify=readFileSync('src/app/api/payments/status/route.ts','utf8');
const start=readFileSync('src/app/api/payments/start/route.ts','utf8');
const setup=readFileSync('src/app/api/payments/setup/webhook/route.ts','utf8');
const runtime=readFileSync('src/lib/paymentRuntime.ts','utf8');
const storeOrigin=readFileSync('src/lib/site-origin.ts','utf8');

test('gateway verify uses configured canonical origin, not the incoming request host',()=>{
 assert.match(verify,/import\s+\{orbitfsStoreOrigin\}\s+from\s+['"]@\/lib\/site-origin['"]/);
 assert.match(verify,/const origin=await orbitfsStoreOrigin\(req\.url\)/);
 assert.doesNotMatch(verify,/new URL\(req\.url\)\.origin/);
});
test('checkout and webhook setup consistently use canonical origin',()=>{
 assert.match(start,/const origin=await orbitfsStoreOrigin\(req\.url\)/);
 assert.match(setup,/const origin=await orbitfsStoreOrigin\(req\.url\)/);
 assert.match(runtime,/'x-orbitfs-origin':options\.origin/);
});
test('canonical resolver never trusts arbitrary incoming origin',()=>{
 assert.match(storeOrigin,/orbitfsStoreOrigin\(_requestUrl\?:string\)/);
 assert.match(storeOrigin,/return normalizeOrigin\(DEFAULT_STORE_ORIGIN\)/);
});
